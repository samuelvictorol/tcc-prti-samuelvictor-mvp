const webService = require('../services/whatsapp-web.service');
const settingsManager = require('./settings.manager');
const contactsManager = require('./contacts.manager');
const logsManager = require('./logs.manager');
const conversationsManager = require('./conversations.manager');
const adminNotificationsManager = require('./admin-notifications.manager');
const { env } = require('../config/env');
const { emit } = require('../services/socket.service');
const ApiError = require('../utils/api-error');

const SYNC_DEFAULTS = Object.freeze({
  chatLimit: 200,
  historyLimit: 25,
  concurrency: 3,
  listTimeoutMs: 8_000,
  historyTimeoutMs: 4_000,
  avatarTimeoutMs: 2_500,
  chatTimeoutMs: 8_000,
  totalTimeoutMs: 20_000,
  logTimeoutMs: 1_000
});

let activeSyncRun;

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function syncOptions(options = {}) {
  return {
    chatLimit: boundedInteger(options.chatLimit, SYNC_DEFAULTS.chatLimit, 1, 200),
    historyLimit: boundedInteger(options.historyLimit, SYNC_DEFAULTS.historyLimit, 1, 100),
    concurrency: boundedInteger(options.concurrency, SYNC_DEFAULTS.concurrency, 1, 6),
    listTimeoutMs: boundedInteger(options.listTimeoutMs, SYNC_DEFAULTS.listTimeoutMs, 25, 30_000),
    historyTimeoutMs: boundedInteger(options.historyTimeoutMs, SYNC_DEFAULTS.historyTimeoutMs, 25, 20_000),
    avatarTimeoutMs: boundedInteger(options.avatarTimeoutMs, SYNC_DEFAULTS.avatarTimeoutMs, 25, 10_000),
    chatTimeoutMs: boundedInteger(options.chatTimeoutMs, SYNC_DEFAULTS.chatTimeoutMs, 50, 30_000),
    totalTimeoutMs: boundedInteger(options.totalTimeoutMs, SYNC_DEFAULTS.totalTimeoutMs, 100, 45_000),
    logTimeoutMs: boundedInteger(options.logTimeoutMs, SYNC_DEFAULTS.logTimeoutMs, 25, 5_000)
  };
}

function syncTimeout(stage, timeoutMs) {
  const error = new Error(`Tempo limite ao sincronizar WhatsApp Web (${stage})`);
  error.code = 'WHATSAPP_WEB_SYNC_TIMEOUT';
  error.stage = stage;
  error.timeoutMs = timeoutMs;
  return error;
}

function isSyncTimeout(error) {
  return ['WHATSAPP_WEB_SYNC_TIMEOUT', 'WHATSAPP_WEB_PROVIDER_TIMEOUT'].includes(error?.code);
}

