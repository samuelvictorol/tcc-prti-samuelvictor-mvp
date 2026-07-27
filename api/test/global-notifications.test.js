const test = require('node:test');
const assert = require('node:assert/strict');
const Notification = require('../src/models/notification.model');
const groupsManager = require('../src/managers/groups.manager');
const contactsManager = require('../src/managers/contacts.manager');
const templatesManager = require('../src/managers/templates.manager');
const telegramManager = require('../src/managers/telegram.manager');
const gmailManager = require('../src/managers/gmail.manager');
const whatsappCloudManager = require('../src/managers/whatsapp-cloud.manager');
const logsManager = require('../src/managers/logs.manager');
const queueService = require('../src/services/queue.service');
const notificationsManager = require('../src/managers/notifications.manager');

function authorizedContact(id) {
  return {
    id,
    displayName: 'Ana',
    email: 'ana@example.com',
    phone: '5511999999999',
    active: true,
    notificationDisabled: false,
    channels: ['telegram', 'whatsapp_cloud', 'email'].map((channel) => ({
      channel,
      authorized: true,
      consentStatus: 'granted'
    }))
  };
}

test('disparo global persiste e enfileira um template independente por canal', async (context) => {
  const originals = {
    notificationCreate: Notification.create,
    notificationUpdate: Notification.updateOne,
    expand: groupsManager.expandContactIds,
    contacts: contactsManager.getManyByIds,
    template: templatesManager.getById,
    telegramStatus: telegramManager.status,
    cloudStatus: whatsappCloudManager.status,
    emailStatus: gmailManager.status,
    enqueue: queueService.enqueueNotification,
    log: logsManager.create
  };
  context.after(() => {
    Notification.create = originals.notificationCreate;
    Notification.updateOne = originals.notificationUpdate;
    groupsManager.expandContactIds = originals.expand;
    contactsManager.getManyByIds = originals.contacts;
    templatesManager.getById = originals.template;
    telegramManager.status = originals.telegramStatus;
    whatsappCloudManager.status = originals.cloudStatus;
    gmailManager.status = originals.emailStatus;
    queueService.enqueueNotification = originals.enqueue;
    logsManager.create = originals.log;
  });

  const contactId = '507f1f77bcf86cd799439011';
  const templateIds = {
    telegram: '507f1f77bcf86cd799439012',
    whatsapp_cloud: '507f1f77bcf86cd799439013',
    email: '507f1f77bcf86cd799439014'
  };
  const channelsByTemplate = Object.fromEntries(Object.entries(templateIds).map(([channel, id]) => [id, channel]));
  groupsManager.expandContactIds = async () => [];
  contactsManager.getManyByIds = async () => [authorizedContact(contactId)];
  templatesManager.getById = async (id) => ({
    _id: String(id),
    active: true,
    channel: channelsByTemplate[String(id)],
    whatsappCloudPreset: String(id) === templateIds.whatsapp_cloud ? 'hello_world' : undefined
  });
  telegramManager.status = async () => ({ configured: true });
  whatsappCloudManager.status = async () => ({ configured: true });
  gmailManager.status = async () => ({ configured: true });
  queueService.enqueueNotification = async () => ({ id: 'global-job' });
  Notification.updateOne = async () => ({ modifiedCount: 1 });
  logsManager.create = async () => ({});
  let stored;
  Notification.create = async (input) => {
    stored = input;
    return {
      _id: '507f1f77bcf86cd799439099',
      ...input,
      toObject() { return { ...this }; }
    };
  };

  const result = await notificationsManager.create({
    kind: 'global',
    channel: 'global',
    templateIds,
    content: { variables: { protocolo: 'ABC-123' } },
    contactIds: [contactId],
    groupIds: []
  }, '507f1f77bcf86cd799439010');

  assert.deepEqual(stored.templates, templateIds);
  assert.equal(stored.template, undefined);
  assert.equal(stored.deliveries.length, 3);
  assert.deepEqual(stored.deliveries.map((delivery) => delivery.channel).sort(), ['email', 'telegram', 'whatsapp_cloud']);
  assert.ok(stored.deliveries.every((delivery) => delivery.status === 'queued'));
  assert.equal(result.queuedCount, 3);
});

test('worker global aplica o template correspondente a cada entrega', async (context) => {
  const originals = {
    findOneAndUpdate: Notification.findOneAndUpdate,
    expand: groupsManager.expandContactIds,
    contact: contactsManager.getById,
    template: templatesManager.getById,
    telegramStatus: telegramManager.status,
    emailStatus: gmailManager.status,
    telegramSend: telegramManager.send,
    emailSend: gmailManager.send,
    log: logsManager.create
  };
  context.after(() => {
    Notification.findOneAndUpdate = originals.findOneAndUpdate;
    groupsManager.expandContactIds = originals.expand;
    contactsManager.getById = originals.contact;
    templatesManager.getById = originals.template;
    telegramManager.status = originals.telegramStatus;
    gmailManager.status = originals.emailStatus;
    telegramManager.send = originals.telegramSend;
    gmailManager.send = originals.emailSend;
    logsManager.create = originals.log;
  });

  const contactId = '507f1f77bcf86cd799439011';
  const templateIds = {
    telegram: '507f1f77bcf86cd799439012',
    email: '507f1f77bcf86cd799439014'
  };
  const fake = {
    _id: '507f1f77bcf86cd799439099',
    kind: 'global',
    channel: 'global',
    templates: templateIds,
    content: { variables: { protocolo: 'ABC-123' } },
    recipientContacts: [contactId],
    recipientGroups: [],
    deliveries: [
      { contact: contactId, channel: 'telegram', status: 'queued', attempts: 0 },
      { contact: contactId, channel: 'email', status: 'queued', attempts: 0 }
    ],
    async save() {},
    toObject() { return this; }
  };
  Notification.findOneAndUpdate = async (_filter, update) => {
    Object.assign(fake, update.$set);
    return fake;
  };
  groupsManager.expandContactIds = async () => [];
  contactsManager.getById = async () => authorizedContact(contactId);
  templatesManager.getById = async (id) => String(id) === templateIds.telegram
    ? {
        _id: id,
        active: true,
        channel: 'telegram',
        body: 'Oi {{displayName}}, protocolo {{protocolo}}',
        payload: {
          telegram: {
            version: 1,
            kind: 'text',
            text: 'Oi {{displayName}}, protocolo {{protocolo}}'
          }
        }
      }
    : { _id: id, active: true, channel: 'email', subject: 'Protocolo {{protocolo}}', html: '<p>Olá {{displayName}}</p>' };
  telegramManager.status = async () => ({ configured: true });
  gmailManager.status = async () => ({ configured: true });
  const sent = {};
  telegramManager.send = async (payload) => { sent.telegram = payload; return { providerMessageId: 'tg-1' }; };
  gmailManager.send = async (payload) => { sent.email = payload; return { providerMessageId: 'mail-1' }; };
  logsManager.create = async () => ({});

  await notificationsManager.processJob({ notificationId: String(fake._id) });

  assert.equal(sent.telegram.text, 'Oi Ana, protocolo ABC-123');
  assert.equal(sent.telegram.payload.telegram.text, 'Oi Ana, protocolo ABC-123');
  assert.equal(sent.telegram.notificationId, String(fake._id));
  assert.equal(sent.email.subject, 'Protocolo ABC-123');
  assert.equal(sent.email.notificationId, String(fake._id));
  assert.equal(sent.email.html, '<p>Olá Ana</p>');
  assert.deepEqual(fake.deliveries.map((delivery) => delivery.status), ['sent', 'sent']);
});
