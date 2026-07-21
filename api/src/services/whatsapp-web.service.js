const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const QRCode = require('qrcode');
const { env } = require('../config/env');
const { emit } = require('./socket.service');

let client;
let state = 'not_initialized';
let qrDataUrl;
let handlers = {};
let attemptActive = false;
let updatedAt = new Date().toISOString();
let lastError = null;
let generation = 0;

const PROVIDER_TIMEOUTS = Object.freeze({
  compatibility: 2_000,
  chatList: 6_000,
  history: 4_000,
  avatar: 2_500
});

function serializedId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value._serialized || value.$1 || null;
}

function snapshot() {
  return {
    initialized: Boolean(client),
    ready: state === 'ready',
    state,
    qrCode: qrDataUrl || null,
    attemptActive,
    updatedAt,
    lastError
  };
}

function publish() {
  emit('whatsapp_web:status', snapshot());
}

function updateState(nextState, changes = {}) {
  state = nextState;
  if (Object.prototype.hasOwnProperty.call(changes, 'qrCode')) qrDataUrl = changes.qrCode;
  if (Object.prototype.hasOwnProperty.call(changes, 'attemptActive')) attemptActive = changes.attemptActive;
  if (Object.prototype.hasOwnProperty.call(changes, 'lastError')) lastError = changes.lastError;
  updatedAt = new Date().toISOString();
}

function authRoot() {
  const workspaceRoot = path.resolve(process.cwd());
  const target = path.resolve(workspaceRoot, env.whatsappWebAuthPath);
  if (target === workspaceRoot || !target.startsWith(workspaceRoot + path.sep)) {
    throw new Error('Diretorio de autenticacao WhatsApp inseguro');
  }
  return target;
}

function pidIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_error) {
    return false;
  }
}

async function activeLock(sessionPath) {
  const lockPath = path.join(sessionPath, 'SingletonLock');
  try {
    const lockTarget = await fs.readlink(lockPath);
    const match = /^(.*)-(\d+)$/.exec(lockTarget);
    return Boolean(match && match[1] === os.hostname() && pidIsRunning(Number(match[2])));
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EINVAL') return false;
    throw error;
  }
}

