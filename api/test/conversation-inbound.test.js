const test = require('node:test');
const assert = require('node:assert/strict');
const settingsManager = require('../src/managers/settings.manager');
const contactsManager = require('../src/managers/contacts.manager');
const logsManager = require('../src/managers/logs.manager');
const conversationsManager = require('../src/managers/conversations.manager');
const adminNotificationsManager = require('../src/managers/admin-notifications.manager');
const socketService = require('../src/services/socket.service');
const whatsappWebService = require('../src/services/whatsapp-web.service');
const telegramManager = require('../src/managers/telegram.manager');
const whatsappWebManager = require('../src/managers/whatsapp-web.manager');

const originalWhatsappWebSnapshot = whatsappWebService.snapshot;
test.beforeEach(() => {
  whatsappWebService.snapshot = () => ({ initialized: true, ready: true, state: 'ready' });
});
test.afterEach(() => {
  whatsappWebService.snapshot = originalWhatsappWebSnapshot;
});

test('Telegram cria contato, conversa e aviso administrativo somente no primeiro inbound', async (context) => {
  const originals = {
    setting: settingsManager.getValue,
    find: contactsManager.findByChannelAddress,
    upsert: contactsManager.upsertFromChannel,
    log: logsManager.create,
    record: conversationsManager.recordInbound,
    notify: adminNotificationsManager.create,
    emit: socketService.emit
  };
  context.after(() => {
    settingsManager.getValue = originals.setting;
    contactsManager.findByChannelAddress = originals.find;
    contactsManager.upsertFromChannel = originals.upsert;
    logsManager.create = originals.log;
    conversationsManager.recordInbound = originals.record;
    adminNotificationsManager.create = originals.notify;
    socketService.emit = originals.emit;
  });
  settingsManager.getValue = async () => 'webhook-secret';
  contactsManager.findByChannelAddress = async () => null;
  let contactInput;
  contactsManager.upsertFromChannel = async (input) => {
    contactInput = input;
    return { id: '507f1f77bcf86cd799439011', displayName: 'Ana' };
  };
  logsManager.create = async () => ({});
  let conversationInput;
  conversationsManager.recordInbound = async (input) => {
    conversationInput = input;
    return { conversation: { id: '507f1f77bcf86cd799439021' } };
  };
  const notices = [];
  adminNotificationsManager.create = async (input) => { notices.push(input); return input; };
  socketService.emit = () => undefined;

  await telegramManager.webhook({
    update_id: 2_026_072_100,
    message: {
      message_id: 77,
      date: 1_753_056_000,
      text: 'Oi',
      chat: { id: 123, type: 'private' },
      from: { id: 123, first_name: 'Ana', photo_url: 'https://cdn.example/ana.jpg' }
    }
  }, 'webhook-secret');

  assert.equal(contactInput.authorize, true);
  assert.equal(contactInput.avatarUrl, 'https://cdn.example/ana.jpg');
  assert.equal(conversationInput.contactId, '507f1f77bcf86cd799439011');
  assert.equal(conversationInput.body, 'Oi');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].kind, 'contact_auto_created');
  assert.equal(notices[0].channel, 'telegram');
});

