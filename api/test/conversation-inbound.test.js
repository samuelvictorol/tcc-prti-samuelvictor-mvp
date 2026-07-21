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
  assert.equal(conversationInput.externalId, '556199999999@c.us');
  assert.equal(conversationInput.contactId, '507f1f77bcf86cd799439012');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].channel, 'whatsapp_web');
});

test('WhatsApp Web salva contato e conversa sem liberar resposta antes do comando', async (context) => {
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
  whatsappWebService.getProfilePicUrl = async () => 'https://cdn.example/pending.jpg';
  contactsManager.findByChannelAddress = async () => null;
  contactsManager.findByChannelOrPhone = async () => null;
  let contactInput;
  contactsManager.upsertFromChannel = async (input) => {
    contactInput = input;
    return {
      id: '507f1f77bcf86cd799439013',
      displayName: 'Contato pendente',
      channels: [{ channel: 'whatsapp_web', authorized: false, consentStatus: 'unknown' }],
      upsertState: { created: true, identityAdded: true }
    };
  };
  let conversationInput;
  conversationsManager.recordInbound = async (input) => {
    conversationInput = input;
    return { conversation: { id: '507f1f77bcf86cd799439023' }, message: { id: '507f1f77bcf86cd799439024' }, duplicate: false };
  };
  let notices = 0;
  adminNotificationsManager.create = async () => { notices += 1; return {}; };
  const actions = [];
  logsManager.create = async (input) => { actions.push(input.action); return {}; };
  socketService.emit = () => undefined;

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
  assert.equal(result.permissionRequired, true);
  assert.equal(contactInput.authorize, false);
  assert.equal(contactInput.consentStatus, undefined);
  assert.equal(contactInput.avatarUrl, 'https://cdn.example/pending.jpg');
  assert.equal(conversationInput.body, 'Ola, quero informacoes');
  assert.equal(notices, 1);
  assert.deepEqual(actions, ['contact.auto_created', 'message.received']);
});

test('sincronizacao WhatsApp Web retropreenche somente chats individuais sem inventar mensagens', async (context) => {
  const originals = {
    setting: settingsManager.getValue,
    listChats: whatsappWebService.listChats,
    getMessages: whatsappWebService.getMessages,
    find: contactsManager.findByChannelAddress,
    upsertContact: contactsManager.upsertFromChannel,
    upsertConversation: conversationsManager.upsertConversation,
    visibleExternalIds: conversationsManager.visibleExternalIds,
    log: logsManager.create,
    notify: adminNotificationsManager.create
  };
  context.after(() => {
    settingsManager.getValue = originals.setting;
    whatsappWebService.listChats = originals.listChats;
    whatsappWebService.getMessages = originals.getMessages;
    contactsManager.findByChannelAddress = originals.find;
    contactsManager.upsertFromChannel = originals.upsertContact;
    conversationsManager.upsertConversation = originals.upsertConversation;
    conversationsManager.visibleExternalIds = originals.visibleExternalIds;
    logsManager.create = originals.log;
    adminNotificationsManager.create = originals.notify;
  });
  settingsManager.getValue = async () => null;
  whatsappWebService.listChats = async () => [
    { id: '5511999@c.us', name: 'Ana', phone: '5511999', isGroup: false, imageUrl: 'https://cdn.example/ana.jpg' },
    { id: '120@g.us', name: 'Equipe', isGroup: true, imageUrl: null }
  ];
  whatsappWebService.getMessages = async () => [];
  contactsManager.findByChannelAddress = async () => ({
    id: '507f1f77bcf86cd799439011',
    displayName: 'Ana',
    channels: [{ channel: 'whatsapp_web', address: '5511999@c.us', authorized: true, consentStatus: 'granted' }]
  });
  contactsManager.upsertFromChannel = async () => ({
    id: '507f1f77bcf86cd799439011',
    displayName: 'Ana',
    upsertState: { created: false, identityAdded: false }
  });
  logsManager.create = async () => ({});
  const notices = [];
  adminNotificationsManager.create = async (input) => { notices.push(input); return input; };
  const summaries = [];
  conversationsManager.upsertConversation = async (input) => { summaries.push(input); return input; };
  conversationsManager.visibleExternalIds = async (_channel, externalIds) => new Set(externalIds);

  const result = await whatsappWebManager.syncChats();
  assert.equal(result.contacts, 1);
  assert.equal(result.recoveredMessages, 0);
  assert.equal(result.failures, 0);
  assert.equal(result.partial, false);
  assert.equal(result.remaining, 0);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].contactId, '507f1f77bcf86cd799439011');
  assert.equal(summaries[0].isGroup, false);
  assert.equal(notices.length, 0);
});