async function withinSyncTimeout(operation, timeoutMs, stage) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(syncTimeout(stage, timeoutMs)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function writeSyncLog(entry, options) {
  await withinSyncTimeout(() => logsManager.create(entry), options.logTimeoutMs, 'log').catch(() => undefined);
}

async function notifyNewContact(contact, context = {}) {
  await logsManager.create({
    channel: 'whatsapp_web',
    action: 'contact.auto_created',
    message: 'Contato criado automaticamente pelo WhatsApp Web',
    context: { contactId: contact.id, ...context }
  }).catch(() => undefined);
  await adminNotificationsManager.create({
    kind: 'contact_auto_created',
    channel: 'whatsapp_web',
    title: 'Novo contato recebido',
    message: (contact.displayName || 'Um novo contato') + ' foi cadastrado automaticamente pelo WhatsApp Web.',
    contactId: contact.id,
    context
  }).catch(async (error) => {
    await logsManager.create({ level: 'warn', channel: 'whatsapp_web', action: 'admin_notification.failed', message: 'Contato criado, mas o aviso administrativo falhou', context: { error: error.message } }).catch(() => undefined);
  });
}

async function sessionMaxAgeDays() {
  const configured = await settingsManager.getValue('WHATSAPP_WEB_SESSION_MAX_AGE_DAYS');
  return Math.max(1, Number(configured || env.whatsappWebSessionMaxAgeDays));
}

async function authenticatedAt() {
  const value = await settingsManager.getValue('WHATSAPP_WEB_AUTHENTICATED_AT');
  return value ? new Date(value) : null;
}

async function clearAuthenticatedAt() {
  const Setting = require('../models/setting.model');
  await Setting.deleteOne({ key: 'WHATSAPP_WEB_AUTHENTICATED_AT' });
}

async function expiry() {
  const started = await authenticatedAt();
  if (!started || Number.isNaN(started.getTime())) return null;
  return new Date(started.getTime() + await sessionMaxAgeDays() * 86_400_000);
}

async function ensureNotExpired() {
  const expiresAt = await expiry();
  if (expiresAt && expiresAt <= new Date()) {
    await logout();
    throw new ApiError(401, 'Sessao WhatsApp Web expirou e requer novo QR Code', null, 'WHATSAPP_WEB_SESSION_EXPIRED');
  }
  return expiresAt;
}

function lifecycleHandlers({ explicit = true } = {}) {
  return {
    onAuthenticated: async () => {
      await settingsManager.setValue('WHATSAPP_WEB_AUTHENTICATED_AT', new Date().toISOString(), null, { internal: true });
      await logsManager.create({ channel: 'whatsapp_web', action: 'authenticated', message: 'WhatsApp Web autenticado' });
    },
    onReady: () => logsManager.create({ channel: 'whatsapp_web', action: 'ready', message: 'WhatsApp Web pronto' }),
    onAuthFailure: async (message) => {
      await clearAuthenticatedAt();
      if (explicit) await logsManager.create({ level: 'error', channel: 'whatsapp_web', action: 'auth_failure', message: 'Falha de autenticacao WhatsApp Web', context: { reason: message } });
    },
    onDisconnected: async (reason) => {
      await clearAuthenticatedAt();
      if (explicit) await logsManager.create({ level: 'warn', channel: 'whatsapp_web', action: 'disconnected', message: 'WhatsApp Web desconectado', context: { reason } });
    },
    onError: (error) => explicit
      ? logsManager.create({ level: 'error', channel: 'whatsapp_web', action: 'error', message: 'Nao foi possivel iniciar o WhatsApp Web', context: { error: error.message } })
      : undefined,
    onMessage: processIncoming
  };
}

async function initialize(options = {}) {
  const explicit = options.explicit !== false;
  await ensureNotExpired().catch((error) => {
    if (error.code !== 'WHATSAPP_WEB_SESSION_EXPIRED') throw error;
  });
  const result = await webService.initialize(lifecycleHandlers({ explicit }), { explicit });
  return result;
}

async function resume() {
  if (!await authenticatedAt()) return status();
  try {
    await ensureNotExpired();
  } catch (error) {
    if (error.code === 'WHATSAPP_WEB_SESSION_EXPIRED') return status();
    throw error;
  }
  return initialize({ explicit: false });
}

async function regenerate() {
  await clearAuthenticatedAt();
  const result = await webService.regenerate(lifecycleHandlers({ explicit: true }));
  return result;
}

function serializedId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value._serialized || value.$1 || null;
}

function incomingChatId(message) {
  return serializedId(message?.from)
    || serializedId(message?.id?.remote)
    || serializedId(message?.chatId);
}

function providerMessageId(message) {
  return serializedId(message?.id) || serializedId(message?.providerMessageId);
}

function isGroupChat(chatId, message) {
  return Boolean(message?.isGroup || message?.author || /@g\.us$/i.test(String(chatId || '')));
}

async function contactFromMessage(message, chatId) {
  if (message?.contactData) return message.contactData;
  if (typeof message?.getContact === 'function') {
    try {
      const contact = await message.getContact();
      if (contact) return contact;
    } catch (_error) {
      // Dados de perfil sao enriquecimento best effort e nao bloqueiam o comando de permissao.
    }
  }
  const fallbackPhone = message?.phone || (/@(c\.us|s\.whatsapp\.net)$/i.test(chatId)
    ? String(chatId).replace(/@.+$/, '')
    : null);
  return {
    id: { _serialized: chatId },
    number: fallbackPhone,
    pushname: message?.displayName || message?.rawData?.notifyName || fallbackPhone || chatId
  };
}

