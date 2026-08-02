const test = require('node:test');
const assert = require('node:assert/strict');
const Notification = require('../src/models/notification.model');
const ProviderReceipt = require('../src/models/provider-receipt.model');
const groupsManager = require('../src/managers/groups.manager');
const contactsManager = require('../src/managers/contacts.manager');
const telegramManager = require('../src/managers/telegram.manager');
const gmailManager = require('../src/managers/gmail.manager');
const whatsappCloudManager = require('../src/managers/whatsapp-cloud.manager');
const logsManager = require('../src/managers/logs.manager');
const queueService = require('../src/services/queue.service');
const notificationsManager = require('../src/managers/notifications.manager');
const templatesManager = require('../src/managers/templates.manager');

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

test('serializacao de notificacao nao duplica deliveries nem expoe id do provedor', () => {
  const notification = {
    _id: '507f1f77bcf86cd799439099',
    summary: { queued: 0, sent: 1, failed: 0, skipped: 1 },
    deliveries: [
      { contact: '507f1f77bcf86cd799439011', channel: 'whatsapp_cloud', status: 'sent', providerMessageId: 'wamid.secret' },
      { contact: '507f1f77bcf86cd799439012', channel: 'whatsapp_cloud', status: 'skipped', errorCode: 'NO_CONSENT' }
    ]
  };
  const detailed = notificationsManager.serializeNotification(notification);
  const compact = notificationsManager.serializeNotification(notification, { includeDeliveries: false });

  assert.equal(detailed.deliveries.length, 2);
  assert.equal(detailed.deliveries[0].providerMessageId, undefined);
  assert.deepEqual(detailed.eligibility, { eligibleCount: 1, ineligibleCount: 1 });
  assert.equal(Array.isArray(detailed.eligibility.eligible), false);
  assert.equal(compact.deliveries, undefined);
  assert.deepEqual(compact.eligibility, { eligibleCount: 1, ineligibleCount: 1 });
});

test('serializacao detalhada sinaliza preview truncado e preserva totais do lote', () => {
  const notification = {
    _id: '507f1f77bcf86cd799439099',
    summary: { queued: 0, sent: 0, failed: 7_500, skipped: 2_500 },
    deliveries: Array.from({ length: 100 }, (_, index) => ({
      contact: `507f1f77bcf86cd79943${String(index).padStart(4, '0')}`.slice(0, 24),
      channel: 'whatsapp_cloud',
      status: 'failed'
    }))
  };
  const serialized = notificationsManager.serializeNotification(notification);
  assert.equal(serialized.deliveries.length, 100);
  assert.deepEqual(serialized.deliveryDetails, { total: 10_000, returned: 100, truncated: true });
  assert.deepEqual(serialized.eligibility, { eligibleCount: 0, ineligibleCount: 10_000 });
});

test('falhas de delivery sao paginadas no Mongo sem expor receipt do provedor', async (context) => {
  const original = Notification.aggregate;
  context.after(() => { Notification.aggregate = original; });
  let pipeline;
  Notification.aggregate = async (value) => {
    pipeline = value;
    return [{
      items: [{
        id: '507f1f77bcf86cd799439021',
        notificationId: '507f1f77bcf86cd799439099',
        contactId: '507f1f77bcf86cd799439011',
        channel: 'whatsapp_cloud',
        status: 'failed',
        attempts: 4,
        errorCode: 'META_131000',
        errorMessage: 'Falha assincrona',
        createdAt: new Date('2026-07-21T00:00:00Z')
      }],
      metadata: [{ total: 250 }]
    }];
  };

  const result = await notificationsManager.listDeliveryIssues({
    notificationId: '507f1f77bcf86cd799439099',
    channel: 'whatsapp_cloud',
    page: 2,
    limit: 10
  });

  assert.equal(result.total, 250);
  assert.equal(result.pages, 25);
  assert.equal(result.items[0].notificationId, '507f1f77bcf86cd799439099');
  assert.equal(result.items[0].providerMessageId, undefined);
  assert.deepEqual(pipeline.find((stage) => stage.$facet).$facet.items.slice(0, 2), [{ $skip: 10 }, { $limit: 10 }]);
});

test('resultado individual do lote pagina sucesso, falha e skip sem expor id do provedor', async (context) => {
  const originals = {
    exists: Notification.exists,
    aggregate: Notification.aggregate
  };
  context.after(() => {
    Notification.exists = originals.exists;
    Notification.aggregate = originals.aggregate;
  });
  let pipeline;
  Notification.exists = async () => ({ _id: '507f1f77bcf86cd799439099' });
  Notification.aggregate = async (value) => {
    pipeline = value;
    return [{
      items: [{
        id: '507f1f77bcf86cd799439021',
        notificationId: '507f1f77bcf86cd799439099',
        contactId: '507f1f77bcf86cd799439011',
        channel: 'email',
        status: 'sent',
        attempts: 1,
        errorCode: null,
        errorMessage: null,
        sentAt: new Date('2026-07-26T20:00:00Z'),
        createdAt: new Date('2026-07-26T19:59:00Z')
      }],
      metadata: [{ total: 37 }]
    }];
  };

  const result = await notificationsManager.listDeliveries(
    '507f1f77bcf86cd799439099',
    { channel: 'email', status: 'sent', page: 2, limit: 20 }
  );

  assert.equal(result.total, 37);
  assert.equal(result.pages, 2);
  assert.equal(result.items[0].contactPath, '/contacts/507f1f77bcf86cd799439011');
  assert.equal(result.items[0].providerMessageId, undefined);
  assert.deepEqual(pipeline.find((stage) => stage.$facet).$facet.items.slice(0, 2), [{ $skip: 20 }, { $limit: 20 }]);
  const deliveryFilter = pipeline.find((stage) => stage.$match?.['deliveries.status']);
  assert.deepEqual(deliveryFilter.$match, {
    'deliveries.channel': 'email',
    'deliveries.status': 'sent'
  });
});

test('consulta de deliveries retorna 404 para notificacao inexistente', async (context) => {
  const original = Notification.exists;
  context.after(() => { Notification.exists = original; });
  Notification.exists = async () => null;
  await assert.rejects(
    () => notificationsManager.listDeliveries('507f1f77bcf86cd799439099'),
    (error) => error.statusCode === 404
  );
});

test('retry recalcula summary antes de devolver resposta compacta', async (context) => {
  const originals = {
    findById: Notification.findById,
    updateOne: Notification.updateOne,
    enqueue: queueService.enqueueNotification
  };
  context.after(() => {
    Notification.findById = originals.findById;
    Notification.updateOne = originals.updateOne;
    queueService.enqueueNotification = originals.enqueue;
  });
  const fake = {
    _id: '507f1f77bcf86cd799439099',
    status: 'failed',
    deliveries: [
      { status: 'failed', attempts: 4, errorCode: 'META_131000' },
      { status: 'skipped', attempts: 0, errorCode: 'CHANNEL_NOT_CONFIGURED' },
      { status: 'read', attempts: 1 }
    ],
    summary: { queued: 0, sent: 1, failed: 1, skipped: 1 },
    save: async () => undefined
  };
  Notification.findById = async () => fake;
  Notification.updateOne = async () => ({ matchedCount: 1 });
  queueService.enqueueNotification = async () => ({ mode: 'test' });

  const result = await notificationsManager.retry(fake._id);

  assert.deepEqual(fake.summary, { queued: 2, sent: 1, failed: 0, skipped: 0 });
  assert.deepEqual(result.summary, fake.summary);
  assert.equal(result.deliveries, undefined);
});

