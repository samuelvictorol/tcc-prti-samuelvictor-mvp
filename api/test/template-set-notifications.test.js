const test = require('node:test');
const assert = require('node:assert/strict');
const Notification = require('../src/models/notification.model');
const groupsManager = require('../src/managers/groups.manager');
const contactsManager = require('../src/managers/contacts.manager');
const templatesManager = require('../src/managers/templates.manager');
const templateSetsManager = require('../src/managers/template-sets.manager');
const telegramManager = require('../src/managers/telegram.manager');
const gmailManager = require('../src/managers/gmail.manager');
const whatsappCloudManager = require('../src/managers/whatsapp-cloud.manager');
const logsManager = require('../src/managers/logs.manager');
const queueService = require('../src/services/queue.service');
const notificationsManager = require('../src/managers/notifications.manager');
const { createNotificationSchema } = require('../src/dtos/notifications.dto');

const IDS = {
  admin: '507f1f77bcf86cd799439001',
  set: '507f1f77bcf86cd799439002',
  contact: '507f1f77bcf86cd799439003',
  telegram: '507f1f77bcf86cd799439004',
  email: '507f1f77bcf86cd799439005'
};

test('contrato de notificacao aceita conjunto como alternativa exclusiva ao mapa manual', () => {
  const common = {
    kind: 'global',
    channel: 'global',
    contactIds: [IDS.contact],
    groupIds: []
  };
  assert.equal(createNotificationSchema.safeParse({
    body: { ...common, templateSetId: IDS.set }
  }).success, true);
  assert.equal(createNotificationSchema.safeParse({
    body: { ...common, templateSetId: IDS.set, templateIds: { telegram: IDS.telegram } }
  }).success, false);
  assert.equal(createNotificationSchema.safeParse({
    body: {
      kind: 'template',
      channel: 'telegram',
      templateId: IDS.telegram,
      templateSetId: IDS.set,
      contactIds: [IDS.contact],
      groupIds: []
    }
  }).success, false);
});

test('disparo por conjunto resolve canais, persiste snapshot dos templates e enfileira somente os selecionados', async (context) => {
  const originals = {
    notificationCreate: Notification.create,
    notificationUpdate: Notification.updateOne,
    expand: groupsManager.expandContactIds,
    contacts: contactsManager.getManyByIds,
    template: templatesManager.getById,
    resolveSet: templateSetsManager.resolveForNotification,
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
    templateSetsManager.resolveForNotification = originals.resolveSet;
    telegramManager.status = originals.telegramStatus;
    whatsappCloudManager.status = originals.cloudStatus;
    gmailManager.status = originals.emailStatus;
    queueService.enqueueNotification = originals.enqueue;
    logsManager.create = originals.log;
  });

  const resolvedTemplates = {
    telegram: {
      _id: IDS.telegram,
      channel: 'telegram',
      active: true,
      body: 'Ola {{displayName}}',
      payload: { telegram: { version: 1, kind: 'text', text: 'Ola {{displayName}}' } }
    },
    email: {
      _id: IDS.email,
      channel: 'email',
      active: true,
      subject: 'Aviso',
      body: 'Conteudo'
    }
  };
  templateSetsManager.resolveForNotification = async () => ({
    templateSet: { _id: IDS.set, name: 'Conjunto onboarding' },
    templateIds: { telegram: IDS.telegram, email: IDS.email },
    templates: resolvedTemplates
  });
  let unexpectedLookup = 0;
  templatesManager.getById = async () => {
    unexpectedLookup += 1;
    throw new Error('Nao deve reler templates ja validados pelo conjunto');
  };
  groupsManager.expandContactIds = async () => [];
  contactsManager.getManyByIds = async () => [{
    id: IDS.contact,
    displayName: 'Ana',
    active: true,
    notificationDisabled: false,
    channels: [
      { channel: 'telegram', authorized: true, consentStatus: 'granted' },
      { channel: 'email', authorized: true, consentStatus: 'granted' }
    ]
  }];
  telegramManager.status = async () => ({ configured: true });
  gmailManager.status = async () => ({ configured: true });
  whatsappCloudManager.status = async () => {
    throw new Error('Canal nao selecionado nao deve ser consultado');
  };
  queueService.enqueueNotification = async () => ({ id: 'set-job' });
  Notification.updateOne = async () => ({ modifiedCount: 1 });
  const logs = [];
  logsManager.create = async (value) => { logs.push(value); return value; };
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
    templateSetId: IDS.set,
    contactIds: [IDS.contact],
    groupIds: [],
    content: { variables: { protocolo: 'ABC' } }
  }, IDS.admin);

  assert.equal(unexpectedLookup, 0);
  assert.equal(String(stored.templateSet), IDS.set);
  assert.deepEqual(stored.templates, { telegram: IDS.telegram, email: IDS.email });
  assert.deepEqual(stored.deliveries.map((delivery) => delivery.channel).sort(), ['email', 'telegram']);
  assert.equal(result.queuedCount, 2);
  assert.equal(logs.find((log) => log.action === 'notification.queued').context.templateSetId, IDS.set);
});
