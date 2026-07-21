const test = require('node:test');
const assert = require('node:assert/strict');
const Notification = require('../src/models/notification.model');
const groupsManager = require('../src/managers/groups.manager');
const contactsManager = require('../src/managers/contacts.manager');
const telegramManager = require('../src/managers/telegram.manager');
const gmailManager = require('../src/managers/gmail.manager');
const whatsappCloudManager = require('../src/managers/whatsapp-cloud.manager');
const whatsappWebManager = require('../src/managers/whatsapp-web.manager');
const logsManager = require('../src/managers/logs.manager');
const notificationsManager = require('../src/managers/notifications.manager');

test('normaliza variantes globais e componentes do WhatsApp Cloud', () => {
  const telegram = notificationsManager.normalizeTemplateContent({
    channel: 'global', variants: { telegram: { body: 'Ola' } }
  }, 'telegram');
  assert.equal(telegram.text, 'Ola');

  const cloud = notificationsManager.normalizeTemplateContent({
    channel: 'whatsapp_cloud', body: 'Fallback', payload: { components: [{ type: 'body' }] }, externalTemplateName: 'alerta'
  }, 'whatsapp_cloud');
  assert.deepEqual(cloud.components, [{ type: 'body' }]);
});

test('worker pula contato quando grupo foi removido antes do disparo', async (context) => {
  const originals = {
    findOneAndUpdate: Notification.findOneAndUpdate,
    expandContactIds: groupsManager.expandContactIds,
    send: telegramManager.send,
    log: logsManager.create
  };
  context.after(() => Object.assign(Notification, { findOneAndUpdate: originals.findOneAndUpdate }));
  context.after(() => { groupsManager.expandContactIds = originals.expandContactIds; telegramManager.send = originals.send; logsManager.create = originals.log; });

  let sent = false;
  const fake = {
    _id: '507f1f77bcf86cd799439099',
    channel: 'telegram',
    template: null,
    content: { text: 'Oi' },
    recipientContacts: [],
    recipientGroups: ['507f1f77bcf86cd799439012'],
    deliveries: [{ contact: '507f1f77bcf86cd799439011', channel: 'telegram', status: 'queued', attempts: 0 }],
    save: async () => undefined,
    toObject() { return this; }
  };
  Notification.findOneAndUpdate = async () => fake;
  groupsManager.expandContactIds = async () => [];
  telegramManager.send = async () => { sent = true; };
  logsManager.create = async () => ({});

  await notificationsManager.processJob({ notificationId: String(fake._id) });
  assert.equal(sent, false);
  assert.equal(fake.deliveries[0].status, 'skipped');
  assert.equal(fake.deliveries[0].errorCode, 'RECIPIENT_SCOPE_CHANGED');
  assert.equal(fake.status, 'failed');
});

test('monta disparo global com fila e skips independentes por canal', async (context) => {
  const originals = {
    contact: contactsManager.getById,
    telegramStatus: telegramManager.status,
    emailStatus: gmailManager.status,
    cloudStatus: whatsappCloudManager.status,
    webStatus: whatsappWebManager.status
  };
  context.after(() => {
    contactsManager.getById = originals.contact;
    telegramManager.status = originals.telegramStatus;
    gmailManager.status = originals.emailStatus;
    whatsappCloudManager.status = originals.cloudStatus;
    whatsappWebManager.status = originals.webStatus;
  });

  contactsManager.getById = async () => ({
    active: true,
    notificationDisabled: false,
    channels: ['telegram', 'email', 'whatsapp_cloud', 'whatsapp_web'].map((channel) => ({
      channel,
      authorized: true,
      consentStatus: 'granted'
    }))
  });
  telegramManager.status = async () => ({ configured: true });
  gmailManager.status = async () => ({ configured: true });
  whatsappCloudManager.status = async () => ({ configured: false });
  whatsappWebManager.status = async () => ({ configured: true, ready: false });

  const deliveries = await notificationsManager.buildDeliveries(
    ['507f1f77bcf86cd799439011'],
    'global',
    { variants: { telegram: {}, email: {}, whatsapp_cloud: {}, whatsapp_web: {} } }
  );
  assert.equal(deliveries.length, 4);
  assert.equal(deliveries.find((item) => item.channel === 'telegram').status, 'queued');
  assert.equal(deliveries.find((item) => item.channel === 'email').status, 'queued');
  assert.equal(deliveries.find((item) => item.channel === 'whatsapp_cloud').errorCode, 'CHANNEL_NOT_CONFIGURED');
  assert.equal(deliveries.find((item) => item.channel === 'whatsapp_web').errorCode, 'CHANNEL_NOT_READY');
});