test('cancel recalcula summary e conclui a notificacao compacta', async (context) => {
  const original = Notification.findOne;
  context.after(() => { Notification.findOne = original; });
  const fake = {
    _id: '507f1f77bcf86cd799439099',
    status: 'queued',
    deliveries: [
      { status: 'queued', attempts: 0 },
      { status: 'sent', attempts: 1 },
      { status: 'skipped', attempts: 0 }
    ],
    summary: { queued: 1, sent: 1, failed: 0, skipped: 1 },
    save: async () => undefined
  };
  Notification.findOne = async () => fake;

  const result = await notificationsManager.cancel(fake._id);

  assert.equal(fake.status, 'cancelled');
  assert.deepEqual(fake.summary, { queued: 0, sent: 1, failed: 0, skipped: 2 });
  assert.ok(fake.completedAt instanceof Date);
  assert.deepEqual(result.summary, fake.summary);
  assert.equal(result.deliveries, undefined);
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

test('monta disparo global com skips independentes por canal', async (context) => {
  const originals = {
    contacts: contactsManager.getManyByIds,
    telegramStatus: telegramManager.status,
    emailStatus: gmailManager.status,
    cloudStatus: whatsappCloudManager.status
  };
  context.after(() => {
    contactsManager.getManyByIds = originals.contacts;
    telegramManager.status = originals.telegramStatus;
    gmailManager.status = originals.emailStatus;
    whatsappCloudManager.status = originals.cloudStatus;
  });

  let contactQueries = 0;
  contactsManager.getManyByIds = async (ids) => {
    contactQueries += 1;
    assert.deepEqual(ids, ['507f1f77bcf86cd799439011']);
    return [{
    id: '507f1f77bcf86cd799439011',
    active: true,
    notificationDisabled: false,
    channels: ['telegram', 'email', 'whatsapp_cloud'].map((channel) => ({
      channel,
      authorized: true,
      consentStatus: 'granted'
    }))
    }];
  };
  telegramManager.status = async () => ({ configured: true });
  gmailManager.status = async () => ({ configured: true });
  whatsappCloudManager.status = async () => ({ configured: false });

  const deliveries = await notificationsManager.buildDeliveries(
    ['507f1f77bcf86cd799439011'],
    'global',
    { variants: { telegram: {}, email: {}, whatsapp_cloud: {} } }
  );
  assert.equal(deliveries.length, 3);
  assert.equal(deliveries.find((item) => item.channel === 'telegram').status, 'queued');
  assert.equal(deliveries.find((item) => item.channel === 'email').status, 'queued');
  assert.equal(deliveries.find((item) => item.channel === 'whatsapp_cloud').errorCode, 'CHANNEL_NOT_CONFIGURED');
  assert.equal(contactQueries, 1);
});

test('classificador repete erros transitorios e throttling da Meta mesmo quando o HTTP e 400', () => {
  assert.equal(notificationsManager.permanentDeliveryError({
    statusCode: 502,
    details: { providerHttpStatus: 400, code: 131000, is_transient: true }
  }), false);
  assert.equal(notificationsManager.permanentDeliveryError({
    statusCode: 502,
    details: { providerHttpStatus: 400, code: 130429 }
  }), false);
  assert.equal(notificationsManager.permanentDeliveryError({
    statusCode: 502,
    details: { providerHttpStatus: 400, code: 132000 }
  }), true);
  assert.equal(notificationsManager.permanentDeliveryError({
    statusCode: 502,
    details: { providerErrorCode: 403 }
  }), true);
  assert.equal(notificationsManager.permanentDeliveryError({
    statusCode: 503,
    code: 'WHATSAPP_CLOUD_PHONE_NUMBER_ID_INVALID'
  }), true);
  assert.equal(notificationsManager.permanentDeliveryError({
    statusCode: 503,
    code: 'WHATSAPP_CLOUD_VERSION_INVALID'
  }), true);
  assert.equal(notificationsManager.permanentDeliveryError({ responseCode: 450 }), false);
  assert.equal(notificationsManager.permanentDeliveryError({ responseCode: 550 }), true);
});

test('create rejeita template inativo antes de montar deliveries', async (context) => {
  const originals = {
    template: templatesManager.getById,
    expandContactIds: groupsManager.expandContactIds
  };
  context.after(() => {
    templatesManager.getById = originals.template;
    groupsManager.expandContactIds = originals.expandContactIds;
  });
  templatesManager.getById = async () => ({ active: false, channel: 'telegram' });
  groupsManager.expandContactIds = async () => assert.fail('nao deve expandir destinatarios para template inativo');

  await assert.rejects(() => notificationsManager.create({
    kind: 'template',
    channel: 'telegram',
    templateId: '507f1f77bcf86cd799439012',
    contactIds: ['507f1f77bcf86cd799439011'],
    groupIds: []
  }, '507f1f77bcf86cd799439010'), (error) => {
    assert.equal(error.statusCode, 422);
    assert.equal(error.code, 'TEMPLATE_INACTIVE');
    return true;
  });
});

test('worker encerra sem enviar quando template e desativado depois do agendamento', async (context) => {
  const originals = {
    findOneAndUpdate: Notification.findOneAndUpdate,
    template: templatesManager.getById,
    telegramSend: telegramManager.send,
    log: logsManager.create
  };
  context.after(() => {
    Notification.findOneAndUpdate = originals.findOneAndUpdate;
    templatesManager.getById = originals.template;
    telegramManager.send = originals.telegramSend;
    logsManager.create = originals.log;
  });
  const notificationId = '507f1f77bcf86cd799439099';
  const templateId = '507f1f77bcf86cd799439012';
  const fake = {
    _id: notificationId,
    channel: 'telegram',
    status: 'queued',
    template: templateId,
    content: {},
    recipientContacts: ['507f1f77bcf86cd799439011'],
    recipientGroups: [],
    deliveries: [{ contact: '507f1f77bcf86cd799439011', channel: 'telegram', status: 'queued', attempts: 0 }],
    async save() {},
    toObject() { return this; }
  };
  Notification.findOneAndUpdate = async (_filter, update) => {
    Object.assign(fake, update.$set);
    return fake;
  };
  templatesManager.getById = async () => ({ _id: templateId, active: false, channel: 'telegram' });
  let sends = 0;
  telegramManager.send = async () => { sends += 1; return {}; };
  logsManager.create = async () => ({});

  await assert.rejects(() => notificationsManager.processJob({
    notificationId,
    queueContext: {
      jobId: 'inactive-template-job',
      lockToken: 'inactive-template-lock',
      attemptsMade: 0,
      maxAttempts: 4
    }
  }), (error) => error.code === 'TEMPLATE_INACTIVE');

  assert.equal(sends, 0);
  assert.equal(fake.status, 'failed');
  assert.equal(fake.deliveries[0].status, 'failed');
  assert.equal(fake.deliveries[0].attempts, 0);
  assert.equal(fake.errorCode, 'TEMPLATE_INACTIVE');
  assert.ok(fake.completedAt instanceof Date);
});

test('create aplica cap seguro ao total de deliveries depois de expandir grupos', async (context) => {
  const originals = {
    expandContactIds: groupsManager.expandContactIds,
    contact: contactsManager.getById
  };
  context.after(() => {
    groupsManager.expandContactIds = originals.expandContactIds;
    contactsManager.getById = originals.contact;
  });
  const overLimit = Array.from(
    { length: notificationsManager.MAX_NOTIFICATION_RECIPIENTS + 1 },
    (_value, index) => String(index + 1)
  );
  groupsManager.expandContactIds = async (_groupIds, options) => {
    assert.deepEqual(options, { maxUnique: notificationsManager.MAX_NOTIFICATION_RECIPIENTS + 1 });
    return overLimit;
  };
  contactsManager.getById = async () => assert.fail('nao deve montar deliveries acima do cap');

  await assert.rejects(() => notificationsManager.create({
    kind: 'quick',
    channel: 'telegram',
    content: { text: 'Teste' },
    contactIds: [],
    groupIds: ['507f1f77bcf86cd799439012']
  }, '507f1f77bcf86cd799439010'), (error) => {
    assert.equal(error.statusCode, 422);
    assert.equal(error.code, 'NOTIFICATION_DELIVERY_LIMIT_EXCEEDED');
    assert.deepEqual(error.details, {
      deliveryLimit: notificationsManager.MAX_NOTIFICATION_DELIVERIES,
      recipientLimit: notificationsManager.MAX_NOTIFICATION_RECIPIENTS,
      recipients: notificationsManager.MAX_NOTIFICATION_RECIPIENTS + 1,
      channelsPerRecipient: 1
    });
    return true;
  });
});

test('cap global considera tres deliveries por contato', async (context) => {
  const originals = {
    expandContactIds: groupsManager.expandContactIds,
    template: templatesManager.getById
  };
  context.after(() => {
    groupsManager.expandContactIds = originals.expandContactIds;
    templatesManager.getById = originals.template;
  });
  const recipientLimit = Math.floor(notificationsManager.MAX_NOTIFICATION_DELIVERIES / 3);
  groupsManager.expandContactIds = async (_groupIds, options) => {
    assert.deepEqual(options, { maxUnique: recipientLimit + 1 });
    return Array.from({ length: recipientLimit + 1 }, (_value, index) => String(index + 1));
  };
  const templateIds = {
    telegram: '507f1f77bcf86cd799439013',
    whatsapp_cloud: '507f1f77bcf86cd799439014',
    email: '507f1f77bcf86cd799439015'
  };
  templatesManager.getById = async (id) => ({
    _id: id,
    active: true,
    channel: Object.entries(templateIds).find(([, templateId]) => templateId === String(id))[0],
    whatsappCloudPreset: String(id) === templateIds.whatsapp_cloud ? 'hello_world' : undefined
  });

  await assert.rejects(() => notificationsManager.create({
    kind: 'global',
    channel: 'global',
    templateIds,
    contactIds: [],
    groupIds: ['507f1f77bcf86cd799439012']
  }, '507f1f77bcf86cd799439010'), (error) => {
    assert.equal(error.code, 'NOTIFICATION_DELIVERY_LIMIT_EXCEEDED');
    assert.equal(error.details.recipientLimit, recipientLimit);
    assert.equal(error.details.channelsPerRecipient, 3);
    return true;
  });
});

test('create mantem notificacao queued e recuperavel quando enqueue falha', async (context) => {
  const originals = {
    create: Notification.create,
    updateOne: Notification.updateOne,
    expandContactIds: groupsManager.expandContactIds,
    contacts: contactsManager.getManyByIds,
    telegramStatus: telegramManager.status,
    enqueue: queueService.enqueueNotification,
    log: logsManager.create
  };
  context.after(() => {
    Notification.create = originals.create;
    Notification.updateOne = originals.updateOne;
    groupsManager.expandContactIds = originals.expandContactIds;
    contactsManager.getManyByIds = originals.contacts;
    telegramManager.status = originals.telegramStatus;
    queueService.enqueueNotification = originals.enqueue;
    logsManager.create = originals.log;
  });
  const contactId = '507f1f77bcf86cd799439011';
  groupsManager.expandContactIds = async () => [];
  contactsManager.getManyByIds = async () => [{
    id: contactId,
    active: true,
    notificationDisabled: false,
    channels: [{ channel: 'telegram', authorized: true, consentStatus: 'granted' }]
  }];
  telegramManager.status = async () => ({ configured: true });
  let created;
  Notification.create = async (input) => {
    created = {
      ...input,
      _id: '507f1f77bcf86cd799439099',
      save: async () => undefined,
      toObject() { return this; }
    };
    return created;
  };
  let pendingUpdate;
  Notification.updateOne = async (_filter, update) => {
    pendingUpdate = update;
    return { matchedCount: 1 };
  };
  queueService.enqueueNotification = async () => { throw new Error('redis offline'); };
  logsManager.create = async () => ({});

  await assert.rejects(() => notificationsManager.create({
    kind: 'quick',
    channel: 'telegram',
    content: { text: 'Teste' },
    contactIds: [contactId],
    groupIds: []
  }, '507f1f77bcf86cd799439010'), (error) => {
    assert.equal(error.statusCode, 503);
    assert.equal(error.code, 'QUEUE_UNAVAILABLE');
    assert.equal(error.details.recoverable, true);
    return true;
  });

  assert.equal(created.status, 'queued');
  assert.equal(created.enqueuePending, true);
  assert.equal(pendingUpdate.$set.enqueuePending, true);
  assert.equal(pendingUpdate.$set.errorCode, 'QUEUE_UNAVAILABLE');
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
  const logInputs = [];
  logsManager.create = async (input) => {
    logInputs.push(input);
    return {};
  };

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
  const skippedLog = logInputs.find((item) => item.action === 'notification.delivery.skipped');
  const failedLog = logInputs.find((item) => item.action === 'notification.delivery.failed');
  assert.deepEqual(skippedLog.context, {
    notificationId: String(fake._id),
    deliveryId: null,
    contactId,
    status: 'skipped',
    attempts: 1,
    errorCode: 'CHANNEL_NOT_CONFIGURED'
  });
  assert.equal(skippedLog.context.errorMessage, undefined);
  assert.equal(failedLog.context.contactId, contactId);
  assert.equal(failedLog.context.errorCode, 'WHATSAPP_CLOUD_ERROR');
  assert.equal(failedLog.context.errorMessage, undefined);
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

test('worker processa o lote inteiro e agenda somente falhas transitorias', async (context) => {
  const originals = {
    findOneAndUpdate: Notification.findOneAndUpdate,
    updateOne: Notification.updateOne,
    expandContactIds: groupsManager.expandContactIds,
    contact: contactsManager.getById,
    telegramStatus: telegramManager.status,
    telegramSend: telegramManager.send,
    enqueue: queueService.enqueueNotification,
    log: logsManager.create
  };
  context.after(() => {
    Notification.findOneAndUpdate = originals.findOneAndUpdate;
    Notification.updateOne = originals.updateOne;
    groupsManager.expandContactIds = originals.expandContactIds;
    contactsManager.getById = originals.contact;
    telegramManager.status = originals.telegramStatus;
    telegramManager.send = originals.telegramSend;
    queueService.enqueueNotification = originals.enqueue;
    logsManager.create = originals.log;
  });
  const first = '507f1f77bcf86cd799439011';
  const second = '507f1f77bcf86cd799439012';
  const fake = {
    _id: '507f1f77bcf86cd799439099',
    channel: 'telegram',
    template: null,
    content: { text: 'Oi' },
    recipientContacts: [first, second],
    recipientGroups: [],
    deliveries: [
      { contact: first, channel: 'telegram', status: 'queued', attempts: 0 },
      { contact: second, channel: 'telegram', status: 'queued', attempts: 0 }
    ],
    save: async () => undefined,
    toObject() { return this; }
  };
  Notification.findOneAndUpdate = async () => fake;
  Notification.updateOne = async () => ({ matchedCount: 1 });
  groupsManager.expandContactIds = async () => [];
  contactsManager.getById = async (id) => ({ id: String(id), displayName: String(id), active: true });
  telegramManager.status = async () => ({ configured: true });
  const sent = [];
  telegramManager.send = async ({ contactId }) => {
    sent.push(contactId);
    if (contactId === first) {
      const error = new Error('timeout temporario');
      error.statusCode = 502;
      throw error;
    }
    return { providerMessageId: 'tg-ok' };
  };
  let scheduled;
  queueService.enqueueNotification = async (input) => { scheduled = input; return { mode: 'test' }; };
  logsManager.create = async () => ({});

  await notificationsManager.processJob({ notificationId: String(fake._id) });
  assert.deepEqual(sent, [first, second]);
  assert.equal(fake.deliveries[0].status, 'queued');
  assert.equal(fake.deliveries[0].attempts, 1);
  assert.equal(fake.deliveries[1].status, 'sent');
  assert.equal(fake.status, 'queued');
  assert.equal(scheduled.notificationId, String(fake._id));
  assert.equal(scheduled.delayMs, 2000);
});

test('worker persiste somente a subdelivery durante lotes grandes', async (context) => {
  const originals = {
    findOneAndUpdate: Notification.findOneAndUpdate,
    updateOne: Notification.updateOne,
    expandContactIds: groupsManager.expandContactIds,
    contact: contactsManager.getById,
    status: telegramManager.status,
    send: telegramManager.send,
    log: logsManager.create
  };
  context.after(() => {
    Notification.findOneAndUpdate = originals.findOneAndUpdate;
    Notification.updateOne = originals.updateOne;
    groupsManager.expandContactIds = originals.expandContactIds;
    contactsManager.getById = originals.contact;
    telegramManager.status = originals.status;
    telegramManager.send = originals.send;
    logsManager.create = originals.log;
  });
  const contactIds = ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'];
  let fullSaves = 0;
  const fake = {
    _id: '507f1f77bcf86cd799439099',
    status: 'processing',
    channel: 'telegram',
    template: null,
    content: {
      text: 'Lote',
      contactId: 'destino-forjado',
      notificationId: 'notificacao-forjada',
      deliveryId: 'delivery-forjada'
    },
    recipientContacts: contactIds,
    recipientGroups: [],
    deliveries: contactIds.map((contact, index) => ({
      _id: `507f1f77bcf86cd79943909${index + 1}`,
      contact,
      channel: 'telegram',
      status: 'queued',
      attempts: 0
    })),
    async save() { fullSaves += 1; },
    toObject() { return this; }
  };
  Notification.findOneAndUpdate = async () => fake;
  const positionalUpdates = [];
  Notification.updateOne = async (filter, update) => {
    positionalUpdates.push({ filter, update });
    return { matchedCount: 1 };
  };
  groupsManager.expandContactIds = async () => [];
  contactsManager.getById = async (id) => ({ id, displayName: id, active: true });
  telegramManager.status = async () => ({ configured: true });
  const sendInputs = [];
  telegramManager.send = async (input) => {
    sendInputs.push(input);
    return { providerMessageId: `tg-${input.contactId}` };
  };
  logsManager.create = async () => ({});

  await notificationsManager.processJob({ notificationId: String(fake._id) });

  assert.equal(positionalUpdates.length, 2);
  assert.ok(positionalUpdates.every((item) => item.filter['deliveries._id']));
  assert.ok(positionalUpdates.every((item) => item.update.$set['deliveries.$.status'] === 'sent'));
  assert.deepEqual(sendInputs.map((input) => input.contactId), contactIds);
  assert.ok(sendInputs.every((input) => input.notificationId === String(fake._id)));
  assert.deepEqual(sendInputs.map((input) => input.deliveryId), fake.deliveries.map((delivery) => String(delivery._id)));
  assert.equal(fullSaves, 1);
});

test('worker converte template Cloud custom usando content.variables', async (context) => {
  const originals = {
    findOneAndUpdate: Notification.findOneAndUpdate,
    findById: Notification.findById,
    expandContactIds: groupsManager.expandContactIds,
    contact: contactsManager.getById,
    template: templatesManager.getById,
    cloudStatus: whatsappCloudManager.status,
    cloudSend: whatsappCloudManager.send,
    log: logsManager.create
  };
  context.after(() => {
    Notification.findOneAndUpdate = originals.findOneAndUpdate;
    Notification.findById = originals.findById;
    groupsManager.expandContactIds = originals.expandContactIds;
    contactsManager.getById = originals.contact;
    templatesManager.getById = originals.template;
    whatsappCloudManager.status = originals.cloudStatus;
    whatsappCloudManager.send = originals.cloudSend;
    logsManager.create = originals.log;
  });
  const contactId = '507f1f77bcf86cd799439011';
  const fake = {
    _id: '507f1f77bcf86cd799439099',
    channel: 'whatsapp_cloud',
    template: '507f1f77bcf86cd799439012',
    content: { variables: { customerName: 'Ana' } },
    recipientContacts: [contactId],
    recipientGroups: [],
    deliveries: [{ contact: contactId, channel: 'whatsapp_cloud', status: 'queued', attempts: 0 }],
    save: async () => undefined,
    toObject() { return this; }
  };
  Notification.findOneAndUpdate = async () => fake;
  Notification.findById = async () => null;
  groupsManager.expandContactIds = async () => [];
  contactsManager.getById = async () => ({ id: contactId, displayName: 'Ana', active: true });
  templatesManager.getById = async () => ({
    channel: 'whatsapp_cloud',
    whatsappCloudPreset: 'custom',
    externalTemplateName: 'boas_vindas_v2',
    languageCode: 'pt_BR',
    payload: { builder: { version: 1, components: [{
      id: 'body', type: 'body', parameters: [{ id: 'name', type: 'text', key: 'customerName', label: 'Cliente' }]
    }] } }
  });
  whatsappCloudManager.status = async () => ({ configured: true });
  let sendInput;
  whatsappCloudManager.send = async (input) => { sendInput = input; return { providerMessageId: 'wamid.custom' }; };
  logsManager.create = async () => ({});

  await notificationsManager.processJob({ notificationId: String(fake._id) });
  assert.equal(sendInput.customTemplate.name, 'boas_vindas_v2');
  assert.equal(sendInput.customTemplate.languageCode, 'pt_BR');
  assert.equal(sendInput.customTemplate.variables.customerName, 'Ana');
  assert.equal(fake.deliveries[0].status, 'sent');
});

test('retry stalled do BullMQ retoma a mesma notificacao que ficou em processing', async (context) => {
  const originals = {
    findOneAndUpdate: Notification.findOneAndUpdate,
    exists: Notification.exists,
    expandContactIds: groupsManager.expandContactIds,
    contact: contactsManager.getById,
    telegramStatus: telegramManager.status,
    telegramSend: telegramManager.send,
    log: logsManager.create
  };
  context.after(() => {
    Notification.findOneAndUpdate = originals.findOneAndUpdate;
    Notification.exists = originals.exists;
    groupsManager.expandContactIds = originals.expandContactIds;
    contactsManager.getById = originals.contact;
    telegramManager.status = originals.telegramStatus;
    telegramManager.send = originals.telegramSend;
    logsManager.create = originals.log;
  });

  const notificationId = '507f1f77bcf86cd799439099';
  const contactId = '507f1f77bcf86cd799439011';
  const fake = {
    _id: notificationId,
    channel: 'telegram',
    status: 'processing',
    processingJobId: 'bull-job-1',
    processingToken: 'expired-token',
    template: null,
    content: { text: 'Retomada' },
    recipientContacts: [contactId],
    recipientGroups: [],
    deliveries: [{ contact: contactId, channel: 'telegram', status: 'queued', attempts: 0 }],
    save: async () => undefined,
    toObject() { return this; }
  };
  let claimFilter;
  Notification.findOneAndUpdate = async (filter, update) => {
    claimFilter = filter;
    Object.assign(fake, update.$set);
    return fake;
  };
  Notification.exists = async (filter) => filter.processingToken === 'renewed-token';
  groupsManager.expandContactIds = async () => [];
  contactsManager.getById = async () => ({ id: contactId, displayName: 'Ana', active: true });
  telegramManager.status = async () => ({ configured: true });
  let sends = 0;
  telegramManager.send = async () => { sends += 1; return { providerMessageId: 'tg-recovered' }; };
  logsManager.create = async () => ({});

  const result = await notificationsManager.processJob({
    notificationId,
    queueContext: {
      jobId: 'bull-job-1',
      lockToken: 'renewed-token',
      stalledCounter: 1,
      attemptsStarted: 2
    }
  });

  const processingRecovery = claimFilter.$or.find((item) => item.status === 'processing');
  assert.ok(processingRecovery);
  assert.ok(processingRecovery.$or.some((item) => item.processingJobId === 'bull-job-1'));
  assert.equal(sends, 1);
  assert.equal(fake.deliveries[0].status, 'sent');
  assert.equal(fake.status, 'sent');
  assert.equal(result.ignored, undefined);
});

test('job comum nao pode reivindicar notificacao processing de outro worker', () => {
  const claim = notificationsManager.processingClaim('507f1f77bcf86cd799439099', {
    jobId: 'job-concorrente',
    lockToken: 'token-concorrente',
    stalledCounter: 0
  });
  assert.deepEqual(claim.filter.$or, [{ status: 'queued' }]);
});

test('ultima tentativa fatal marca notificacao e deliveries como failed', async (context) => {
  const originals = {
    findOneAndUpdate: Notification.findOneAndUpdate,
    template: templatesManager.getById,
    log: logsManager.create
  };
  context.after(() => {
    Notification.findOneAndUpdate = originals.findOneAndUpdate;
    templatesManager.getById = originals.template;
    logsManager.create = originals.log;
  });

  const notificationId = '507f1f77bcf86cd799439099';
  const fatal = new Error('template indisponivel');
  fatal.code = 'TEMPLATE_LOAD_FAILED';
  const fake = {
    _id: notificationId,
    channel: 'telegram',
    status: 'queued',
    template: '507f1f77bcf86cd799439012',
    content: {},
    recipientContacts: ['507f1f77bcf86cd799439011'],
    recipientGroups: [],
    deliveries: [{
      contact: '507f1f77bcf86cd799439011',
      channel: 'telegram',
      status: 'queued',
      attempts: 0
    }],
    save: async () => undefined,
    toObject() { return this; }
  };
  Notification.findOneAndUpdate = async (_filter, update) => {
    Object.assign(fake, update.$set);
    return fake;
  };
  templatesManager.getById = async () => { throw fatal; };
  let logInput;
  logsManager.create = async (input) => { logInput = input; return {}; };

  await assert.rejects(() => notificationsManager.processJob({
    notificationId,
    queueContext: {
      jobId: 'bull-job-final',
      lockToken: 'bull-lock-final',
      attemptsStarted: 4,
      attemptsMade: 3,
      maxAttempts: 4,
      stalledCounter: 0
    }
  }), (error) => error === fatal);

  assert.equal(fake.status, 'failed');
  assert.equal(fake.deliveries[0].status, 'failed');
  assert.equal(fake.errorCode, 'TEMPLATE_LOAD_FAILED');
  assert.equal(fake.errorMessage, 'template indisponivel');
  assert.ok(fake.completedAt instanceof Date);
  assert.equal(fake.processingToken, undefined);
  assert.deepEqual(fake.summary, { queued: 0, sent: 0, failed: 1, skipped: 0 });
  assert.equal(logInput.action, 'notification.processing_failed');
  assert.equal(logInput.context.terminalFailure, true);
});

test('recoverStale reabre delivery e limpa lock com compare-and-set atomico', async (context) => {
  const originals = {
    find: Notification.find,
    findOneAndUpdate: Notification.findOneAndUpdate,
    updateOne: Notification.updateOne,
    enqueue: queueService.enqueueNotification,
    log: logsManager.create
  };
  context.after(() => {
    Notification.find = originals.find;
    Notification.findOneAndUpdate = originals.findOneAndUpdate;
    Notification.updateOne = originals.updateOne;
    queueService.enqueueNotification = originals.enqueue;
    logsManager.create = originals.log;
  });

  const notificationId = '507f1f77bcf86cd799439099';
  let findCalls = 0;
  Notification.find = () => {
    const items = findCalls++ === 0 ? [{ _id: notificationId }] : [];
    const query = { select() { return query; }, lean: async () => items };
    return query;
  };
  const events = [];
  queueService.enqueueNotification = async (input) => {
    events.push('enqueue');
    assert.equal(input.notificationId, notificationId);
    assert.equal(input.delayMs, 1000);
    return { mode: 'test' };
  };
  let atomicUpdate;
  let atomicOptions;
  Notification.findOneAndUpdate = async (filter, update, options) => {
    events.push('compare-and-set');
    assert.equal(String(filter._id), notificationId);
    assert.equal(filter.status, 'processing');
    atomicUpdate = update;
    atomicOptions = options;
    return { _id: notificationId };
  };
  Notification.updateOne = async () => {
    events.push('mark-scheduled');
    return { matchedCount: 1 };
  };
  logsManager.create = async () => ({});

  const result = await notificationsManager.recoverStale(1);

  assert.deepEqual(events, ['compare-and-set', 'enqueue', 'mark-scheduled']);
  assert.deepEqual(result, { recovered: 1, queuedRecovered: 0 });
  assert.equal(atomicUpdate.$set.status, 'queued');
  assert.equal(atomicUpdate.$set.enqueuePending, true);
  assert.equal(atomicUpdate.$set['deliveries.$[delivery].status'], 'queued');
  assert.equal(atomicUpdate.$unset.processingToken, 1);
  assert.deepEqual(atomicOptions.arrayFilters, [{ 'delivery.status': 'processing' }]);
});

test('recoverStale preserva queued pendente quando a fila falha apos o fencing atomico', async (context) => {
  const originals = {
    find: Notification.find,
    findOneAndUpdate: Notification.findOneAndUpdate,
    updateOne: Notification.updateOne,
    enqueue: queueService.enqueueNotification,
    log: logsManager.create
  };
  context.after(() => {
    Notification.find = originals.find;
    Notification.findOneAndUpdate = originals.findOneAndUpdate;
    Notification.updateOne = originals.updateOne;
    queueService.enqueueNotification = originals.enqueue;
    logsManager.create = originals.log;
  });
  const notificationId = '507f1f77bcf86cd799439099';
  let findCalls = 0;
  Notification.find = () => {
    const items = findCalls++ === 0 ? [{ _id: notificationId }] : [];
    const query = { select() { return query; }, lean: async () => items };
    return query;
  };
  Notification.findOneAndUpdate = async (filter, update) => {
    assert.equal(filter.status, 'processing');
    assert.equal(update.$set.enqueuePending, true);
    return { _id: notificationId };
  };
  let pendingUpdate;
  Notification.updateOne = async (_filter, update) => {
    pendingUpdate = update;
    return { matchedCount: 1 };
  };
  queueService.enqueueNotification = async () => { throw new Error('redis offline'); };
  logsManager.create = async () => ({});

  const result = await notificationsManager.recoverStale(1);

  assert.deepEqual(result, { recovered: 0, queuedRecovered: 0 });
  assert.equal(pendingUpdate.$set.enqueuePending, true);
  assert.equal(pendingUpdate.$set.errorCode, 'QUEUE_UNAVAILABLE');
  assert.equal(pendingUpdate.$unset.queueScheduledAt, 1);
});

test('recoverStale reenfileira notificacao queued que ficou sem job', async (context) => {
  const originals = {
    find: Notification.find,
    updateOne: Notification.updateOne,
    enqueue: queueService.enqueueNotification,
    log: logsManager.create
  };
  context.after(() => {
    Notification.find = originals.find;
    Notification.updateOne = originals.updateOne;
    queueService.enqueueNotification = originals.enqueue;
    logsManager.create = originals.log;
  });
  const notificationId = '507f1f77bcf86cd799439099';
  let findCalls = 0;
  Notification.find = () => {
    const items = findCalls++ === 0 ? [] : [{ _id: notificationId }];
    const query = { select() { return query; }, lean: async () => items };
    return query;
  };
  let enqueued;
  queueService.enqueueNotification = async (input) => { enqueued = input; return { mode: 'test' }; };
  Notification.updateOne = async () => ({ matchedCount: 1 });
  logsManager.create = async () => ({});

  const result = await notificationsManager.recoverStale(1);

  assert.deepEqual(result, { recovered: 0, queuedRecovered: 1 });
  assert.equal(enqueued.notificationId, notificationId);
  assert.match(enqueued.jobId, /-queue-recovery-/);
});

test('sweep considera job queued agendado ha mais tempo que o maior delay', () => {
  const cutoff = new Date('2026-07-21T12:00:00.000Z');
  const filter = notificationsManager.queuedRecoveryFilter(cutoff);
  assert.ok(filter.$or.some((item) => item.queueScheduledAt?.$lt === cutoff));
});

test('queue preserva jobId, token e stalledCounter ao chamar o manager', () => {
  const payload = queueService.workerPayload({
    id: 'bull-job-1',
    data: { notificationId: '507f1f77bcf86cd799439099' },
    opts: { attempts: 4 },
    attemptsStarted: 2,
    stalledCounter: 1
  }, 'bull-lock-2');
  assert.deepEqual(payload.queueContext, {
    jobId: 'bull-job-1',
    lockToken: 'bull-lock-2',
    attemptsStarted: 2,
    attemptsMade: 0,
    maxAttempts: 4,
    stalledCounter: 1
  });
});

test('queue falha rapido no produtor e mantem conexao bloqueante no worker', () => {
  assert.equal(queueService.connectionOptions().maxRetriesPerRequest, 1);
  assert.equal(queueService.connectionOptions({ blocking: true }).maxRetriesPerRequest, null);
});

test('receipt Cloud transitorio volta a entrega para a fila e agenda retry', async (context) => {
  const originals = {
    findOneAndUpdate: Notification.findOneAndUpdate,
    exists: Notification.exists,
    updateOne: Notification.updateOne,
    enqueue: queueService.enqueueNotification
  };
  context.after(() => {
    Notification.findOneAndUpdate = originals.findOneAndUpdate;
    Notification.exists = originals.exists;
    Notification.updateOne = originals.updateOne;
    queueService.enqueueNotification = originals.enqueue;
  });
  const delivery = {
    _id: '507f1f77bcf86cd799439091', channel: 'whatsapp_cloud', status: 'queued', attempts: 1,
    providerMessageId: 'wamid.retry'
  };
  const notification = {
    _id: '507f1f77bcf86cd799439099',
    status: 'queued',
    deliveries: [delivery],
    summary: { queued: 1, sent: 0, failed: 0, skipped: 0 }
  };
  let atomicFilter;
  let atomicPipeline;
  Notification.findOneAndUpdate = async (filter, pipeline) => {
    atomicFilter = filter;
    atomicPipeline = pipeline;
    return notification;
  };
  Notification.exists = async () => null;
  Notification.updateOne = async () => ({ matchedCount: 1 });
  let queued;
  queueService.enqueueNotification = async (input) => { queued = input; return { mode: 'test' }; };

  const result = await notificationsManager.reconcileCloudReceipt({
    id: 'wamid.retry',
    status: 'failed',
    errors: [{ code: 131000, title: 'Erro temporario', error_data: { details: 'Tente novamente' }, is_transient: true }]
  });

  assert.equal(result.matched, true);
  assert.equal(result.retryScheduled, true);
  assert.equal(delivery.status, 'queued');
  assert.equal(delivery.providerMessageId, 'wamid.retry');
  assert.equal(notification.status, 'queued');
  assert.equal(queued.notificationId, String(notification._id));
  assert.equal(result.errors[0].details, 'Tente novamente');
  assert.deepEqual(atomicFilter.status.$nin, ['processing', 'cancelled']);
  assert.equal(atomicFilter.deliveries.$elemMatch.providerMessageId, 'wamid.retry');
  assert.equal(Array.isArray(atomicPipeline), true);
});

test('receipt Cloud delivered atualiza entrega sem criar novo envio', async (context) => {
  const originals = {
    findOneAndUpdate: Notification.findOneAndUpdate,
    exists: Notification.exists
  };
  context.after(() => {
    Notification.findOneAndUpdate = originals.findOneAndUpdate;
    Notification.exists = originals.exists;
  });
  const delivery = {
    channel: 'whatsapp_cloud', status: 'sent', attempts: 1,
    providerMessageId: 'wamid.delivered'
  };
  const notification = {
    _id: '507f1f77bcf86cd799439098',
    status: 'sent',
    deliveries: [delivery],
    summary: { queued: 0, sent: 1, failed: 0, skipped: 0 }
  };
  let pipeline;
  Notification.findOneAndUpdate = async (_filter, update) => {
    pipeline = update;
    delivery.status = 'delivered';
    return notification;
  };
  Notification.exists = async () => null;

  const result = await notificationsManager.reconcileCloudReceipt({ id: 'wamid.delivered', status: 'delivered' });

  assert.equal(result.retryScheduled, false);
  assert.equal(delivery.status, 'delivered');
  assert.deepEqual(notification.summary, { queued: 0, sent: 1, failed: 0, skipped: 0 });
  assert.equal(notification.status, 'sent');
  assert.equal(Array.isArray(pipeline), true);
});

test('receipt Cloud fica pendente quando worker ja reivindicou a notificacao', async (context) => {
  const originals = {
    findOneAndUpdate: Notification.findOneAndUpdate,
    exists: Notification.exists,
    enqueue: queueService.enqueueNotification
  };
  context.after(() => {
    Notification.findOneAndUpdate = originals.findOneAndUpdate;
    Notification.exists = originals.exists;
    queueService.enqueueNotification = originals.enqueue;
  });
  Notification.findOneAndUpdate = async () => null;
  Notification.exists = async (filter) => filter.status === 'processing' ? { _id: '507f1f77bcf86cd799439099' } : null;
  let enqueueCalls = 0;
  queueService.enqueueNotification = async () => { enqueueCalls += 1; };

  await assert.rejects(
    notificationsManager.reconcileCloudReceipt({ id: 'wamid.processing', status: 'delivered' }),
    (error) => error.code === 'WHATSAPP_CLOUD_RECEIPT_PROCESSING'
  );
  assert.equal(enqueueCalls, 0);
});

test('dois reconciliadores do mesmo erro Cloud agendam apenas um retry', async (context) => {
  const originals = {
    findOneAndUpdate: Notification.findOneAndUpdate,
    exists: Notification.exists,
    updateOne: Notification.updateOne,
    enqueue: queueService.enqueueNotification
  };
  context.after(() => {
    Notification.findOneAndUpdate = originals.findOneAndUpdate;
    Notification.exists = originals.exists;
    Notification.updateOne = originals.updateOne;
    queueService.enqueueNotification = originals.enqueue;
  });
  const notification = {
    _id: '507f1f77bcf86cd799439099',
    status: 'queued',
    deliveries: [{
      _id: '507f1f77bcf86cd799439091', channel: 'whatsapp_cloud', status: 'queued', attempts: 1,
      providerMessageId: 'wamid.concurrent'
    }],
    summary: { queued: 1, sent: 0, failed: 0, skipped: 0 }
  };
  let transitionCalls = 0;
  Notification.findOneAndUpdate = async () => {
    transitionCalls += 1;
    return transitionCalls === 1 ? notification : null;
  };
  Notification.exists = async (filter) => filter.status === 'processing' ? null : { _id: notification._id };
  Notification.updateOne = async () => ({ matchedCount: 1 });
  let enqueueCalls = 0;
  queueService.enqueueNotification = async () => { enqueueCalls += 1; return { mode: 'test' }; };
  const receipt = {
    id: 'wamid.concurrent', status: 'failed', revisionToken: 'receipt-revision-1',
    errors: [{ code: 131000, is_transient: true }]
  };

  const results = await Promise.all([
    notificationsManager.reconcileCloudReceipt(receipt),
    notificationsManager.reconcileCloudReceipt(receipt)
  ]);

  assert.equal(results.filter((result) => result.retryScheduled).length, 1);
  assert.equal(results.filter((result) => result.ignored).length, 1);
  assert.equal(enqueueCalls, 1);
});

test('retries Cloud de deliveries diferentes recebem jobIds distintos', async (context) => {
  const originals = {
    findOneAndUpdate: Notification.findOneAndUpdate,
    exists: Notification.exists,
    updateOne: Notification.updateOne,
    enqueue: queueService.enqueueNotification
  };
  context.after(() => {
    Notification.findOneAndUpdate = originals.findOneAndUpdate;
    Notification.exists = originals.exists;
    Notification.updateOne = originals.updateOne;
    queueService.enqueueNotification = originals.enqueue;
  });
  Notification.findOneAndUpdate = async (filter) => {
    const providerMessageId = filter.deliveries.$elemMatch.providerMessageId;
    const suffix = providerMessageId.endsWith('one') ? '1' : '2';
    return {
      _id: '507f1f77bcf86cd799439099',
      status: 'queued',
      deliveries: [{
        _id: `507f1f77bcf86cd79943909${suffix}`,
        channel: 'whatsapp_cloud', status: 'queued', attempts: 1, providerMessageId
      }],
      summary: { queued: 1, sent: 0, failed: 0, skipped: 0 }
    };
  };
  Notification.exists = async () => null;
  Notification.updateOne = async () => ({ matchedCount: 1 });
  const jobIds = [];
  queueService.enqueueNotification = async (input) => { jobIds.push(input.jobId); return { mode: 'test' }; };
  const failure = { status: 'failed', errors: [{ code: 131000, is_transient: true }] };

  await notificationsManager.reconcileCloudReceipt({ ...failure, id: 'wamid.one', revisionToken: 'revision-one' });
  await notificationsManager.reconcileCloudReceipt({ ...failure, id: 'wamid.two', revisionToken: 'revision-two' });

  assert.equal(jobIds.length, 2);
  assert.notEqual(jobIds[0], jobIds[1]);
});

test('ProviderReceipt so marca como processada a revisao que foi reconciliada', async (context) => {
  const originals = {
    readyState: ProviderReceipt.db.readyState,
    findOneAndUpdate: ProviderReceipt.findOneAndUpdate,
    updateOne: ProviderReceipt.updateOne
  };
  context.after(() => {
    ProviderReceipt.db.readyState = originals.readyState;
    ProviderReceipt.findOneAndUpdate = originals.findOneAndUpdate;
    ProviderReceipt.updateOne = originals.updateOne;
  });
  ProviderReceipt.db.readyState = 1;
  let currentRevisionToken;
  ProviderReceipt.findOneAndUpdate = (_filter, update) => {
    currentRevisionToken = update.$set.revisionToken;
    return { lean: async () => ({ ...update.$set, providerMessageId: 'wamid.versioned' }) };
  };
  ProviderReceipt.updateOne = async (filter) => ({
    matchedCount: filter.revisionToken === currentRevisionToken ? 1 : 0
  });

  const delivered = await notificationsManager.storeCloudReceipt({ id: 'wamid.versioned', status: 'delivered' });
  const read = await notificationsManager.storeCloudReceipt({ id: 'wamid.versioned', status: 'read' });

  assert.notEqual(delivered.revisionToken, read.revisionToken);
  assert.equal(await notificationsManager.markCloudReceiptProcessed('wamid.versioned', delivered.revisionToken), false);
  assert.equal(await notificationsManager.markCloudReceiptProcessed('wamid.versioned', read.revisionToken), true);
});

test('META_131049 agenda uma unica tentativa isolada para 24 horas sem reabrir o lote', async (context) => {
  const originals = {
    findOneAndUpdate: Notification.findOneAndUpdate,
    exists: Notification.exists,
    enqueue: queueService.enqueueNotification
  };
  context.after(() => {
    Notification.findOneAndUpdate = originals.findOneAndUpdate;
    Notification.exists = originals.exists;
    queueService.enqueueNotification = originals.enqueue;
  });
  const delivery = {
    _id: '507f1f77bcf86cd799439091', channel: 'whatsapp_cloud', status: 'failed', attempts: 1,
    providerMessageId: 'wamid.ecosystem', automaticRetryAttempts: 0
  };
  const notification = {
    _id: '507f1f77bcf86cd799439099', status: 'failed', deliveries: [delivery],
    summary: { queued: 0, sent: 0, failed: 1, skipped: 0 }
  };
  let atomicPipeline;
  Notification.findOneAndUpdate = async (_filter, pipeline) => {
    atomicPipeline = pipeline;
    return notification;
  };
  Notification.exists = async () => null;
  let queued;
  queueService.enqueueNotification = async (input) => { queued = input; return { mode: 'test' }; };
  const startedAt = Date.now();

  const result = await notificationsManager.reconcileCloudReceipt({
    id: 'wamid.ecosystem', status: 'failed',
    errors: [{ code: 131049, error_data: { details: 'Healthy ecosystem engagement' } }]
  });

  assert.equal(result.retryKind, 'meta_ecosystem_24h');
  assert.equal(result.retryScheduled, true);
  assert.equal(queued.attempts, 1);
  assert.equal(queued.externalRetryDeliveryId, String(delivery._id));
  assert.ok(queued.delayMs >= notificationsManager.META_ECOSYSTEM_RETRY_DELAY_MS - 1000);
  assert.ok(new Date(result.retryAt).getTime() >= startedAt + notificationsManager.META_ECOSYSTEM_RETRY_DELAY_MS);
  assert.equal(atomicPipeline[2].$set.status.$switch.default, 'failed');
});

test('receipt duplicado META_131049 nao remove o cooldown nem agenda outro job', async (context) => {
  const originals = {
    findOneAndUpdate: Notification.findOneAndUpdate,
    exists: Notification.exists,
    enqueue: queueService.enqueueNotification
  };
  context.after(() => {
    Notification.findOneAndUpdate = originals.findOneAndUpdate;
    Notification.exists = originals.exists;
    queueService.enqueueNotification = originals.enqueue;
  });
  const notification = {
    _id: '507f1f77bcf86cd799439099', status: 'failed',
    deliveries: [{
      _id: '507f1f77bcf86cd799439091', channel: 'whatsapp_cloud', status: 'failed', attempts: 1,
      providerMessageId: 'wamid.ecosystem-duplicate', automaticRetryAttempts: 0
    }],
    summary: { queued: 0, sent: 0, failed: 1, skipped: 0 }
  };
  let transitions = 0;
  Notification.findOneAndUpdate = async () => (++transitions === 1 ? notification : null);
  Notification.exists = async (filter) => filter.status === 'processing' ? null : { _id: notification._id };
  let jobs = 0;
  queueService.enqueueNotification = async () => { jobs += 1; return { mode: 'test' }; };
  const receipt = { id: 'wamid.ecosystem-duplicate', status: 'failed', errors: [{ code: 131049 }] };

  const first = await notificationsManager.reconcileCloudReceipt(receipt);
  const duplicate = await notificationsManager.reconcileCloudReceipt(receipt);

  assert.equal(first.retryScheduled, true);
  assert.equal(duplicate.ignored, true);
  assert.equal(jobs, 1);
});

test('claim do retry Meta e atomico por delivery e incrementa a tentativa unica', async (context) => {
  const original = Notification.findOneAndUpdate;
  context.after(() => { Notification.findOneAndUpdate = original; });
  let filter;
  let pipeline;
  Notification.findOneAndUpdate = async (receivedFilter, receivedPipeline) => {
    filter = receivedFilter;
    pipeline = receivedPipeline;
    return { _id: receivedFilter._id };
  };

  await notificationsManager.activateExternalDeliveryRetry(
    '507f1f77bcf86cd799439099',
    '507f1f77bcf86cd799439091'
  );

  assert.equal(filter.deliveries.$elemMatch.status, 'failed');
  assert.equal(filter.deliveries.$elemMatch.externalErrorCode.$in[0], 'META_131049');
  assert.deepEqual(filter.deliveries.$elemMatch.automaticRetryAttempts, { $not: { $gte: 1 } });
  const selected = pipeline[0].$set.deliveries.$map.in.$cond[1].$mergeObjects[1];
  assert.equal(selected.status, 'queued');
  assert.deepEqual(selected.automaticRetryAttempts.$add[1], 1);
});

test('retry comum nao antecipa bloqueio Meta que ainda aguarda 24 horas', async (context) => {
  const original = Notification.findById;
  context.after(() => { Notification.findById = original; });
  const fake = {
    _id: '507f1f77bcf86cd799439099',
    deliveries: [{
      status: 'failed', errorCode: 'META_131049', externalProvider: 'meta',
      retryNotBefore: new Date(Date.now() + 60_000), automaticRetryAttempts: 0
    }]
  };
  Notification.findById = async () => fake;
  await assert.rejects(
    notificationsManager.retry(fake._id),
    (error) => error.statusCode === 409
  );
  assert.equal(fake.deliveries[0].status, 'failed');
});

test('retry manual por row reabre somente falhas Meta que ja consumiram a tentativa automatica', async (context) => {
  const originals = {
    find: Notification.find,
    updateOne: Notification.updateOne,
    enqueue: queueService.enqueueNotification
  };
  context.after(() => {
    Notification.find = originals.find;
    Notification.updateOne = originals.updateOne;
    queueService.enqueueNotification = originals.enqueue;
  });
  const notification = {
    _id: '507f1f77bcf86cd799439099', status: 'failed',
    deliveries: [
      { _id: '507f1f77bcf86cd799439091', status: 'failed', errorCode: 'META_131049', externalProvider: 'meta', externalErrorCode: 'META_131049', automaticRetryAttempts: 1 },
      { _id: '507f1f77bcf86cd799439092', status: 'failed', externalProvider: 'meta', externalErrorCode: 'META_131049', automaticRetryAttempts: 0, retryNotBefore: new Date(Date.now() + 60_000) }
    ],
    async save() {},
    toObject() { return this; }
  };
  Notification.find = async () => [notification];
  Notification.updateOne = async () => ({ matchedCount: 1 });
  let jobs = 0;
  queueService.enqueueNotification = async () => { jobs += 1; return { mode: 'test' }; };

  const result = await notificationsManager.retryExternalProviderIssue('META_131049');

  assert.equal(result.queued, 1);
  assert.equal(jobs, 1);
  assert.equal(notification.deliveries[0].status, 'queued');
  assert.equal(notification.deliveries[1].status, 'failed');
});

test('tabela externa agrupa somente erros Meta e expoe todos os retries manuais elegiveis', async (context) => {
  const original = Notification.aggregate;
  context.after(() => { Notification.aggregate = original; });
  let pipeline;
  Notification.aggregate = async (receivedPipeline) => {
    pipeline = receivedPipeline;
    return [{
      items: [{
        _id: { provider: 'meta', errorCode: 'META_131049' },
        errorMessage: 'Healthy ecosystem engagement',
        affectedDeliveries: 30,
        contactIds: ['507f1f77bcf86cd799439011'],
        notificationIds: ['507f1f77bcf86cd799439099'],
        pendingAutomaticRetry: 1,
        automaticRetryAttempted: 1,
        currentFailures: 1,
        deliveries: [{
          id: '507f1f77bcf86cd799439091',
          notificationId: '507f1f77bcf86cd799439099',
          contactId: '507f1f77bcf86cd799439011',
          status: 'failed',
          errorCode: 'META_131049',
          automaticRetryAttempts: 1
        }]
      }],
      metadata: [{ total: 1 }]
    }];
  };

  const result = await notificationsManager.listExternalProviderIssues({ page: 1, limit: 20 });

  assert.equal(result.items[0].provider, 'meta');
  assert.equal(result.items[0].affectedDeliveries, 30);
  assert.deepEqual(result.items[0].retryableDeliveryIds, ['507f1f77bcf86cd799439091']);
  const sliceStage = pipeline.find((stage) => stage.$facet).$facet.items.at(-1);
  assert.equal(sliceStage.$set.deliveries.$slice[1], notificationsManager.MAX_LIST_DELIVERY_SUMMARIES);
});