async function clearStaleBrowserLocks() {
  if (client) return { removed: 0, skipped: true };
  const root = authRoot();
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return { removed: 0, skipped: false };
    throw error;
  }

  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^session(?:-|$)/.test(entry.name)) continue;
    const sessionPath = path.resolve(root, entry.name);
    if (!sessionPath.startsWith(root + path.sep)) continue;
    if (await activeLock(sessionPath)) {
      const error = new Error('O perfil do WhatsApp Web ja esta em uso por um processo ativo');
      error.code = 'WHATSAPP_WEB_PROFILE_ACTIVE';
      throw error;
    }
    for (const artifact of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
      const artifactPath = path.join(sessionPath, artifact);
      try {
        await fs.lstat(artifactPath);
        await fs.rm(artifactPath, { force: true });
        removed += 1;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  return { removed, skipped: false };
}

function safeErrorMessage(error) {
  if (error?.code === 'WHATSAPP_WEB_PROFILE_ACTIVE') return error.message;
  if (/profile appears to be in use|SingletonLock/i.test(String(error?.message || ''))) {
    return 'O perfil local do WhatsApp Web ficou bloqueado. Tente gerar o QR Code novamente.';
  }
  return 'Nao foi possivel iniciar o WhatsApp Web. Tente gerar o QR Code novamente.';
}

async function callHandler(name, ...args) {
  try {
    await handlers[name]?.(...args);
  } catch (error) {
    console.error('[whatsapp-web lifecycle handler]', error.message);
  }
}

function providerTimeout(stage, timeoutMs, message) {
  const error = new Error(message || `Tempo limite na operacao WhatsApp Web (${stage})`);
  error.code = 'WHATSAPP_WEB_PROVIDER_TIMEOUT';
  error.stage = stage;
  error.timeoutMs = timeoutMs;
  return error;
}

async function withTimeout(operation, timeoutMs = 8_000, options = {}) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(providerTimeout(
          options.stage || 'client',
          timeoutMs,
          options.message || 'Tempo limite ao encerrar o cliente WhatsApp Web'
        )), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function destroyClient(target) {
  if (!target) return;
  try {
    await withTimeout(target.destroy());
  } catch (_error) {
    // Encerramento best effort; o processo do container finaliza o Chromium residual.
  }
}

async function ensureCompatibility(target = client) {
  if (!target?.pupPage) throw new Error('Pagina do WhatsApp Web indisponivel');
  return target.pupPage.evaluate(() => {
    const page = globalThis.window;
    const api = page?.WWebJS;
    if (!api) throw new Error('API injetada do WhatsApp Web indisponivel');

    api.getMsgKeyId = (key) => key?._serialized || key?.$1 || null;
    const MsgKey = page.require('WAWebMsgKey');
    const prototype = MsgKey?.prototype;
    if (prototype && !prototype.__notifySerializedCompat) {
      const current = Object.getOwnPropertyDescriptor(prototype, '_serialized');
      if (!current || current.configurable) {
        Object.defineProperty(prototype, '_serialized', {
          configurable: true,
          get() { return this.$1 || null; }
        });
      }
      Object.defineProperty(prototype, '__notifySerializedCompat', { value: true, configurable: true });
    }

    if (!api.getMessageModel.__notifySerializedCompat) {
      const originalGetMessageModel = api.getMessageModel;
      const compatibleGetMessageModel = (message) => {
        const model = originalGetMessageModel(message);
        if (model?.id && !model.id._serialized) {
          model.id._serialized = api.getMsgKeyId(model.id) || api.getMsgKeyId(message?.id);
        }
        for (const key of ['latestEditMsgKey', 'protocolMessageKey']) {
          if (model?.[key] && !model[key]._serialized) {
            model[key]._serialized = api.getMsgKeyId(model[key]);
          }
        }
        return model;
      };
      Object.defineProperty(compatibleGetMessageModel, '__notifySerializedCompat', { value: true });
      api.getMessageModel = compatibleGetMessageModel;
    }
    return true;
  });
}

async function probeCompatibility(target = client) {
  return target.pupPage.evaluate(async () => {
    const page = globalThis.window;
    const chats = page.require('WAWebCollections').Chat.getModelsArray();
    const sample = chats.find((chat) => chat.lastReceivedKey) || chats[0];
    if (!sample) return true;
    const key = sample.lastReceivedKey;
    if (key && !(key._serialized || key.$1)) throw new Error('Formato de identificador de mensagem desconhecido');
    return Boolean(await page.WWebJS.getChatModel(sample));
  });
}

async function initialize(eventHandlers = {}, options = {}) {
  handlers = eventHandlers;
  if (client && ['disconnected', 'auth_failure', 'error'].includes(state)) {
    const previousClient = client;
    generation += 1;
    client = undefined;
    await destroyClient(previousClient);
    updateState('not_initialized', { qrCode: null, attemptActive: false, lastError: null });
  }
  if (client) return snapshot();
  await clearStaleBrowserLocks();
  const { Client, LocalAuth } = require('whatsapp-web.js');
  const currentGeneration = ++generation;
  updateState('initializing', { qrCode: null, attemptActive: true, lastError: null });
  const currentClient = new Client({
    authStrategy: new LocalAuth({ dataPath: path.resolve(process.cwd(), env.whatsappWebAuthPath) }),
    puppeteer: {
      executablePath: env.puppeteerExecutablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
  });
  client = currentClient;
  const active = () => client === currentClient && generation === currentGeneration;
  currentClient.on('qr', async (qr) => {
    if (!active()) return;
    const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
    if (!active()) return;
    updateState('qr', { qrCode: dataUrl, attemptActive: true, lastError: null });
    emit('whatsapp_web:qr', { ...snapshot(), at: updatedAt });
    publish();
    await callHandler('onQr', dataUrl);
  });
  currentClient.on('authenticated', async () => {
    if (!active()) return;
    updateState('authenticated', { qrCode: null, attemptActive: true, lastError: null });
    publish();
    await callHandler('onAuthenticated');
  });
  currentClient.on('ready', async () => {
    if (!active()) return;
    try {
      await ensureCompatibility(currentClient);
      await probeCompatibility(currentClient);
    } catch (error) {
      if (!active()) return;
      updateState('error', {
        qrCode: null,
        attemptActive: false,
        lastError: 'A sessao conectou, mas a API do WhatsApp Web esta temporariamente incompativel.'
      });
      publish();
      await callHandler('onError', error, { explicit: options.explicit === true });
      return;
    }
    updateState('ready', { qrCode: null, attemptActive: false, lastError: null });
    publish();
    emit('whatsapp_web:ready', snapshot());
    await callHandler('onReady');
  });
  currentClient.on('auth_failure', async (message) => {
    if (!active()) return;
    updateState('auth_failure', { qrCode: null, attemptActive: false, lastError: 'Falha ao autenticar o WhatsApp Web.' });
    publish();
    await callHandler('onAuthFailure', message);
  });
  currentClient.on('disconnected', async (reason) => {
    if (!active()) return;
    updateState('disconnected', { qrCode: null, attemptActive: false });
    publish();
    emit('whatsapp_web:disconnected', { ...snapshot(), reason: String(reason || '') });
    await callHandler('onDisconnected', reason);
  });
  currentClient.on('message', (message) => {
    if (!active()) return;
    Promise.resolve(ensureCompatibility(currentClient))
      .then(() => handlers.onMessage?.(message))
      .catch((error) => console.error('[whatsapp-web message]', error));
  });
  currentClient.initialize().catch(async (error) => {
    if (!active()) return;
    client = undefined;
    updateState('error', { qrCode: null, attemptActive: false, lastError: safeErrorMessage(error) });
    publish();
    await callHandler('onError', error, { explicit: options.explicit === true });
    await destroyClient(currentClient);
  });
  publish();
  return snapshot();
}

async function rawChatSummary(chatId) {
  return client.pupPage.evaluate(async (requestedId) => {
    const page = globalThis.window;
    const read = (getter, fallback = null) => {
      try { return getter() ?? fallback; } catch (_error) { return fallback; }
    };
    const serialize = (value) => {
      if (!value) return null;
      if (typeof value === 'string') return value;
      return value._serialized || value.$1 || read(() => value.toString(), null);
    };
    const wid = page.require('WAWebWidFactory').createWid(requestedId);
    let chat = page.require('WAWebCollections').Chat.get(wid);
    if (!chat) chat = (await page.require('WAWebFindChatAction').findOrCreateLatestChat(wid))?.chat;
    if (!chat) return null;
    const id = serialize(chat.id) || requestedId;
    const server = read(() => chat.id.server, String(id).split('@')[1]);
    const isGroup = server === 'g.us' || /@g\.us$/i.test(id) || Boolean(read(() => chat.groupMetadata, false));
    const contact = read(() => chat.contact, null);
    let phoneWid = read(() => contact.phoneNumber, null);
    if (!phoneWid && !isGroup) {
      phoneWid = read(() => page.require('WAWebApiContact').getAlternateUserWid(chat.id), null);
    }
    const phone = isGroup ? null : read(() => phoneWid.user, null)
      || read(() => contact.userid, null)
      || (server !== 'lid' ? read(() => chat.id.user, null) : null);
    return {
      id,
      name: read(() => chat.name, null)
        || read(() => chat.formattedTitle, null)
        || read(() => contact.name, null)
        || read(() => contact.pushname, null)
        || phone
        || id,
      phone,
      isGroup,
      unreadCount: Number(read(() => chat.unreadCount, 0)) || 0,
      timestamp: Number(read(() => chat.t, 0)) || null,
      imageUrl: read(() => contact.profilePicThumb.eurl, null)
        || read(() => chat.profilePicThumb.eurl, null)
    };
  }, chatId);
}

async function rawChats(limit) {
  return client.pupPage.evaluate((requestedLimit) => {
    const page = globalThis.window;
    const read = (getter, fallback = null) => {
      try { return getter() ?? fallback; } catch (_error) { return fallback; }
    };
    const serialize = (value) => {
      if (!value) return null;
      if (typeof value === 'string') return value;
      return value._serialized || value.$1 || read(() => value.toString(), null);
    };
    const result = [];
    for (const chat of page.require('WAWebCollections').Chat.getModelsArray()) {
      const id = serialize(read(() => chat.id, null));
      if (!id) continue;
      const server = read(() => chat.id.server, String(id).split('@')[1]);
      const isGroup = server === 'g.us' || /@g\.us$/i.test(id) || Boolean(read(() => chat.groupMetadata, false));
      const contact = read(() => chat.contact, null);
      let phoneWid = read(() => contact.phoneNumber, null);
      if (!phoneWid && !isGroup) {
        phoneWid = read(() => page.require('WAWebApiContact').getAlternateUserWid(chat.id), null);
      }
      const phone = isGroup ? null : read(() => phoneWid.user, null)
        || read(() => contact.userid, null)
        || (server !== 'lid' ? read(() => chat.id.user, null) : null);
      result.push({
        id,
        name: read(() => chat.name, null)
          || read(() => chat.formattedTitle, null)
          || read(() => contact.name, null)
          || read(() => contact.pushname, null)
          || phone
          || id,
        phone,
        isGroup,
        unreadCount: Number(read(() => chat.unreadCount, 0)) || 0,
        timestamp: Number(read(() => chat.t, 0)) || null,
        imageUrl: read(() => contact.profilePicThumb.eurl, null)
          || read(() => chat.profilePicThumb.eurl, null)
      });
      if (result.length >= requestedLimit) break;
    }
    return result;
  }, Math.min(200, Math.max(1, limit)));
}

async function listChats(limit = 100, options = {}) {
  if (!client || state !== 'ready') throw new Error('WhatsApp Web nao esta pronto');
  const timeoutMs = Math.min(30_000, Math.max(100, Number(options.timeoutMs) || PROVIDER_TIMEOUTS.chatList));
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(25, deadline - Date.now());
  await withTimeout(ensureCompatibility(), Math.min(PROVIDER_TIMEOUTS.compatibility, remaining()), {
    stage: 'compatibility', message: 'Tempo limite ao preparar a lista de chats do WhatsApp Web'
  });
  try {
    return await withTimeout(rawChats(limit), remaining(), {
      stage: 'chat_list', message: 'Tempo limite ao consultar a lista de chats do WhatsApp Web'
    });
  } catch (rawError) {
    // Um timeout indica que a pagina ficou presa. Nao enfileire imediatamente
    // outro evaluate pela API publica na mesma pagina.
    if (rawError.code === 'WHATSAPP_WEB_PROVIDER_TIMEOUT') throw rawError;
    const chats = (await withTimeout(client.getChats(), remaining(), {
      stage: 'chat_list_fallback', message: 'Tempo limite ao consultar a lista alternativa de chats do WhatsApp Web'
    })).slice(0, Math.min(200, limit));
    return chats.map((chat) => ({
      id: serializedId(chat.id),
      name: chat.name || chat.formattedTitle || chat.id.user,
      phone: chat.isGroup ? null : chat.id.user,
      isGroup: chat.isGroup,
      unreadCount: chat.unreadCount,
      timestamp: chat.timestamp,
      imageUrl: null
    }));
  }
}

async function getChatSummary(chatId) {
  if (!client || state !== 'ready') throw new Error('WhatsApp Web nao esta pronto');
  await ensureCompatibility();
  try {
    const summary = await rawChatSummary(chatId);
    if (summary) return summary;
  } catch (_rawError) { /* tenta a API publica abaixo */ }
  const chat = await client.getChatById(chatId);
  return {
    id: serializedId(chat.id),
    name: chat.name || chat.formattedTitle || chat.id.user,
    phone: chat.isGroup ? null : chat.id.user,
    isGroup: chat.isGroup,
    imageUrl: null
  };
}

async function getProfilePicUrl(chatId, options = {}) {
  if (!client || state !== 'ready' || !chatId) return null;
  const timeoutMs = Math.min(10_000, Math.max(100, Number(options.timeoutMs) || PROVIDER_TIMEOUTS.avatar));
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(25, deadline - Date.now());
  try {
    await withTimeout(ensureCompatibility(), Math.min(PROVIDER_TIMEOUTS.compatibility, remaining()), {
      stage: 'compatibility', message: 'Tempo limite ao preparar a foto do contato WhatsApp Web'
    });
    const result = await withTimeout(client.pupPage.evaluate(async (requestedId, browserTimeoutMs) => {
      const page = globalThis.window;
      const wid = page.require('WAWebWidFactory').createWid(requestedId);
      let chat = page.require('WAWebCollections').Chat.get(wid);
      if (!chat) {
        let findTimer;
        const findTimeout = { timedOut: true };
        const found = await Promise.race([
          page.require('WAWebFindChatAction').findOrCreateLatestChat(wid),
          new Promise((resolve) => {
            findTimer = setTimeout(() => resolve(findTimeout), Math.min(1_000, browserTimeoutMs));
          })
        ]);
        clearTimeout(findTimer);
        if (found === findTimeout) return { value: null, timedOut: true };
        chat = found?.chat;
      }
      if (!chat) return { value: null, timedOut: false };
      const cached = chat.contact?.profilePicThumb?.eurl || chat.profilePicThumb?.eurl;
      if (cached) return { value: cached, timedOut: false };
      try {
        let timer;
        const timeoutMarker = { timedOut: true };
        const profile = await Promise.race([
          page.require('WAWebContactProfilePicThumbBridge').requestProfilePicFromServer(chat),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(timeoutMarker), browserTimeoutMs);
          })
        ]);
        clearTimeout(timer);
        if (profile === timeoutMarker) return { value: null, timedOut: true };
        return { value: profile?.eurl || null, timedOut: false };
      } catch (_error) {
        return { value: null, timedOut: false };
      }
    }, chatId, Math.max(25, remaining() - 50)), remaining(), {
      stage: 'avatar', message: 'Tempo limite ao consultar a foto do contato WhatsApp Web'
    });
    if (result?.timedOut) throw providerTimeout('avatar', timeoutMs);
    if (result?.value) return result.value;
    return await withTimeout(client.getProfilePicUrl(chatId), remaining(), {
      stage: 'avatar_fallback', message: 'Tempo limite ao consultar a foto alternativa do contato WhatsApp Web'
    }) || null;
  } catch (error) {
    if (error.code === 'WHATSAPP_WEB_PROVIDER_TIMEOUT') throw error;
    return null;
  }
}