test('sync recupera comando de permissao perdido e mensagens seguintes sem exigir reenvio', async (context) => {
  const originals = {
    permission: settingsManager.isWhatsappPermissionCommand,
    listChats: whatsappWebService.listChats,
    getMessages: whatsappWebService.getMessages,
    profile: whatsappWebService.getProfilePicUrl,
    find: contactsManager.findByChannelAddress,
    findByPhone: contactsManager.findByChannelOrPhone,
    upsertContact: contactsManager.upsertFromChannel,
    record: conversationsManager.recordInbound,
    upsertConversation: conversationsManager.upsertConversation,
    log: logsManager.create,
    notify: adminNotificationsManager.create
  };
  context.after(() => {
    settingsManager.isWhatsappPermissionCommand = originals.permission;
    whatsappWebService.listChats = originals.listChats;
    whatsappWebService.getMessages = originals.getMessages;
    whatsappWebService.getProfilePicUrl = originals.profile;
    contactsManager.findByChannelAddress = originals.find;
    contactsManager.findByChannelOrPhone = originals.findByPhone;
    contactsManager.upsertFromChannel = originals.upsertContact;
    conversationsManager.recordInbound = originals.record;
    conversationsManager.upsertConversation = originals.upsertConversation;
    logsManager.create = originals.log;
    adminNotificationsManager.create = originals.notify;
  });

  settingsManager.isWhatsappPermissionCommand = async (value) => value === '/notify-me';
  whatsappWebService.listChats = async () => [{
    id: '274985348251713@lid', name: 'Samuel', phone: '556181748795', isGroup: false,
    imageUrl: null, unreadCount: 1
  }];
  whatsappWebService.getMessages = async () => [
    { id: 'out-before', fromMe: true, body: 'Mensagem enviada', type: 'chat', timestamp: 100 },
    { id: 'permission-lost', fromMe: false, body: '/notify-me', type: 'chat', timestamp: 101 },
    { id: 'after-permission', fromMe: false, body: 'Agora posso receber?', type: 'chat', timestamp: 102 }
  ];
  whatsappWebService.getProfilePicUrl = async () => 'https://cdn.example/samuel.jpg';
  let currentContact = null;
  contactsManager.findByChannelAddress = async () => currentContact;
  contactsManager.findByChannelOrPhone = async () => currentContact;
  contactsManager.upsertFromChannel = async (input) => {
    currentContact = {
      id: '507f1f77bcf86cd799439099', displayName: input.displayName,
      avatarUrl: input.avatarUrl,
      channels: [{
        channel: 'whatsapp_web', address: input.address, authorized: true,
        consentStatus: 'granted', source: input.source
      }],
      upsertState: { created: !currentContact, identityAdded: !currentContact }
    };
    return currentContact;
  };
  const recorded = [];
  conversationsManager.recordInbound = async (input) => {
    recorded.push(input);
    return {
      conversation: { id: '507f1f77bcf86cd799439088' },
      message: { id: '507f1f77bcf86cd799439077' },
      duplicate: false
    };
  };
  conversationsManager.upsertConversation = async (input) => input;
  logsManager.create = async () => ({});
  adminNotificationsManager.create = async () => ({});

  const result = await whatsappWebManager.syncChats();

  assert.equal(result.contacts, 1);
  assert.equal(result.recoveredMessages, 2);
  assert.equal(result.failures, 0);
  assert.equal(result.partial, false);
  assert.equal(result.remaining, 0);
  assert.deepEqual(recorded.map((item) => item.body), ['/notify-me', 'Agora posso receber?']);
  assert.deepEqual(recorded.map((item) => item.providerMessageId), ['permission-lost', 'after-permission']);
  assert.equal(currentContact.avatarUrl, 'https://cdn.example/samuel.jpg');
  assert.equal(currentContact.channels[0].consentStatus, 'granted');
});