test('WhatsApp Web cadastra chat privado com o comando mesmo quando getChat do provider falha', async (context) => {
  const originals = {
    profile: whatsappWebService.getProfilePicUrl,
    permission: settingsManager.isWhatsappPermissionCommand,
    find: contactsManager.findByChannelAddress,
    findByPhone: contactsManager.findByChannelOrPhone,
    upsert: contactsManager.upsertFromChannel,
    attach: conversationsManager.attachContact,
    log: logsManager.create,
    record: conversationsManager.recordInbound,
    notify: adminNotificationsManager.create
  };
  context.after(() => {
    whatsappWebService.getProfilePicUrl = originals.profile;
    settingsManager.isWhatsappPermissionCommand = originals.permission;
    contactsManager.findByChannelAddress = originals.find;
    contactsManager.findByChannelOrPhone = originals.findByPhone;
    contactsManager.upsertFromChannel = originals.upsert;
    conversationsManager.attachContact = originals.attach;
    logsManager.create = originals.log;
    conversationsManager.recordInbound = originals.record;
    adminNotificationsManager.create = originals.notify;
  });
  whatsappWebService.getProfilePicUrl = async () => null;
  settingsManager.isWhatsappPermissionCommand = async (value) => value === '/notify-me';
  contactsManager.findByChannelAddress = async () => null;
  contactsManager.findByChannelOrPhone = async () => null;
  let contactInput;
  contactsManager.upsertFromChannel = async (input) => {
    contactInput = input;
    return { id: '507f1f77bcf86cd799439012', displayName: 'Bruno' };
  };
  let attached;
  conversationsManager.attachContact = async (...args) => {
    attached = args;
    return { id: '507f1f77bcf86cd799439022', contactId: '507f1f77bcf86cd799439012' };
  };
  logsManager.create = async () => ({});
  let conversationInput;
  conversationsManager.recordInbound = async (input) => {
    conversationInput = input;
    return { conversation: { id: '507f1f77bcf86cd799439022' } };
  };
  const notices = [];
  adminNotificationsManager.create = async (input) => { notices.push(input); return input; };

  await whatsappWebManager.processIncoming({
    fromMe: false,
    from: '556199999999@c.us',
    body: '/notify-me',
    type: 'chat',
    hasMedia: false,
    timestamp: 1_753_056_000,
    id: { _serialized: 'wamid-web-1' },
    getChat: async () => { throw new Error('r: r'); },
    getContact: async () => ({ id: { _serialized: '556199999999@c.us' }, pushname: 'Bruno', number: '556199999999' })
  });

  assert.equal(contactInput.phone, '556199999999');
  assert.equal(contactInput.source, 'whatsapp_web_permission_command');
  assert.equal(contactInput.authorize, true);
  assert.equal(contactInput.consentStatus, 'granted');
  assert.equal(contactInput.consentSource, 'automatic_permission_command');
  assert.equal(contactInput.consentCommand, '/notify-me');
  assert.equal(contactInput.shareWhatsappConsent, true);
  assert.equal(contactInput.metadata.permissionCommandReceivedVia, 'whatsapp_web');
  assert.equal(contactInput.metadata.sharedWhatsappConsent, true);
  assert.equal(contactInput.metadata.chatId, '556199999999@c.us');
  assert.deepEqual(attached.slice(0, 3), [
    'whatsapp_web',
    '556199999999@c.us',
    '507f1f77bcf86cd799439012'
  ]);
  assert.equal(conversationInput.externalId, '556199999999@c.us');
  assert.equal(conversationInput.contactId, '507f1f77bcf86cd799439012');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].channel, 'whatsapp_web');
});