async function getMessages(chatId, limit = 50, options = {}) {
  if (!client || state !== 'ready') throw new Error('WhatsApp Web nao esta pronto');
  const timeoutMs = Math.min(20_000, Math.max(100, Number(options.timeoutMs) || PROVIDER_TIMEOUTS.history));
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(25, deadline - Date.now());
  await withTimeout(ensureCompatibility(), Math.min(PROVIDER_TIMEOUTS.compatibility, remaining()), {
    stage: 'compatibility', message: 'Tempo limite ao preparar o historico WhatsApp Web'
  });
  const requestedLimit = Math.min(100, Math.max(1, limit));
  try {
    const result = await withTimeout(client.pupPage.evaluate(async (requestedId, maxMessages, browserTimeoutMs) => {
      const page = globalThis.window;
      const historyDeadline = Date.now() + browserTimeoutMs;
      const wid = page.require('WAWebWidFactory').createWid(requestedId);
      let chat = page.require('WAWebCollections').Chat.get(wid);
      if (!chat) {
        let findTimer;
        const findTimeout = { timedOut: true };
        const found = await Promise.race([
          page.require('WAWebFindChatAction').findOrCreateLatestChat(wid),
          new Promise((resolve) => {
            findTimer = setTimeout(() => resolve(findTimeout), Math.min(1_000, browserTimeoutMs));
          })
        ]);
        clearTimeout(findTimer);
        if (found === findTimeout) return { messages: [], timedOut: true };
        chat = found?.chat;
      }
      if (!chat) return { messages: [], timedOut: false };
      const filter = (message) => !message.isNotification;
      let messages = chat.msgs.getModelsArray().filter(filter);
      let timedOut = false;
      while (messages.length < maxMessages) {
        const callBudget = Math.max(1, Math.min(1_500, historyDeadline - Date.now()));
        if (Date.now() >= historyDeadline) {
          timedOut = true;
          break;
        }
        let timer;
        const timeoutMarker = { timedOut: true };
        const loaded = await Promise.race([
          page.require('WAWebChatLoadMessages').loadEarlierMsgs({ chat }),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(timeoutMarker), callBudget);
          })
        ]);
        clearTimeout(timer);
        if (loaded === timeoutMarker) {
          timedOut = true;
          break;
        }
        if (!loaded?.length) break;
        messages = [...loaded.filter(filter), ...messages];
      }
      messages.sort((left, right) => Number(left.t || 0) - Number(right.t || 0));
      return {
        timedOut,
        messages: messages.slice(-maxMessages).map((message) => ({
          id: page.WWebJS.getMsgKeyId(message.id),
          chatId: requestedId,
          fromMe: Boolean(message.id?.fromMe),
          body: String(message.body || message.caption || message.pollName || '').slice(0, 10000),
          type: message.type || 'chat',
          timestamp: Number(message.t || 0),
          hasMedia: Boolean(message.directPath)
        }))
      };
    }, chatId, requestedLimit, Math.max(25, remaining() - 50)), remaining(), {
      stage: 'history', message: 'Tempo limite ao consultar o historico WhatsApp Web'
    });
    if (result?.timedOut) throw providerTimeout('history', timeoutMs);
    return result?.messages || [];
  } catch (rawError) {
    if (rawError.code === 'WHATSAPP_WEB_PROVIDER_TIMEOUT') throw rawError;
    const chat = await withTimeout(client.getChatById(chatId), remaining(), {
      stage: 'history_chat_fallback', message: 'Tempo limite ao localizar o chat pelo historico alternativo'
    });
    const messages = await withTimeout(chat.fetchMessages({ limit: requestedLimit }), remaining(), {
      stage: 'history_fallback', message: 'Tempo limite ao consultar o historico alternativo do WhatsApp Web'
    });
    return messages.map((message) => ({
      id: serializedId(message.id),
      chatId: serializedId(chat.id),
      fromMe: message.fromMe,
      body: String(message.body || '').slice(0, 10000),
      type: message.type,
      timestamp: message.timestamp,
      hasMedia: message.hasMedia
    }));
  }
}