async function processIncoming(message) {
  const chatId = incomingChatId(message);
  if (message?.fromMe || chatId === 'status@broadcast') return;
  if (!chatId) return { ignored: true, reason: 'invalid_chat_id' };
  if (isGroupChat(chatId, message)) return;
  const contactData = await contactFromMessage(message, chatId);
  const contactAddress = serializedId(contactData?.id) || chatId;
  const phone = contactData?.number || String(contactAddress || '').replace(/@.+$/, '');
  const permissionGranted = await settingsManager.isWhatsappPermissionCommand(message.body);
  const receivedPermissionCommand = permissionGranted ? String(message.body || '').trim() : null;
  const existingChannelContact = await contactsManager.findByChannelAddress('whatsapp_web', chatId);
  const existingContact = existingChannelContact
    || await contactsManager.findByChannelOrPhone('whatsapp_web', chatId, phone);
  const existingIdentity = existingContact?.channels?.find((item) => item.channel === 'whatsapp_web');
  const alreadyGranted = Boolean(existingIdentity?.authorized && existingIdentity?.consentStatus === 'granted');
  let contactAvatarUrl = message?.contactAvatarUrl || null;
  if (!contactAvatarUrl && !message?.skipProfileLookup) {
    contactAvatarUrl = await webService.getProfilePicUrl(contactAddress).catch(() => null);
  }
  if (!contactAvatarUrl && !message?.skipProfileLookup && contactAddress !== chatId) {
    contactAvatarUrl = await webService.getProfilePicUrl(chatId).catch(() => null);
  }
  const displayName = contactData.pushname || contactData.name || contactData.number
    || message?.displayName || message?.rawData?.notifyName || chatId;
  const contact = await contactsManager.upsertFromChannel({
    channel: 'whatsapp_web', address: chatId,
    displayName,
    phone,
    avatarUrl: contactAvatarUrl,
    source: permissionGranted ? 'whatsapp_web_permission_command' : 'whatsapp_web_message',
    authorize: permissionGranted,
    consentStatus: permissionGranted ? 'granted' : undefined,
    consentSource: permissionGranted ? 'automatic_permission_command' : undefined,
    consentCommand: receivedPermissionCommand,
    consentEvidence: permissionGranted ? { providerMessageId: providerMessageId(message), chatId } : undefined,
    shareWhatsappConsent: permissionGranted,
    refreshProfile: permissionGranted,
    metadata: {
      autoRegisteredVia: 'whatsapp_web',
      ...(permissionGranted ? {
        permissionCommandReceived: true,
        permissionCommandReceivedVia: 'whatsapp_web',
        sharedWhatsappConsent: true
      } : {}),
      chatId,
      messageFrom: chatId,
      contactId: contactAddress,
      serializedId: contactAddress,
      contactUser: contactData?.id?.user || phone,
      contactNumber: contactData?.number || phone
    }
  });
  const authorizedAfterUpsert = contact.channels?.some((identity) => (
    identity.channel === 'whatsapp_web'
    && identity.authorized
    && identity.consentStatus === 'granted'
  ));
  if (contact.upsertState?.created ?? !existingContact) {
    await notifyNewContact(contact, {
      source: permissionGranted ? 'permission_command' : 'inbound_message',
      permissionGranted
    });
  }
  const stored = await conversationsManager.recordInbound({
    channel: 'whatsapp_web',
    externalId: chatId,
    contactId: contact.id,
    displayName,
    avatarUrl: contactAvatarUrl,
    isGroup: false,
    providerMessageId: providerMessageId(message),
    body: message.body || '',
    type: message.type,
    hasMedia: message.hasMedia,
    sentAt: Number.isFinite(Number(message.timestamp)) && Number(message.timestamp) > 0
      ? Number(message.timestamp) * 1000
      : new Date()
  });
  if (!stored.duplicate && !stored.discardedByRemoval && stored.message) {
    if (!permissionGranted && !alreadyGranted && !authorizedAfterUpsert) {
      emit('whatsapp_web:permission_required', {
        contactId: contact.id,
        chatId,
        providerMessageId: providerMessageId(message),
        at: new Date().toISOString()
      });
    }
    emit('whatsapp_web:message', {
      id: providerMessageId(message),
      chatId,
      entityId: contact.id,
      isGroup: false,
      fromMe: false,
      body: String(message.body || '').slice(0, 2000),
      type: message.type,
      timestamp: message.timestamp,
      conversationId: stored.conversation.id
    });
    await logsManager.create({
      channel: 'whatsapp_web',
      action: permissionGranted ? 'contact.permission_granted' : 'message.received',
      message: permissionGranted
        ? 'Permissao de notificacao para WhatsApp Web e Cloud recebida pelo WhatsApp Web'
        : 'Mensagem WhatsApp Web recebida',
      context: {
        contactId: contact.id,
        messageId: providerMessageId(message),
        isGroup: false,
        source: contact.channels?.find((item) => item.channel === 'whatsapp_web')?.source,
        ...(permissionGranted ? {
          permissionChannels: ['whatsapp_web', 'whatsapp_cloud'],
          permissionCommand: receivedPermissionCommand,
          permissionReceivedVia: 'whatsapp_web'
        } : {})
      }
    });
  }
  return {
    ignored: false,
    contact,
    permissionGranted,
    permissionRequired: !permissionGranted && !alreadyGranted && !authorizedAfterUpsert,
    duplicate: Boolean(stored.duplicate)
  };
}