test('WhatsApp Web exibe inbox temporaria de desconhecido sem criar contato ou consentimento', async (context) => {
  const originals = {
    profile: whatsappWebService.getProfilePicUrl,
    permission: settingsManager.isWhatsappPermissionCommand,
    find: contactsManager.findByChannelAddress,
    findByPhone: contactsManager.findByChannelOrPhone,
    upsert: contactsManager.upsertFromChannel,
    log: logsManager.create,
    record: conversationsManager.recordInbound,
    notify: adminNotificationsManager.create,
    emit: socketService.emit
  };
  context.after(() => {
    whatsappWebService.getProfilePicUrl = originals.profile;
    settingsManager.isWhatsappPermissionCommand = originals.permission;
    contactsManager.findByChannelAddress = originals.find;
    contactsManager.findByChannelOrPhone = originals.findByPhone;
    contactsManager.upsertFromChannel = originals.upsert;
    logsManager.create = originals.log;
    conversationsManager.recordInbound = originals.record;
    adminNotificationsManager.create = originals.notify;
    socketService.emit = originals.emit;
  });
  settingsManager.isWhatsappPermissionCommand = async () => false;
  let profileCalls = 0;
  whatsappWebService.getProfilePicUrl = async () => { profileCalls += 1; return 'https://cdn.example/pending.jpg'; };
  contactsManager.findByChannelAddress = async () => null;
  contactsManager.findByChannelOrPhone = async () => null;
  let contactWrites = 0;
  contactsManager.upsertFromChannel = async () => { contactWrites += 1; return {}; };
  let conversationWrites = 0;
  let pendingInput;
  conversationsManager.recordInbound = async (input) => {
    conversationWrites += 1;
    pendingInput = input;
    return {
      conversation: { id: '507f1f77bcf86cd799439066', channel: 'whatsapp_web', contactId: null },
      message: { id: '507f1f77bcf86cd799439067', body: input.body },
      duplicate: false
    };
  };
  let notices = 0;
  adminNotificationsManager.create = async () => { notices += 1; return {}; };
  let logs = 0;
  logsManager.create = async () => { logs += 1; return {}; };
  const socketEvents = [];
  socketService.emit = (event, payload) => { socketEvents.push({ event, payload }); };

  const result = await whatsappWebManager.processIncoming({
    fromMe: false,
    from: '556188888888@c.us',
    body: 'Ola, quero informacoes',
    type: 'chat',
    id: { _serialized: 'wamid-web-without-permission' },
    getChat: async () => ({ isGroup: false, id: { _serialized: '556188888888@c.us' } }),
    getContact: async () => ({ id: { _serialized: '556188888888@c.us' }, number: '556188888888' })
  });

  assert.equal(result.ignored, false);
  assert.equal(result.pendingRegistration, true);
  assert.equal(result.permissionRequired, true);
  assert.equal(profileCalls, 1);
  assert.equal(contactWrites, 0);
  assert.equal(conversationWrites, 1);
  assert.equal(pendingInput.contactId, undefined);
  assert.equal(pendingInput.externalId, '556188888888@c.us');
  assert.equal(pendingInput.avatarUrl, 'https://cdn.example/pending.jpg');
  assert.equal(notices, 0);
  assert.equal(logs, 1);
  assert.deepEqual(socketEvents.map((item) => item.event), [
    'whatsapp_web:permission_required',
    'whatsapp_web:message'
  ]);
  assert.equal(socketEvents[1].payload.entityId, null);
});

test('WhatsApp Web descarta evento que disputa com desconexao antes do ready', async (context) => {
  const originals = {
    permission: settingsManager.isWhatsappPermissionCommand,
    find: contactsManager.findByChannelAddress,
    record: conversationsManager.recordInbound
  };
  context.after(() => {
    settingsManager.isWhatsappPermissionCommand = originals.permission;
    contactsManager.findByChannelAddress = originals.find;
    conversationsManager.recordInbound = originals.record;
  });
  whatsappWebService.snapshot = () => ({ initialized: true, ready: false, state: 'disconnected' });
  let sideEffects = 0;
  settingsManager.isWhatsappPermissionCommand = async () => { sideEffects += 1; return true; };
  contactsManager.findByChannelAddress = async () => { sideEffects += 1; return null; };
  conversationsManager.recordInbound = async () => { sideEffects += 1; return {}; };

  const result = await whatsappWebManager.processIncoming({
    from: '556188888888@c.us',
    body: '/notify-me',
    id: { _serialized: 'event-after-disconnect' }
  });

  assert.deepEqual(result, { ignored: true, reason: 'session_not_ready' });
  assert.equal(sideEffects, 0);
});

