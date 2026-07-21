const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const EventEmitter = require('node:events');
const { env } = require('../src/config/env');
const webService = require('../src/services/whatsapp-web.service');
const webManager = require('../src/managers/whatsapp-web.manager');
const settingsManager = require('../src/managers/settings.manager');
const logsManager = require('../src/managers/logs.manager');
const contactsManager = require('../src/managers/contacts.manager');
const conversationsManager = require('../src/managers/conversations.manager');

test('WhatsApp Web remove apenas locks obsoletos do Chromium antes de gerar QR', async (context) => {
  const originalAuthPath = env.whatsappWebAuthPath;
  const relativeRoot = '.tmp-wweb-lock-test-' + process.pid;
  const root = path.resolve(process.cwd(), relativeRoot);
  const session = path.join(root, 'session');
  context.after(async () => {
    env.whatsappWebAuthPath = originalAuthPath;
    await fs.rm(root, { recursive: true, force: true });
  });

  env.whatsappWebAuthPath = relativeRoot;
  await fs.mkdir(path.join(session, 'Default'), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(session, 'SingletonLock'), 'container-antigo'),
    fs.writeFile(path.join(session, 'SingletonSocket'), 'socket-antigo'),
    fs.writeFile(path.join(session, 'SingletonCookie'), 'cookie-antigo'),
    fs.writeFile(path.join(session, 'Default', 'Preferences'), '{"preservado":true}')
  ]);

  const result = await webService.clearStaleBrowserLocks();

  assert.equal(result.removed, 3);
  for (const artifact of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    await assert.rejects(() => fs.stat(path.join(session, artifact)), (error) => error.code === 'ENOENT');
  }
  assert.equal(await fs.readFile(path.join(session, 'Default', 'Preferences'), 'utf8'), '{"preservado":true}');
});

test('WhatsApp Web preserva lock quando o Chromium do perfil ainda esta ativo', async (context) => {
  const originalAuthPath = env.whatsappWebAuthPath;
  const relativeRoot = '.tmp-wweb-active-lock-test-' + process.pid;
  const root = path.resolve(process.cwd(), relativeRoot);
  const session = path.join(root, 'session');
  context.after(async () => {
    env.whatsappWebAuthPath = originalAuthPath;
    await fs.rm(root, { recursive: true, force: true });
  });

  env.whatsappWebAuthPath = relativeRoot;
  await fs.mkdir(session, { recursive: true });
  try {
    await fs.symlink(os.hostname() + '-' + process.pid, path.join(session, 'SingletonLock'));
  } catch (error) {
    if (error.code === 'EPERM') {
      context.skip('O Windows atual nao permite criar symlink sem elevacao');
      return;
    }
    throw error;
  }

  await assert.rejects(
    () => webService.clearStaleBrowserLocks(),
    (error) => error.code === 'WHATSAPP_WEB_PROFILE_ACTIVE'
  );
  assert.equal((await fs.lstat(path.join(session, 'SingletonLock'))).isSymbolicLink(), true);
});

test('resume do WhatsApp Web nao inicia Chromium sem sessao autenticada', async (context) => {
  const originals = {
    getValue: settingsManager.getValue,
    initialize: webService.initialize,
    snapshot: webService.snapshot
  };
  context.after(() => {
    settingsManager.getValue = originals.getValue;
    webService.initialize = originals.initialize;
    webService.snapshot = originals.snapshot;
  });

  settingsManager.getValue = async () => null;
  webService.snapshot = () => ({
    initialized: false,
    ready: false,
    state: 'not_initialized',
    qrCode: null,
    attemptActive: false,
    updatedAt: '2026-07-21T00:00:00.000Z',
    lastError: null
  });
  let calls = 0;
  webService.initialize = async () => { calls += 1; };

  const result = await webManager.resume();

  assert.equal(calls, 0);
  assert.equal(result.state, 'not_initialized');
  assert.equal(result.ready, false);
});

test('logs de erro do WhatsApp Web so nascem de tentativa explicita', async (context) => {
  const originals = {
    getValue: settingsManager.getValue,
    initialize: webService.initialize,
    log: logsManager.create
  };
  context.after(() => {
    settingsManager.getValue = originals.getValue;
    webService.initialize = originals.initialize;
    logsManager.create = originals.log;
  });

  settingsManager.getValue = async () => null;
  const logs = [];
  logsManager.create = async (entry) => { logs.push(entry); return entry; };
  let receivedHandlers;
  let receivedOptions;
  webService.initialize = async (handlers, options) => {
    receivedHandlers = handlers;
    receivedOptions = options;
    return { initialized: true, ready: false, state: 'initializing' };
  };

  await webManager.initialize({ explicit: false });
  assert.equal(receivedOptions.explicit, false);
  await receivedHandlers.onError(new Error('falha silenciosa de retomada'));
  assert.equal(logs.length, 0);

  await webManager.initialize({ explicit: true });
  assert.equal(receivedOptions.explicit, true);
  await receivedHandlers.onError(new Error('falha da tentativa manual'));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].channel, 'whatsapp_web');
  assert.equal(logs[0].action, 'error');
});