async function status() {
  const state = webService.snapshot();
  const expiresAt = await expiry();
  return { configured: true, ...state, expiresAt };
}

async function chats(limit) {
  await ensureNotExpired();
  const items = (await webService.listChats(limit)).filter((item) => !item.isGroup);
  const visibleIds = await conversationsManager.visibleExternalIds('whatsapp_web', items.map((item) => item.id));
  return items.filter((item) => visibleIds.has(String(item.id)));
}

async function assertKnownChat(chatId) {
  const chat = await webService.getChatSummary(chatId).catch(() => null);
  if (!chat || chat.id !== chatId) throw new ApiError(403, 'Chat nao pertence a sessao autenticada', null, 'UNKNOWN_CHAT');
  if (chat.isGroup) {
    throw new ApiError(422, 'WhatsApp Web permite resposta somente em chat individual', null, 'WHATSAPP_WEB_DIRECT_ONLY');
  }
  const contact = await contactsManager.findByChannelAddress('whatsapp_web', chatId);
  if (contact) return { type: 'contact', value: contact };
  throw new ApiError(
    403,
    'O chat ainda nao foi sincronizado pelo monitor',
    null,
    'UNKNOWN_CHAT_CONTACT'
  );
}

async function assertAuthorizedChat(chatId) {
  const known = await assertKnownChat(chatId);
  const identity = known.value.channels?.find((item) => (
    item.channel === 'whatsapp_web' && item.authorized && item.consentStatus === 'granted'
  ));
  if (!identity) {
    throw new ApiError(
      409,
      'O contato ainda nao autorizou respostas pelo WhatsApp Web',
      null,
      'CHANNEL_NOT_AUTHORIZED'
    );
  }
  return known;
}

async function messages(chatId, limit) {
  await ensureNotExpired();
  await assertKnownChat(chatId);
  return webService.getMessages(chatId, limit);
}