test('sync salva chat com inbound sem comando e mantem permissao unknown', async (context) => {
  const originals = {
    permission: settingsManager.isWhatsappPermissionCommand,
    listChats: whatsappWebService.listChats,
    getMessages: whatsappWebService.getMessages,
    profile: whatsappWebService.getProfilePicUrl,
    find: contactsManager.findByChannelAddress,
    findByPhone: contactsManager.findByChannelOrPhone,
    upsertContact: contactsManager.upsertFromChannel,
    record: conversationsManager.recordInbound,
    upsertConversation: conversationsManager.upsertConversation,
    log: logsManager.create,
    notify: adminNotificationsManager.create
  };
  context.after(() => {
    settingsManager.isWhatsappPermissionCommand = originals.permission;
    whatsappWebService.listChats = originals.listChats;
    whatsappWebService.getMessages = originals.getMessages;
    whatsappWebService.getProfilePicUrl = originals.profile;
    contactsManager.findByChannelAddress = originals.find;
    contactsManager.findByChannelOrPhone = originals.findByPhone;
    contactsManager.upsertFromChannel = originals.upsertContact;
    conversationsManager.recordInbound = originals.record;
    conversationsManager.upsertConversation = originals.upsertConversation;
    logsManager.create = originals.log;
    adminNotificationsManager.create = originals.notify;
  });
  settingsManager.isWhatsappPermissionCommand = async () => false;
  whatsappWebService.listChats = async () => [{
    id: '556188888888@c.us', name: 'Contato pendente', phone: '556188888888', isGroup: false, imageUrl: null
  }];
  whatsappWebService.getMessages = async () => [
    { id: 'pending-1', fromMe: false, body: 'Ola', type: 'chat', timestamp: 101 },
    { id: 'pending-2', fromMe: false, body: 'Pode me ajudar?', type: 'chat', timestamp: 102 }
  ];
  whatsappWebService.getProfilePicUrl = async () => null;
  let currentContact = null;
  contactsManager.findByChannelAddress = async () => currentContact;
  contactsManager.findByChannelOrPhone = async () => currentContact;
  contactsManager.upsertFromChannel = async (input) => {
    const created = !currentContact;
    currentContact = {
      id: '507f1f77bcf86cd799439066',
      displayName: input.displayName,
      channels: [{ channel: 'whatsapp_web', address: input.address, authorized: false, consentStatus: 'unknown' }],
      upsertState: { created, identityAdded: created }
    };
    return currentContact;
  };
  const recorded = [];
  conversationsManager.recordInbound = async (input) => {
    recorded.push(input);
    return { conversation: { id: '507f1f77bcf86cd799439067' }, message: { id: input.providerMessageId }, duplicate: false };
  };
  conversationsManager.upsertConversation = async (input) => input;
  logsManager.create = async () => ({});
  adminNotificationsManager.create = async () => ({});

  const result = await whatsappWebManager.syncChats();

  assert.equal(result.contacts, 1);
  assert.equal(result.recoveredMessages, 2);
  assert.equal(result.failures, 0);
  assert.equal(result.partial, false);
  assert.equal(result.remaining, 0);
  assert.deepEqual(recorded.map((item) => item.body), ['Ola', 'Pode me ajudar?']);
  assert.equal(currentContact.channels[0].authorized, false);
  assert.equal(currentContact.channels[0].consentStatus, 'unknown');
});

test('monitor WhatsApp Web permite visualizar, mas bloqueia resposta ate o consentimento', async (context) => {
  const originals = {
    setting: settingsManager.getValue,
    snapshot: whatsappWebService.snapshot,
    summary: whatsappWebService.getChatSummary,
    send: whatsappWebService.sendMessage,
    find: contactsManager.findByChannelAddress,
    log: logsManager.create,
    record: conversationsManager.recordOutbound
  };
  context.after(() => {
    settingsManager.getValue = originals.setting;
    whatsappWebService.snapshot = originals.snapshot;
    whatsappWebService.getChatSummary = originals.summary;
    whatsappWebService.sendMessage = originals.send;
    contactsManager.findByChannelAddress = originals.find;
    logsManager.create = originals.log;
    conversationsManager.recordOutbound = originals.record;
  });

  const chatId = '5561999999999@c.us';
  settingsManager.getValue = async () => null;
  whatsappWebService.snapshot = () => ({ initialized: true, ready: true, state: 'ready' });
  whatsappWebService.getChatSummary = async (value) => ({
    id: value,
    name: 'Ana',
    phone: '5561999999999',
    isGroup: false,
    imageUrl: null
  });
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