test('WhatsApp Web conhecido sem consentimento permanece visivel e sem direito de resposta', async (context) => {
  const originals = {
    profile: whatsappWebService.getProfilePicUrl,
    permission: settingsManager.isWhatsappPermissionCommand,
    find: contactsManager.findByChannelAddress,
    findByPhone: contactsManager.findByChannelOrPhone,
    upsert: contactsManager.upsertFromChannel,
    record: conversationsManager.recordInbound,
    log: logsManager.create,
    notify: adminNotificationsManager.create,
    emit: socketService.emit
  };
  context.after(() => {
    whatsappWebService.getProfilePicUrl = originals.profile;
    settingsManager.isWhatsappPermissionCommand = originals.permission;
    contactsManager.findByChannelAddress = originals.find;
    contactsManager.findByChannelOrPhone = originals.findByPhone;
    contactsManager.upsertFromChannel = originals.upsert;
    conversationsManager.recordInbound = originals.record;
    logsManager.create = originals.log;
    adminNotificationsManager.create = originals.notify;
    socketService.emit = originals.emit;
  });

  settingsManager.isWhatsappPermissionCommand = async () => false;
  let consentStatus = 'unknown';
  const contact = () => ({
    id: '507f1f77bcf86cd799439055',
    channels: [{
      channel: 'whatsapp_web',
      address: '556177777777@c.us',
      authorized: false,
      consentStatus
    }]
  });
  contactsManager.findByChannelAddress = async () => contact();
  contactsManager.findByChannelOrPhone = async () => contact();
  let profileCalls = 0;
  whatsappWebService.getProfilePicUrl = async () => { profileCalls += 1; return null; };
  const upserts = [];
  contactsManager.upsertFromChannel = async (input) => {
    upserts.push(input);
    return { ...contact(), upsertState: { created: false, identityAdded: false } };
  };
  const records = [];
  conversationsManager.recordInbound = async (input) => {
    records.push(input);
    return {
      conversation: { id: `507f1f77bcf86cd7994390${records.length}1`, contactId: input.contactId },
      message: { id: `507f1f77bcf86cd7994390${records.length}2` },
      duplicate: false
    };
  };
  let logs = 0;
  logsManager.create = async () => { logs += 1; return {}; };
  let notices = 0;
  adminNotificationsManager.create = async () => { notices += 1; return {}; };
  const socketEvents = [];
  socketService.emit = (event) => { socketEvents.push(event); };

  for (const status of ['unknown', 'revoked']) {
    consentStatus = status;
    const result = await whatsappWebManager.processIncoming({
      from: '556177777777@c.us',
      body: 'Mensagem comum',
      id: { _serialized: `known-${status}` },
      getContact: async () => ({ id: { _serialized: '556177777777@c.us' }, number: '556177777777' })
    });
    assert.equal(result.ignored, false);
    assert.equal(result.permissionRequired, true);
    assert.equal(result.pendingRegistration, false);
  }
  assert.equal(profileCalls, 2);
  assert.equal(upserts.length, 2);
  assert.ok(upserts.every((input) => input.authorize === false && input.consentStatus === undefined));
  assert.equal(records.length, 2);
  assert.ok(records.every((input) => input.contactId === '507f1f77bcf86cd799439055'));
  assert.equal(logs, 2);
  assert.equal(notices, 0);
  assert.deepEqual(socketEvents, [
    'whatsapp_web:permission_required', 'whatsapp_web:message',
    'whatsapp_web:permission_required', 'whatsapp_web:message'
  ]);
});

test('WhatsApp Web persiste e emite mensagem somente para identidade ja autorizada', async (context) => {
  const originals = {
    permission: settingsManager.isWhatsappPermissionCommand,
    profile: whatsappWebService.getProfilePicUrl,
    find: contactsManager.findByChannelAddress,
    findByPhone: contactsManager.findByChannelOrPhone,
    upsertContact: contactsManager.upsertFromChannel,
    record: conversationsManager.recordInbound,
    log: logsManager.create,
    notify: adminNotificationsManager.create,
    emit: socketService.emit
  };
  context.after(() => {
    settingsManager.isWhatsappPermissionCommand = originals.permission;
    whatsappWebService.getProfilePicUrl = originals.profile;
    contactsManager.findByChannelAddress = originals.find;
    contactsManager.findByChannelOrPhone = originals.findByPhone;
    contactsManager.upsertFromChannel = originals.upsertContact;
    conversationsManager.recordInbound = originals.record;
    logsManager.create = originals.log;
    adminNotificationsManager.create = originals.notify;
    socketService.emit = originals.emit;
  });

  const chatId = '123456789012345@lid';
  settingsManager.isWhatsappPermissionCommand = async () => false;
  whatsappWebService.getProfilePicUrl = async () => 'https://cdn.example/samuel.jpg';
  const currentContact = {
    id: '507f1f77bcf86cd799439099',
    displayName: 'Samuel',
    channels: [{ channel: 'whatsapp_web', address: chatId, authorized: true, consentStatus: 'granted' }],
    upsertState: { created: false, identityAdded: false }
  };
  contactsManager.findByChannelAddress = async () => currentContact;
  contactsManager.findByChannelOrPhone = async () => currentContact;
  let upsertInput;
  contactsManager.upsertFromChannel = async (input) => {
    upsertInput = input;
    return currentContact;
  };
  let recorded;
  conversationsManager.recordInbound = async (input) => {
    recorded = input;
    return {
      conversation: { id: '507f1f77bcf86cd799439088' },
      message: { id: '507f1f77bcf86cd799439077' },
      duplicate: false
    };
  };
  logsManager.create = async () => ({});
  let notices = 0;
  adminNotificationsManager.create = async () => { notices += 1; return {}; };
  const emitted = [];
  socketService.emit = (event) => emitted.push(event);

  const result = await whatsappWebManager.processIncoming({
    fromMe: false,
    from: chatId,
    body: 'Mensagem em tempo real',
    type: 'chat',
    timestamp: 102,
    id: { _serialized: 'provider-live-1' },
    getContact: async () => ({ id: { _serialized: chatId }, number: '551131234567', pushname: 'Samuel' })
  });

  assert.equal(result.ignored, false);
  assert.equal(result.permissionRequired, false);
  assert.equal(upsertInput.authorize, true);
  assert.equal(recorded.body, 'Mensagem em tempo real');
  assert.equal(recorded.providerMessageId, 'provider-live-1');
  assert.equal(notices, 0);
  assert.ok(emitted.includes('whatsapp_web:message'));
});