test('ciclo do cliente publica QR, status, ready e desconexao em tempo real', async (context) => {
  const servicePath = require.resolve('../src/services/whatsapp-web.service');
  const whatsappModulePath = require.resolve('whatsapp-web.js');
  const originalServiceCache = require.cache[servicePath];
  const originalWhatsappCache = require.cache[whatsappModulePath];
  const socketService = require('../src/services/socket.service');
  const qrCode = require('qrcode');
  const originalEmit = socketService.emit;
  const originalToDataUrl = qrCode.toDataURL;
  const originalAuthPath = env.whatsappWebAuthPath;
  const relativeRoot = '.tmp-wweb-events-test-' + process.pid;
  const root = path.resolve(process.cwd(), relativeRoot);
  let fakeClient;

  class FakeClient extends EventEmitter {
    constructor() {
      super();
      fakeClient = this;
      this.pupPage = { evaluate: async () => true };
    }

    initialize() { return new Promise(() => undefined); }
    async logout() {}
    async destroy() {}
  }

  context.after(async () => {
    socketService.emit = originalEmit;
    qrCode.toDataURL = originalToDataUrl;
    env.whatsappWebAuthPath = originalAuthPath;
    if (originalServiceCache) require.cache[servicePath] = originalServiceCache;
    else delete require.cache[servicePath];
    if (originalWhatsappCache) require.cache[whatsappModulePath] = originalWhatsappCache;
    else delete require.cache[whatsappModulePath];
    await fs.rm(root, { recursive: true, force: true });
  });

  const socketEvents = [];
  socketService.emit = (event, payload) => socketEvents.push({ event, payload });
  qrCode.toDataURL = async () => 'data:image/png;base64,qr-test';
  env.whatsappWebAuthPath = relativeRoot;
  require.cache[whatsappModulePath] = {
    id: whatsappModulePath,
    filename: whatsappModulePath,
    loaded: true,
    exports: { Client: FakeClient, LocalAuth: class LocalAuth {} }
  };
  delete require.cache[servicePath];
  const freshService = require('../src/services/whatsapp-web.service');

  const initial = await freshService.initialize({}, { explicit: true });
  assert.equal(initial.state, 'initializing');
  assert.equal(initial.attemptActive, true);

  fakeClient.emit('qr', 'qr-raw');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(freshService.snapshot().state, 'qr');
  assert.equal(freshService.snapshot().qrCode, 'data:image/png;base64,qr-test');

  fakeClient.emit('authenticated');
  fakeClient.emit('ready');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(freshService.snapshot().ready, true);
  assert.equal(freshService.snapshot().attemptActive, false);

  await freshService.logout();
  assert.equal(freshService.snapshot().state, 'not_initialized');
  assert.ok(socketEvents.some((item) => item.event === 'whatsapp_web:qr' && item.payload.qrCode === 'data:image/png;base64,qr-test'));
  assert.ok(socketEvents.some((item) => item.event === 'whatsapp_web:ready' && item.payload.ready === true));
  assert.ok(socketEvents.some((item) => item.event === 'whatsapp_web:disconnected' && item.payload.reason === 'manual'));
  assert.ok(socketEvents.filter((item) => item.event === 'whatsapp_web:status').length >= 4);
});

test('shim restaura _serialized a partir de $1 nos identificadores da versao atual do WhatsApp Web', async () => {
  class FakeMsgKey {
    constructor(value) { this.$1 = value; }
  }
  const page = {
    WWebJS: {
      getMessageModel: (message) => ({ id: { ...message.id } })
    },
    require: (name) => {
      if (name === 'WAWebMsgKey') return FakeMsgKey;
      throw new Error('Modulo inesperado: ' + name);
    }
  };
  const target = {
    pupPage: {
      evaluate: async (operation) => {
        const previous = globalThis.window;
        globalThis.window = page;
        try { return await operation(); } finally { globalThis.window = previous; }
      }
    }
  };

  await webService.ensureCompatibility(target);

  const rawKey = new FakeMsgKey('false_274985348251713@lid_ABC123');
  assert.equal(rawKey._serialized, 'false_274985348251713@lid_ABC123');
  const serialized = page.WWebJS.getMessageModel({ id: { $1: 'false_274985348251713@lid_DEF456' } });
  assert.equal(serialized.id._serialized, 'false_274985348251713@lid_DEF456');
});