test('worker envia canal disponivel mesmo com skip e falha nos demais', async (context) => {
  const originals = {
    findOneAndUpdate: Notification.findOneAndUpdate,
    expandContactIds: groupsManager.expandContactIds,
    contact: contactsManager.getById,
    telegramStatus: telegramManager.status,
    emailStatus: gmailManager.status,
    cloudStatus: whatsappCloudManager.status,
    telegramSend: telegramManager.send,
    emailSend: gmailManager.send,
    cloudSend: whatsappCloudManager.send,
    log: logsManager.create
  };
  context.after(() => {
    Notification.findOneAndUpdate = originals.findOneAndUpdate;
    groupsManager.expandContactIds = originals.expandContactIds;
    contactsManager.getById = originals.contact;
    telegramManager.status = originals.telegramStatus;
    gmailManager.status = originals.emailStatus;
    whatsappCloudManager.status = originals.cloudStatus;
    telegramManager.send = originals.telegramSend;
    gmailManager.send = originals.emailSend;
    whatsappCloudManager.send = originals.cloudSend;
    logsManager.create = originals.log;
  });

  const contactId = '507f1f77bcf86cd799439011';
  const fake = {
    _id: '507f1f77bcf86cd799439099',
    channel: 'global',
    template: null,
    content: { text: 'Oi' },
    recipientContacts: [contactId],
    recipientGroups: [],
    deliveries: [
      { contact: contactId, channel: 'email', status: 'queued', attempts: 0 },
      { contact: contactId, channel: 'whatsapp_cloud', status: 'queued', attempts: 0 },
      { contact: contactId, channel: 'telegram', status: 'queued', attempts: 0 }
    ],
    save: async () => undefined,
    toObject() { return this; }
  };
  Notification.findOneAndUpdate = async () => fake;
  groupsManager.expandContactIds = async () => [];
  contactsManager.getById = async () => ({ displayName: 'Ana' });
  telegramManager.status = async () => ({ configured: true });
  gmailManager.status = async () => ({ configured: false });
  whatsappCloudManager.status = async () => ({ configured: true });
  let emailCalled = false;
  gmailManager.send = async () => { emailCalled = true; };
  whatsappCloudManager.send = async () => {
    const error = new Error('payload rejeitado');
    error.statusCode = 422;
    error.code = 'WHATSAPP_CLOUD_ERROR';
    throw error;
  };
  telegramManager.send = async () => ({ providerMessageId: 'tg-1' });
  logsManager.create = async () => ({});

  await notificationsManager.processJob({ notificationId: String(fake._id) });
  assert.equal(emailCalled, false);
  assert.deepEqual(fake.deliveries.map((item) => [item.channel, item.status]), [
    ['email', 'skipped'],
    ['whatsapp_cloud', 'failed'],
    ['telegram', 'sent']
  ]);
  assert.equal(fake.deliveries[0].errorCode, 'CHANNEL_NOT_CONFIGURED');
  assert.equal(fake.status, 'partial');
  assert.deepEqual(fake.summary, { queued: 0, sent: 1, failed: 1, skipped: 1 });
});

test('canais opcionais ignorados nao rebaixam um disparo global bem-sucedido', async (context) => {
  const originals = {
    findOneAndUpdate: Notification.findOneAndUpdate,
    expandContactIds: groupsManager.expandContactIds,
    contact: contactsManager.getById,
    telegramStatus: telegramManager.status,
    emailStatus: gmailManager.status,
    telegramSend: telegramManager.send,
    emailSend: gmailManager.send,
    log: logsManager.create
  };
  context.after(() => {
    Notification.findOneAndUpdate = originals.findOneAndUpdate;
    groupsManager.expandContactIds = originals.expandContactIds;
    contactsManager.getById = originals.contact;
    telegramManager.status = originals.telegramStatus;
    gmailManager.status = originals.emailStatus;
    telegramManager.send = originals.telegramSend;
    gmailManager.send = originals.emailSend;
    logsManager.create = originals.log;
  });

  const contactId = '507f1f77bcf86cd799439011';
  const fake = {
    _id: '507f1f77bcf86cd799439098',
    channel: 'global',
    template: null,
    content: { text: 'Oi' },
    recipientContacts: [contactId],
    recipientGroups: [],
    deliveries: [
      { contact: contactId, channel: 'email', status: 'queued', attempts: 0 },
      { contact: contactId, channel: 'telegram', status: 'queued', attempts: 0 }
    ],
    save: async () => undefined,
    toObject() { return this; }
  };
  Notification.findOneAndUpdate = async () => fake;
  groupsManager.expandContactIds = async () => [];
  contactsManager.getById = async () => ({ displayName: 'Ana' });
  telegramManager.status = async () => ({ configured: true });
  gmailManager.status = async () => ({ configured: false });
  telegramManager.send = async () => ({ providerMessageId: 'tg-2' });
  gmailManager.send = async () => assert.fail('canal indisponivel nao deve ser chamado');
  logsManager.create = async () => ({});

  await notificationsManager.processJob({ notificationId: String(fake._id) });
  assert.equal(fake.deliveries[0].status, 'skipped');
  assert.equal(fake.deliveries[1].status, 'sent');
  assert.equal(fake.status, 'sent');
  assert.deepEqual(fake.summary, { queued: 0, sent: 1, failed: 0, skipped: 1 });
});