async function resolveDestination(destination) {
  if (destination.includes('@')) return destination;
  const number = String(destination).replace(/\D/g, '');
  const result = await client.getNumberId(number);
  if (!result) throw new Error('Numero nao registrado no WhatsApp');
  return result._serialized;
}

async function sendMessage(destination, text, options = {}) {
  if (!client || state !== 'ready') throw new Error('WhatsApp Web nao esta pronto');
  await ensureCompatibility();
  const chatId = await resolveDestination(destination);
  const result = await client.sendMessage(chatId, text, options);
  return { providerMessageId: serializedId(result?.id), chatId };
}

async function clearAuthData() {
  await fs.rm(authRoot(), { recursive: true, force: true });
}

async function resetSession({ notifyDisconnected = true, reason = 'manual' } = {}) {
  const previousClient = client;
  generation += 1;
  client = undefined;
  if (previousClient) {
    try { await withTimeout(previousClient.logout()); } catch (_error) { await destroyClient(previousClient); }
  }
  await clearAuthData();
  updateState('not_initialized', { qrCode: null, attemptActive: false, lastError: null });
  publish();
  if (notifyDisconnected) emit('whatsapp_web:disconnected', { ...snapshot(), reason });
  return snapshot();
}

async function destroy() {
  const previousClient = client;
  generation += 1;
  client = undefined;
  await destroyClient(previousClient);
  updateState('not_initialized', { qrCode: null, attemptActive: false, lastError: null });
  publish();
  return snapshot();
}

async function logout() {
  return resetSession({ reason: 'manual' });
}

async function regenerate(eventHandlers = {}) {
  await resetSession({ reason: 'regenerate' });
  return initialize(eventHandlers, { explicit: true });
}

module.exports = {
  initialize,
  regenerate,
  snapshot,
  listChats,
  getChatSummary,
  getProfilePicUrl,
  getMessages,
  sendMessage,
  destroy,
  logout,
  clearAuthData,
  clearStaleBrowserLocks,
  ensureCompatibility,
  probeCompatibility
};