test('primeiro evento Web consome opt-in compartilhado pendente vindo do WhatsApp Cloud', async (context) => {
  const originals = {
    permission: settingsManager.isWhatsappPermissionCommand,
    profile: whatsappWebService.getProfilePicUrl,
    find: contactsManager.findByChannelAddress,
    findByPhone: contactsManager.findByChannelOrPhone,
    upsert: contactsManager.upsertFromChannel,
    record: conversationsManager.recordInbound,
    log: logsManager.create,
    notify: adminNotificationsManager.create
  };
  context.after(() => {
    settingsManager.isWhatsappPermissionCommand = originals.permission;
    whatsappWebService.getProfilePicUrl = originals.profile;
    contactsManager.findByChannelAddress = originals.find;
    contactsManager.findByChannelOrPhone = originals.findByPhone;
    contactsManager.upsertFromChannel = originals.upsert;
    conversationsManager.recordInbound = originals.record;
    logsManager.create = originals.log;
    adminNotificationsManager.create = originals.notify;
  });

  settingsManager.isWhatsappPermissionCommand = async () => false;
  whatsappWebService.getProfilePicUrl = async () => null;
  contactsManager.findByChannelAddress = async () => null;
  contactsManager.findByChannelOrPhone = async () => ({
    id: '507f1f77bcf86cd799439044',
    channels: [{ channel: 'whatsapp_cloud', address: '551131234567', authorized: true, consentStatus: 'granted' }],
    pendingWhatsappConsents: [{ channel: 'whatsapp_web', status: 'granted', sourceChannel: 'whatsapp_cloud' }]
  });
  let upsertInput;
  contactsManager.upsertFromChannel = async (input) => {
    upsertInput = input;
    return {
      id: '507f1f77bcf86cd799439044',
      channels: [{ channel: 'whatsapp_web', address: input.address, authorized: true, consentStatus: 'granted' }],
      upsertState: { created: false, identityAdded: true }
    };
  };
  let recorded = 0;
  conversationsManager.recordInbound = async () => {
    recorded += 1;
    return { conversation: { id: '507f1f77bcf86cd799439045' }, message: null, duplicate: false };
  };
  logsManager.create = async () => ({});
  let notices = 0;
  adminNotificationsManager.create = async () => { notices += 1; return {}; };

  const result = await whatsappWebManager.processIncoming({
    from: '123456789012345@lid',
    body: 'Mensagem depois do opt-in Cloud',
    id: { _serialized: 'provider-pending-cloud-1' },
    getContact: async () => ({
      id: { _serialized: '123456789012345@lid' },
      number: '551131234567',
      pushname: 'Samuel'
    })
  });

  assert.equal(result.ignored, false);
  assert.equal(upsertInput.authorize, false);
  assert.equal(upsertInput.consentStatus, undefined);
  assert.equal(recorded, 1);
  assert.equal(notices, 0);
});