async function syncOneChat(chat, options, control) {
  const result = { contacts: 0, recoveredMessages: 0, failures: 0, timedOut: 0 };
  let existing = await contactsManager.findByChannelAddress('whatsapp_web', chat.id)
    || await contactsManager.findByChannelOrPhone('whatsapp_web', chat.id, chat.phone);
  let recent = [];
  try {
    recent = await withinSyncTimeout(
      () => webService.getMessages(chat.id, options.historyLimit, { timeoutMs: options.historyTimeoutMs }),
      options.historyTimeoutMs,
      'history'
    );
  } catch (error) {
    result.failures += 1;
    if (isSyncTimeout(error)) result.timedOut += 1;
    await writeSyncLog({
      level: 'warn', channel: 'whatsapp_web', action: 'sync.history_failed',
      message: 'Nao foi possivel consultar o historico recente de um chat',
      context: { chatId: chat.id, code: error.code, stage: error.stage, error: error.message }
    }, options);
  }
  if (control.cancelled) return result;

  const inbound = recent.filter((message) => !message.fromMe);
  if (!inbound.length && !existing) return result;
  for (const message of inbound) {
    if (control.cancelled) return result;
    const incoming = await processIncoming({
      ...message,
      from: chat.id,
      // O resumo do chat ja contem a foto em cache. Evita repetir uma chamada
      // Puppeteer potencialmente lenta para cada mensagem do historico.
      contactAvatarUrl: chat.imageUrl || null,
      skipProfileLookup: true,
      contactData: {
        id: { _serialized: chat.id },
        number: chat.phone,
        pushname: chat.name || chat.phone || chat.id
      }
    });
    if (!incoming?.ignored && !incoming?.duplicate) result.recoveredMessages += 1;
  }
  if (control.cancelled) return result;

  existing = await contactsManager.findByChannelAddress('whatsapp_web', chat.id)
    || await contactsManager.findByChannelOrPhone('whatsapp_web', chat.id, chat.phone);
  const existingIdentity = existing?.channels?.find((item) => item.channel === 'whatsapp_web');
  const authorized = Boolean(existingIdentity?.authorized && existingIdentity?.consentStatus === 'granted');
  let avatarUrl = chat.imageUrl || null;
  if (!avatarUrl) {
    try {
      avatarUrl = await withinSyncTimeout(
        () => webService.getProfilePicUrl(chat.id, { timeoutMs: options.avatarTimeoutMs }),
        options.avatarTimeoutMs,
        'avatar'
      );
    } catch (error) {
      result.failures += 1;
      if (isSyncTimeout(error)) result.timedOut += 1;
      await writeSyncLog({
        level: 'warn', channel: 'whatsapp_web', action: 'sync.avatar_failed',
        message: 'O contato foi sincronizado sem atualizar a foto de perfil',
        context: { chatId: chat.id, code: error.code, stage: error.stage, error: error.message }
      }, options);
    }
  }
  if (control.cancelled) return result;

  const contact = await contactsManager.upsertFromChannel({
    channel: 'whatsapp_web', address: chat.id, displayName: chat.name || chat.phone,
    phone: chat.phone, avatarUrl, source: 'whatsapp_web_sync', authorize: authorized,
    consentStatus: authorized ? 'granted' : undefined
  });
  if (contact.upsertState?.created) {
    await notifyNewContact(contact, { source: 'sync', permissionGranted: authorized });
  }
  await conversationsManager.upsertConversation({
    channel: 'whatsapp_web', externalId: chat.id, contactId: contact.id,
    displayName: chat.name || chat.phone, avatarUrl, isGroup: false
  });
  result.contacts = 1;
  return result;
}

async function performSyncChats(rawOptions = {}) {
  const options = syncOptions(rawOptions);
  const startedAt = Date.now();
  const deadline = startedAt + options.totalTimeoutMs;
  let list;
  try {
    list = await withinSyncTimeout(
      () => webService.listChats(options.chatLimit, { timeoutMs: options.listTimeoutMs }),
      Math.min(options.listTimeoutMs, options.totalTimeoutMs),
      'chat_list'
    );
    list = list.filter((item) => !item.isGroup);
  } catch (error) {
    await writeSyncLog({
      level: 'warn',
      channel: 'whatsapp_web',
      action: 'sync.provider_unavailable',
      message: 'A sessao continua conectada, mas os chats nao puderam ser consultados',
      context: { code: error.code, stage: error.stage, error: error.message }
    }, options);
    return {
      contacts: 0,
      recoveredMessages: 0,
      failures: 1,
      timedOut: isSyncTimeout(error) ? 1 : 0,
      total: 0,
      processed: 0,
      remaining: 0,
      partial: true,
      degraded: true,
      durationMs: Date.now() - startedAt
    };
  }

  const summary = {
    contacts: 0,
    recoveredMessages: 0,
    failures: 0,
    timedOut: 0,
    total: list.length,
    processed: 0,
    remaining: 0,
    partial: false,
    degraded: false,
    durationMs: 0
  };
  let cursor = 0;
  const worker = async () => {
    while (Date.now() < deadline) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      const chat = list[index];
      const control = { cancelled: false };
      const remainingBudget = Math.max(1, deadline - Date.now());
      try {
        const result = await withinSyncTimeout(
          () => syncOneChat(chat, options, control),
          Math.min(options.chatTimeoutMs, remainingBudget),
          'chat'
        );
        summary.contacts += result.contacts;
        summary.recoveredMessages += result.recoveredMessages;
        summary.failures += result.failures;
        summary.timedOut += result.timedOut;
      } catch (error) {
        control.cancelled = true;
        summary.failures += 1;
        if (isSyncTimeout(error)) summary.timedOut += 1;
        await writeSyncLog({
          level: 'warn', channel: 'whatsapp_web', action: 'sync.chat_failed',
          message: 'Um chat nao pode ser sincronizado; os demais continuaram normalmente',
          context: { chatId: chat.id, code: error.code, stage: error.stage, error: error.message }
        }, options);
      } finally {
        summary.processed += 1;
      }
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(options.concurrency, Math.max(1, list.length)) },
    () => worker()
  ));
  summary.remaining = Math.max(0, list.length - summary.processed);
  summary.partial = summary.failures > 0 || summary.remaining > 0;
  summary.degraded = summary.partial;
  summary.durationMs = Date.now() - startedAt;
  if (summary.remaining > 0) {
    await writeSyncLog({
      level: 'warn', channel: 'whatsapp_web', action: 'sync.budget_exhausted',
      message: 'A sincronizacao retornou parcialmente para respeitar o tempo limite da requisicao',
      context: { processed: summary.processed, remaining: summary.remaining, total: summary.total }
    }, options);
  }
  return summary;
}