test('service limita historico e avatar travados dentro da pagina sem acionar fallback lento', async (context) => {
  const servicePath = require.resolve('../src/services/whatsapp-web.service');
  const whatsappModulePath = require.resolve('whatsapp-web.js');
  const originalServiceCache = require.cache[servicePath];
  const originalWhatsappCache = require.cache[whatsappModulePath];
  const originalAuthPath = env.whatsappWebAuthPath;
  const relativeRoot = '.tmp-wweb-history-timeout-' + process.pid;
  const root = path.resolve(process.cwd(), relativeRoot);
  let fakeClient;
  let fallbackCalls = 0;
  let avatarFallbackCalls = 0;

  const chat = { msgs: { getModelsArray: () => [] } };
  const page = {
    WWebJS: { getMessageModel: (message) => ({ ...message }), getMsgKeyId: () => null },
    require: (name) => {
      if (name === 'WAWebMsgKey') return class FakeMsgKey {};
      if (name === 'WAWebWidFactory') return { createWid: (value) => value };
      if (name === 'WAWebCollections') {
        return { Chat: { getModelsArray: () => [], get: () => chat } };
      }
      if (name === 'WAWebFindChatAction') return { findOrCreateLatestChat: async () => ({ chat }) };
      if (name === 'WAWebChatLoadMessages') return { loadEarlierMsgs: () => new Promise(() => undefined) };
      if (name === 'WAWebContactProfilePicThumbBridge') {
        return { requestProfilePicFromServer: () => new Promise(() => undefined) };
      }
      throw new Error('Modulo inesperado: ' + name);
    }
  };

  class FakeClient extends EventEmitter {
    constructor() {
      super();
      fakeClient = this;
      this.pupPage = {
        evaluate: async (operation, ...args) => {
          const previous = globalThis.window;
          globalThis.window = page;
          try { return await operation(...args); } finally { globalThis.window = previous; }
        }
      };
    }

    initialize() { return new Promise(() => undefined); }
    async logout() {}
    async destroy() {}
    async getChatById() { fallbackCalls += 1; return null; }
    async getProfilePicUrl() { avatarFallbackCalls += 1; return null; }
  }

  context.after(async () => {
    env.whatsappWebAuthPath = originalAuthPath;
    if (originalServiceCache) require.cache[servicePath] = originalServiceCache;
    else delete require.cache[servicePath];
    if (originalWhatsappCache) require.cache[whatsappModulePath] = originalWhatsappCache;
    else delete require.cache[whatsappModulePath];
    await fs.rm(root, { recursive: true, force: true });
  });

  env.whatsappWebAuthPath = relativeRoot;
  require.cache[whatsappModulePath] = {
    id: whatsappModulePath,
    filename: whatsappModulePath,
    loaded: true,
    exports: { Client: FakeClient, LocalAuth: class LocalAuth {} }
  };
  delete require.cache[servicePath];
  const freshService = require('../src/services/whatsapp-web.service');
  await freshService.initialize({}, { explicit: true });
  fakeClient.emit('ready');
  await new Promise((resolve) => setImmediate(resolve));

  const startedAt = Date.now();
  await assert.rejects(
    () => freshService.getMessages('551199999999@c.us', 25, { timeoutMs: 150 }),
    (error) => error.code === 'WHATSAPP_WEB_PROVIDER_TIMEOUT' && error.stage === 'history'
  );
  assert.ok(Date.now() - startedAt < 350);
  assert.equal(fallbackCalls, 0);
  await assert.rejects(
    () => freshService.getProfilePicUrl('551199999999@c.us', { timeoutMs: 150 }),
    (error) => error.code === 'WHATSAPP_WEB_PROVIDER_TIMEOUT' && error.stage === 'avatar'
  );
  assert.equal(avatarFallbackCalls, 0);
  await freshService.destroy();
});

test('rota de regeneracao de QR permanece separada do inicio recuperavel', () => {
  const { router } = require('../src/routes/whatsapp-web.routes');
  const routes = router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({ path: layer.route.path, methods: layer.route.methods }));

  assert.ok(routes.some((route) => route.path === '/session' && route.methods.post));
  assert.ok(routes.some((route) => route.path === '/session/regenerate' && route.methods.post));
  assert.ok(routes.some((route) => route.path === '/session' && route.methods.delete));
});