test('rotas legadas de importacao e historico WhatsApp Web ficam explicitamente desativadas', async () => {
  for (const operation of [
    () => whatsappWebManager.chats(),
    () => whatsappWebManager.messages('5511999999999@c.us', 100),
    () => whatsappWebManager.syncChats()
  ]) {
    await assert.rejects(
      operation,
      (error) => error.statusCode === 410 && error.code === 'WHATSAPP_WEB_HISTORY_DISABLED'
    );
  }
});

test('monitor WhatsApp Web permite visualizar, mas bloqueia resposta ate o consentimento', async (context) => {
  const originals = {
    setting: settingsManager.getValue,
    snapshot: whatsappWebService.snapshot,
    send: whatsappWebService.sendMessage,
    find: contactsManager.findByChannelAddress,
    log: logsManager.create,
    record: conversationsManager.recordOutbound
  };
  context.after(() => {
    settingsManager.getValue = originals.setting;
    whatsappWebService.snapshot = originals.snapshot;
    whatsappWebService.sendMessage = originals.send;
    contactsManager.findByChannelAddress = originals.find;
    logsManager.create = originals.log;
    conversationsManager.recordOutbound = originals.record;
  });

  const chatId = '5561999999999@c.us';
  settingsManager.getValue = async () => null;
  whatsappWebService.snapshot = () => ({ initialized: true, ready: true, state: 'ready' });
  let sends = 0;
  whatsappWebService.sendMessage = async (destination, text) => {
    sends += 1;
    return ({
    providerMessageId: 'wweb-out-1',
    chatId: destination,
    text
    });
  };
  let authorized = false;
  contactsManager.findByChannelAddress = async () => ({
    id: '507f1f77bcf86cd799439011',
    displayName: 'Ana',
    active: true,
    notificationDisabled: false,
    channels: [{ channel: 'whatsapp_web', address: chatId, authorized, consentStatus: authorized ? 'granted' : 'unknown' }]
  });
  logsManager.create = async () => ({});
  let stored;
  conversationsManager.recordOutbound = async (input) => { stored = input; return {}; };

  await assert.rejects(
    () => whatsappWebManager.send({ destination: chatId, text: 'Resposta bloqueada' }),
    (error) => error.code === 'CHANNEL_NOT_AUTHORIZED' && error.statusCode === 409
  );
  assert.equal(sends, 0);

  authorized = true;
  const result = await whatsappWebManager.send({ destination: chatId, text: 'Resposta direta' });

  assert.equal(result.providerMessageId, 'wweb-out-1');
  assert.equal(stored.contactId, '507f1f77bcf86cd799439011');
  assert.equal(stored.externalId, chatId);
  assert.equal(stored.body, 'Resposta direta');
  assert.equal(sends, 1);
});

test('WhatsApp Web ignora inbound de grupo e rejeita envio por groupId', async (context) => {
  const originals = {
    profile: whatsappWebService.getProfilePicUrl,
    upsert: contactsManager.upsertFromChannel,
    record: conversationsManager.recordInbound
  };
  context.after(() => {
    whatsappWebService.getProfilePicUrl = originals.profile;
    contactsManager.upsertFromChannel = originals.upsert;
    conversationsManager.recordInbound = originals.record;
  });
  let sideEffects = 0;
  whatsappWebService.getProfilePicUrl = async () => { sideEffects += 1; return null; };
  contactsManager.upsertFromChannel = async () => { sideEffects += 1; return {}; };
  conversationsManager.recordInbound = async () => { sideEffects += 1; return {}; };

  await whatsappWebManager.processIncoming({
    fromMe: false,
    from: '120@g.us',
    getChat: async () => ({ isGroup: true, id: { _serialized: '120@g.us' } })
  });
  assert.equal(sideEffects, 0);
  await assert.rejects(
    () => whatsappWebManager.send({ groupId: '507f1f77bcf86cd799439011', text: 'Nao enviar' }),
    (error) => error.code === 'WHATSAPP_WEB_DIRECT_ONLY' && error.statusCode === 422
  );
});