async function syncChats(options = {}) {
  // Reutiliza a mesma execucao para cliques duplicados, evitando duas varreduras
  // concorrentes sobre a mesma pagina do WhatsApp Web.
  if (activeSyncRun) return activeSyncRun;
  const run = performSyncChats(options);
  activeSyncRun = run;
  try {
    return await run;
  } finally {
    if (activeSyncRun === run) activeSyncRun = undefined;
  }
}

async function send(input) {
  if (input.groupId) {
    throw new ApiError(422, 'WhatsApp Web permite resposta somente em chat individual', null, 'WHATSAPP_WEB_DIRECT_ONLY');
  }
  await ensureNotExpired();
  const currentStatus = await status();
  if (!currentStatus.ready) {
    throw new ApiError(503, 'Sessao do WhatsApp Web nao autenticada', null, 'WHATSAPP_WEB_NOT_READY');
  }
  let destination = input.destination;
  let destinationContact;
  if (!destination && input.contactId) {
    const resolved = await contactsManager.getDestination(input.contactId, 'whatsapp_web');
    destination = resolved.address;
    destinationContact = resolved.contact;
  }
  if (destination) {
    const knownChat = await assertAuthorizedChat(destination);
    destinationContact = knownChat.value;
  }
  const text = input.text || input.body;
  if (!destination || !text) throw new ApiError(422, 'Destino e texto obrigatorios');
  const result = await webService.sendMessage(destination, text, input.payload || {});
  await logsManager.create({ channel: 'whatsapp_web', action: 'message.sent', message: 'Mensagem WhatsApp Web enviada', context: { contactId: input.contactId || destinationContact?.id, providerMessageId: result.providerMessageId } });
  try {
    await conversationsManager.recordOutbound({
      channel: 'whatsapp_web',
      externalId: result.chatId,
      contactId: input.contactId || destinationContact?.id,
      displayName: destinationContact?.displayName,
      avatarUrl: destinationContact?.avatarUrl,
      isGroup: false,
      providerMessageId: result.providerMessageId,
      body: text,
      type: 'chat',
      sentAt: new Date()
    });
  } catch (error) {
    await logsManager.create({ level: 'warn', channel: 'whatsapp_web', action: 'conversation.store_failed', message: 'Mensagem enviada, mas o historico local nao foi atualizado', context: { error: error.message } }).catch(() => undefined);
  }
  return result;
}

async function logout() {
  const before = webService.snapshot();
  const result = await webService.logout();
  await clearAuthenticatedAt();
  if (before.ready || before.state === 'authenticated') {
    await logsManager.create({ channel: 'whatsapp_web', action: 'logout', message: 'Sessao WhatsApp Web encerrada' });
  }
  return result;
}

async function shutdown() {
  return webService.destroy();
}

module.exports = { initialize, resume, regenerate, status, chats, messages, syncChats, send, logout, shutdown, processIncoming };