test('sync limita historico travado e ainda conclui os demais chats com resultado parcial', async (context) => {
  const originals = {
    listChats: webService.listChats,
    getMessages: webService.getMessages,
    getProfilePicUrl: webService.getProfilePicUrl,
    findByChannelAddress: contactsManager.findByChannelAddress,
    findByChannelOrPhone: contactsManager.findByChannelOrPhone,
    upsertFromChannel: contactsManager.upsertFromChannel,
    upsertConversation: conversationsManager.upsertConversation,
    log: logsManager.create
  };
  context.after(() => Object.assign(webService, {
    listChats: originals.listChats,
    getMessages: originals.getMessages,
    getProfilePicUrl: originals.getProfilePicUrl
  }) && Object.assign(contactsManager, {
    findByChannelAddress: originals.findByChannelAddress,
    findByChannelOrPhone: originals.findByChannelOrPhone,
    upsertFromChannel: originals.upsertFromChannel
  }) && Object.assign(conversationsManager, { upsertConversation: originals.upsertConversation })
    && Object.assign(logsManager, { create: originals.log }));

  const chats = [
    { id: 'travado@c.us', phone: '551100000001', name: 'Travado', imageUrl: 'https://example.test/a.jpg' },
    { id: 'rapido@c.us', phone: '551100000002', name: 'Rapido', imageUrl: 'https://example.test/b.jpg' }
  ];
  webService.listChats = async () => chats;
  webService.getMessages = (chatId) => chatId === 'travado@c.us'
    ? new Promise(() => undefined)
    : Promise.resolve([]);
  let profileCalls = 0;
  webService.getProfilePicUrl = async () => { profileCalls += 1; return null; };
  const known = (chatId) => ({
    id: 'contact-' + chatId,
    displayName: chatId,
    channels: [{ channel: 'whatsapp_web', authorized: false, consentStatus: 'unknown' }]
  });
  contactsManager.findByChannelAddress = async (_channel, chatId) => known(chatId);
  contactsManager.findByChannelOrPhone = async (_channel, chatId) => known(chatId);
  contactsManager.upsertFromChannel = async (input) => ({ ...known(input.address), upsertState: { created: false } });
  conversationsManager.upsertConversation = async () => ({});
  logsManager.create = async () => ({});

  const startedAt = Date.now();
  const result = await webManager.syncChats({
    concurrency: 2,
    historyTimeoutMs: 30,
    avatarTimeoutMs: 30,
    chatTimeoutMs: 100,
    totalTimeoutMs: 250,
    logTimeoutMs: 30
  });

  assert.ok(Date.now() - startedAt < 200);
  assert.equal(result.total, 2);
  assert.equal(result.processed, 2);
  assert.equal(result.contacts, 2);
  assert.equal(result.failures, 1);
  assert.equal(result.timedOut, 1);
  assert.equal(result.partial, true);
  assert.equal(result.degraded, true);
  assert.equal(profileCalls, 0);
});

test('sync compartilha a varredura ativa entre requisicoes simultaneas', async (context) => {
  const originalListChats = webService.listChats;
  context.after(() => { webService.listChats = originalListChats; });
  let calls = 0;
  webService.listChats = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 35));
    return [];
  };

  const [first, second] = await Promise.all([
    webManager.syncChats({ listTimeoutMs: 100, totalTimeoutMs: 200 }),
    webManager.syncChats({ listTimeoutMs: 100, totalTimeoutMs: 200 })
  ]);

  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.equal(first.partial, false);
});

test('sync respeita o orcamento total e informa chats ainda nao tentados', async (context) => {
  const originals = { listChats: webService.listChats, getMessages: webService.getMessages, log: logsManager.create };
  context.after(() => Object.assign(webService, {
    listChats: originals.listChats,
    getMessages: originals.getMessages
  }) && Object.assign(logsManager, { create: originals.log }));
  webService.listChats = async () => Array.from({ length: 20 }, (_, index) => ({
    id: `pendente-${index}@c.us`, phone: `55119999${String(index).padStart(4, '0')}`,
    name: `Pendente ${index}`, imageUrl: null, isGroup: false
  }));
  webService.getMessages = async () => new Promise(() => undefined);
  logsManager.create = async () => ({});

  const startedAt = Date.now();
  const result = await webManager.syncChats({
    concurrency: 2,
    historyTimeoutMs: 1_000,
    chatTimeoutMs: 70,
    totalTimeoutMs: 120,
    logTimeoutMs: 25
  });

  assert.ok(Date.now() - startedAt < 250);
  assert.equal(result.total, 20);
  assert.ok(result.processed >= 2 && result.processed < 20);
  assert.equal(result.remaining, result.total - result.processed);
  assert.ok(result.timedOut >= 2);
  assert.equal(result.partial, true);
});
