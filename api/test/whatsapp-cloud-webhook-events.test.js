const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const crypto = require('node:crypto');
const WhatsappCloudWebhookEvent = require('../src/models/whatsapp-cloud-webhook-event.model');
const webhookEventsManager = require('../src/managers/whatsapp-cloud-webhook-events.manager');
const whatsappCloudManager = require('../src/managers/whatsapp-cloud.manager');
const settingsManager = require('../src/managers/settings.manager');
const authManager = require('../src/managers/auth.manager');
const contactsManager = require('../src/managers/contacts.manager');
const logsManager = require('../src/managers/logs.manager');
const adminNotificationsManager = require('../src/managers/admin-notifications.manager');
const conversationsManager = require('../src/managers/conversations.manager');
const chatProfileFlow = require('../src/services/chat-profile-flow.service');
const { decrypt } = require('../src/services/crypto.service');
const { WEBHOOK_PROCESSING_STATUS } = require('../src/enums/whatsapp-cloud-webhook');
const { createApp } = require('../src/app');

function restoreAfter(context, overrides) {
  const originals = overrides.map(([target, key]) => [target, key, target[key]]);
  context.after(() => {
    for (const [target, key, original] of originals) target[key] = original;
  });
}

function fictitiousMessagePayload() {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: '1111222233334444',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '551131234567',
            phone_number_id: '9999000011112222'
          },
          contacts: [{
            profile: { name: 'Contato Exemplo' },
            wa_id: '5511931234567',
            user_id: 'BR.12345678901234567'
          }],
          messages: [{
            from: '5511931234567',
            from_user_id: 'BR.12345678901234567',
            id: 'wamid.fictitious-message',
            timestamp: '1784605483',
            text: { body: 'Mensagem fictícia' },
            type: 'text'
          }]
        }
      }]
    }]
  };
}

function unsupportedMessagePayload() {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: '1111222233334444',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '551131234567',
            phone_number_id: '9999000011112222'
          },
          contacts: [{ wa_id: '441234567890', user_id: 'GB.1234567890123456' }],
          messages: [{
            from: '441234567890',
            from_user_id: 'GB.1234567890123456',
            id: 'wamid.unsupported-fictitious',
            timestamp: '1786036548',
            errors: [{
              code: 131051,
              title: 'Message type unknown',
              message: 'Message type unknown',
              error_data: { details: 'Message type is currently not supported.' }
            }],
            type: 'unsupported',
            unsupported: { type: 'unknown', raw_type: 'unknown' }
          }]
        }
      }]
    }]
  };
}

test('modelo protege o payload por padrao e possui indices de deduplicacao e consulta', () => {
  assert.equal(WhatsappCloudWebhookEvent.schema.path('payloadEncrypted').options.select, false);
  const indexes = WhatsappCloudWebhookEvent.schema.indexes();
  assert.ok(indexes.some(([fields, options]) => fields.dedupeKey === 1 && options.unique === true));
  assert.ok(indexes.some(([fields]) => fields.field === 1 && fields.receivedAt === -1));
  assert.ok(indexes.some(([fields]) => fields.processingStatus === 1 && fields.receivedAt === -1));
  assert.ok(indexes.some(([fields]) => fields.processingStatus === 1 && fields.processingLeaseUntil === 1));
  assert.deepEqual(
    [...WhatsappCloudWebhookEvent.schema.path('processingStatus').enumValues].sort(),
    Object.values(WEBHOOK_PROCESSING_STATUS).sort()
  );
  assert.equal(WhatsappCloudWebhookEvent.schema.path('processingToken').options.select, false);
  assert.equal(indexes.some(([, options]) => options.expireAfterSeconds !== undefined), false);
});

test('extrai messages, campos Meta arbitrarios e formato sample sem perder classificacao', () => {
  const messageEvent = webhookEventsManager.extractEvents(fictitiousMessagePayload())[0];
  assert.equal(messageEvent.field, 'messages');
  assert.equal(webhookEventsManager.eventTypeFor(messageEvent.field, messageEvent.value), 'message');
  assert.deepEqual(webhookEventsManager.eventTypesFor(messageEvent.field, messageEvent.value), ['message:text']);
  const summary = webhookEventsManager.buildSummary(messageEvent.field, messageEvent.value);
  assert.equal(summary.messageCount, 1);
  assert.equal(summary.contactCount, 1);
  assert.equal('contact' in summary, false);
  assert.doesNotMatch(JSON.stringify(summary), /Contato Exemplo|5511931234567|BR\.12345678901234567/);
  assert.doesNotMatch(JSON.stringify(summary), /Mensagem fictícia/);

  const arbitrary = {
    object: 'whatsapp_business_account',
    entry: [{
      id: '1111222233334444',
      changes: [{ field: 'account_update', value: { event: 'VERIFIED_ACCOUNT', phone_number: '551131234567' } }]
    }]
  };
  const arbitraryEvent = webhookEventsManager.extractEvents(arbitrary)[0];
  assert.equal(arbitraryEvent.field, 'account_update');
  assert.equal(webhookEventsManager.eventTypeFor(arbitraryEvent.field, arbitraryEvent.value), 'account_update');
  assert.deepEqual(webhookEventsManager.eventTypesFor(arbitraryEvent.field, arbitraryEvent.value), ['account_update']);

  const sampleEvent = webhookEventsManager.extractEvents({
    sample: { field: 'calls', value: { event: 'connect' } }
  })[0];
  assert.equal(sampleEvent.source, 'sample');
  assert.equal(sampleEvent.field, 'calls');
  assert.equal(sampleEvent.value.event, 'connect');
});

test('classifica mensagem unsupported 131051 e expoe apenas diagnostico seguro no resumo', () => {
  const event = webhookEventsManager.extractEvents(unsupportedMessagePayload())[0];
  assert.equal(event.kind, 'message');
  assert.equal(webhookEventsManager.eventTypeFor(event.field, event.value), 'unsupported_message');
  assert.deepEqual(
    webhookEventsManager.eventTypesFor(event.field, event.value),
    ['message:unsupported', 'error', 'error:131051']
  );

  const summary = webhookEventsManager.buildSummary(event.field, event.value);
  assert.equal(summary.messageCount, 1);
  assert.equal(summary.unsupportedCount, 1);
  assert.equal(summary.errorCount, 1);
  assert.deepEqual(summary.unsupportedTypes, ['unknown']);
  assert.deepEqual(summary.providerErrors, [{
    code: 131051,
    title: 'Message type unknown',
    message: 'Message type unknown',
    details: 'Message type is currently not supported.'
  }]);
  assert.match(summary.description, /mensagem nao suportada/);
  assert.match(summary.description, /META_131051: Message type unknown/);
  assert.doesNotMatch(JSON.stringify(summary), /441234567890|GB\.1234567890123456|wamid\.unsupported/);

  const unknownPayload = unsupportedMessagePayload();
  const unknownMessage = unknownPayload.entry[0].changes[0].value.messages[0];
  unknownMessage.type = 'unknown';
  delete unknownMessage.errors;
  const unknownEvent = webhookEventsManager.extractEvents(unknownPayload)[0];
  assert.equal(
    webhookEventsManager.eventTypeFor(unknownEvent.field, unknownEvent.value),
    'unsupported_message'
  );
});

test('coleta codigo e mensagem de erros Meta mesmo quando estao aninhados em outro tipo', () => {
  const payload = fictitiousMessagePayload();
  payload.entry[0].changes[0].value.messages[0].diagnostic = {
    delivery: {
      errors: [{
        code: 139999,
        title: 'Falha aninhada ficticia',
        message: 'Mensagem diagnostica ficticia',
        error_data: { details: 'Detalhe fornecido pelo provedor.' }
      }]
    }
  };
  const event = webhookEventsManager.extractEvents(payload)[0];
  const summary = webhookEventsManager.buildSummary(event.field, event.value);

  assert.deepEqual(summary.providerErrors, [{
    code: 139999,
    title: 'Falha aninhada ficticia',
    message: 'Mensagem diagnostica ficticia',
    details: 'Detalhe fornecido pelo provedor.'
  }]);
  assert.deepEqual(
    webhookEventsManager.eventTypesFor(event.field, event.value),
    ['message:text', 'error', 'error:139999']
  );
  assert.match(summary.description, /META_139999: Falha aninhada ficticia/);
});

test('dedupe semantico ignora ordem e envelope, mas preserva transicoes de status', () => {
  const firstMessage = fictitiousMessagePayload();
  const changedEnvelope = fictitiousMessagePayload();
  changedEnvelope.entry[0].changes[0].value.messages[0].text.body = 'Conteudo alterado no retry';
  changedEnvelope.entry[0].changes.unshift({
    field: 'account_alerts',
    value: { alert_type: 'FICTITIOUS_ALERT' }
  });
  const messageA = webhookEventsManager.extractEvents(firstMessage)
    .find((event) => event.kind === 'message');
  const messageB = webhookEventsManager.extractEvents(changedEnvelope)
    .find((event) => event.kind === 'message');
  assert.equal(
    webhookEventsManager.dedupeKeyFor(messageA),
    webhookEventsManager.dedupeKeyFor(messageB)
  );

  const changesA = {
    object: 'whatsapp_business_account',
    entry: [{
      id: '1111222233334444',
      changes: [
        { field: 'account_update', value: { event: 'VERIFIED_ACCOUNT' } },
        { field: 'calls', value: { event: 'connect', call_id: 'call.fictitious' } }
      ]
    }]
  };
  const changesB = {
    object: 'whatsapp_business_account',
    entry: [{
      id: '1111222233334444',
      changes: [...changesA.entry[0].changes].reverse()
    }]
  };
  const keysA = webhookEventsManager.extractEvents(changesA).map(webhookEventsManager.dedupeKeyFor).sort();
  const keysB = webhookEventsManager.extractEvents(changesB).map(webhookEventsManager.dedupeKeyFor).sort();
  assert.deepEqual(keysA, keysB);

  const statusPayload = (status, timestamp) => ({
    object: 'whatsapp_business_account',
    entry: [{
      id: '1111222233334444',
      changes: [{
        field: 'messages',
        value: {
          statuses: [{
            id: 'wamid.fictitious-status',
            status,
            timestamp,
            recipient_id: '5511931234567'
          }]
        }
      }]
    }]
  });
  const sent = webhookEventsManager.extractEvents(statusPayload('sent', '1784605483'))[0];
  const sentRetry = webhookEventsManager.extractEvents(statusPayload('sent', '1784605499'))[0];
  const delivered = webhookEventsManager.extractEvents(statusPayload('delivered', '1784605500'))[0];
  assert.equal(webhookEventsManager.dedupeKeyFor(sent), webhookEventsManager.dedupeKeyFor(sentRetry));
  assert.notEqual(webhookEventsManager.dedupeKeyFor(sent), webhookEventsManager.dedupeKeyFor(delivered));
});

test('persiste payload completo criptografado e deduplica retries pelo corpo canonico', async (context) => {
  restoreAfter(context, [
    [WhatsappCloudWebhookEvent, 'updateOne'],
    [WhatsappCloudWebhookEvent, 'findOne']
  ]);
  let stored;
  WhatsappCloudWebhookEvent.updateOne = async (_filter, update, options = {}) => {
    const created = !stored && options.upsert;
    if (created) {
      stored = {
        _id: '507f1f77bcf86cd799439011',
        ...update.$setOnInsert,
        receiptCount: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };
    }
    if (!stored) return { matchedCount: 0, upsertedCount: 0 };
    if (update.$set) Object.assign(stored, update.$set);
    stored.receiptCount += Number(update.$inc?.receiptCount || 0);
    return { matchedCount: created ? 0 : 1, upsertedCount: created ? 1 : 0 };
  };
  WhatsappCloudWebhookEvent.findOne = () => ({ lean: async () => ({ ...stored }) });

  const payload = fictitiousMessagePayload();
  payload.entry[0].changes[0].value.opaque_data = { nested: ['preservado', 42] };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const first = await webhookEventsManager.persistPayload(payload, rawBody);

  assert.equal(first.createdCount, 1);
  assert.equal(first.duplicateCount, 0);
  assert.equal(stored.receiptCount, 1);
  assert.match(stored.payloadEncrypted, /^enc:v1:/);
  assert.deepEqual(decrypt(stored.payloadEncrypted, { json: true }), { payload });
  assert.doesNotMatch(stored.payloadEncrypted, /preservado|fictitious-message/);

  stored.processingStatus = 'processed';
  const equivalentWithDifferentKeyOrder = {
    entry: payload.entry,
    object: payload.object
  };
  const duplicate = await webhookEventsManager.persistPayload(equivalentWithDifferentKeyOrder);
  assert.equal(duplicate.createdCount, 0);
  assert.equal(duplicate.duplicateCount, 1);
  assert.equal(duplicate.workItems.length, 1);
  assert.equal(stored.receiptCount, 2);
  assert.equal(duplicate.events[0].duplicateCount, 1);
});

test('detalhe persiste codigo de email redigido sem alterar dedupe nem descriptor de processamento', async (context) => {
  restoreAfter(context, [
    [WhatsappCloudWebhookEvent, 'updateOne'],
    [WhatsappCloudWebhookEvent, 'findOne'],
    [WhatsappCloudWebhookEvent, 'findById']
  ]);
  let stored;
  WhatsappCloudWebhookEvent.updateOne = async (_filter, update, options = {}) => {
    const created = !stored && options.upsert;
    if (created) {
      stored = {
        _id: '507f1f77bcf86cd799439011',
        ...update.$setOnInsert,
        receiptCount: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };
    }
    if (update.$set) Object.assign(stored, update.$set);
    stored.receiptCount += Number(update.$inc?.receiptCount || 0);
    return { matchedCount: created ? 0 : 1, upsertedCount: created ? 1 : 0 };
  };
  WhatsappCloudWebhookEvent.findOne = () => ({ lean: async () => ({ ...stored }) });
  WhatsappCloudWebhookEvent.findById = () => {
    const chain = {
      select() { return chain; },
      async lean() { return { ...stored }; }
    };
    return chain;
  };
  const payload = fictitiousMessagePayload();
  payload.entry[0].changes[0].value.messages[0].text.body = '483921';
  const rawBody = Buffer.from(JSON.stringify(payload));

  const persisted = await webhookEventsManager.persistPayload(payload, rawBody, {
    redactedMessageIds: ['wamid.fictitious-message'],
    redactionText: chatProfileFlow.EMAIL_VERIFICATION_CODE_PLACEHOLDER
  });

  assert.equal(
    persisted.workItems[0].descriptor.value.messages[0].text.body,
    '483921'
  );
  const originalHash = stored.payloadHash;
  const detail = await webhookEventsManager.getById(stored._id);
  assert.equal(
    detail.payload.entry[0].changes[0].value.messages[0].text.body,
    chatProfileFlow.EMAIL_VERIFICATION_CODE_PLACEHOLDER
  );
  assert.doesNotMatch(JSON.stringify(detail), /483921/);

  await webhookEventsManager.persistPayload(payload, rawBody, {
    redactedMessageIds: ['wamid.fictitious-message'],
    redactionText: chatProfileFlow.EMAIL_VERIFICATION_CODE_PLACEHOLDER
  });
  assert.equal(stored.payloadHash, originalHash);
  assert.equal(stored.receiptCount, 2);
  assert.doesNotMatch(
    JSON.stringify(decrypt(stored.payloadEncrypted, { json: true })),
    /483921/
  );
});

test('claim atomico bloqueia concorrencia e permite retry apos falha ou lease stale', async (context) => {
  restoreAfter(context, [[WhatsappCloudWebhookEvent, 'findOneAndUpdate']]);
  const state = {
    _id: '507f1f77bcf86cd799439011',
    processingStatus: WEBHOOK_PROCESSING_STATUS.RECEIVED,
    processingAttempts: 0,
    receiptCount: 1,
    field: 'messages',
    eventType: 'message',
    eventTypes: ['message:text'],
    summary: { messageCount: 1 },
    receivedAt: new Date(),
    lastReceivedAt: new Date(),
    occurredAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date()
  };
  WhatsappCloudWebhookEvent.findOneAndUpdate = (filter, update) => ({
    lean: async () => {
      const expectedToken = filter.processingToken;
      let matches;
      if (expectedToken) {
        matches = state.processingToken === expectedToken
          && state.processingStatus === filter.processingStatus;
      } else {
        const allowedStatuses = filter.processingStatus?.$in || [];
        const staleAt = filter.$or?.find((item) => item.processingLeaseUntil?.$lte)
          ?.processingLeaseUntil.$lte;
        matches = allowedStatuses.includes(state.processingStatus)
          && (!state.processingLeaseUntil || state.processingLeaseUntil <= staleAt);
      }
      if (!matches) return null;
      Object.assign(state, update.$set || {});
      state.processingAttempts += Number(update.$inc?.processingAttempts || 0);
      for (const key of Object.keys(update.$unset || {})) delete state[key];
      state.updatedAt = new Date();
      return { ...state };
    }
  });

  const now = new Date('2026-07-27T12:00:00.000Z');
  const concurrent = await Promise.all([
    webhookEventsManager.claimEvent(state._id, { now }),
    webhookEventsManager.claimEvent(state._id, { now })
  ]);
  const winner = concurrent.find(Boolean);
  assert.equal(concurrent.filter(Boolean).length, 1);
  assert.equal(state.processingStatus, WEBHOOK_PROCESSING_STATUS.PROCESSING);
  assert.equal(state.processingAttempts, 1);

  assert.equal(await webhookEventsManager.markFailed(winner, new Error('falha transitória')), true);
  assert.equal(state.processingStatus, WEBHOOK_PROCESSING_STATUS.FAILED);
  const retry = await webhookEventsManager.claimEvent(state._id, {
    now: new Date('2026-07-27T12:00:01.000Z')
  });
  assert.ok(retry);
  assert.notEqual(retry.token, winner.token);
  assert.equal(await webhookEventsManager.markProcessed(retry), true);
  assert.equal(state.processingStatus, WEBHOOK_PROCESSING_STATUS.PROCESSED);

  state.processingStatus = WEBHOOK_PROCESSING_STATUS.PROCESSING;
  state.processingToken = 'worker-abandonado';
  state.processingLeaseUntil = new Date('2026-07-27T11:59:00.000Z');
  const reclaimed = await webhookEventsManager.claimEvent(state._id, { now });
  assert.ok(reclaimed);
  assert.notEqual(reclaimed.token, 'worker-abandonado');
});

test('lista somente resumo seguro e detalhe autenticado abre o JSON completo', async (context) => {
  restoreAfter(context, [
    [WhatsappCloudWebhookEvent, 'find'],
    [WhatsappCloudWebhookEvent, 'countDocuments'],
    [WhatsappCloudWebhookEvent, 'findById']
  ]);
  const payload = fictitiousMessagePayload();
  const now = new Date();
  const record = {
    _id: '507f1f77bcf86cd799439011',
    object: payload.object,
    businessAccountId: payload.entry[0].id,
    field: 'messages',
    eventType: 'message',
    eventTypes: ['message:text'],
    summary: { title: 'WhatsApp Cloud · messages', messageCount: 1 },
    processingStatus: 'processed',
    receiptCount: 1,
    occurredAt: now,
    receivedAt: now,
    lastReceivedAt: now,
    processedAt: now,
    createdAt: now,
    updatedAt: now,
    payloadEncrypted: require('../src/services/crypto.service').encrypt({ payload }),
    dedupeKey: 'nao-expor-dedupe',
    payloadHash: 'nao-expor-hash'
  };
  WhatsappCloudWebhookEvent.find = () => {
    const query = {
      sort: () => query,
      skip: () => query,
      limit: () => query,
      lean: async () => [{ ...record }]
    };
    return query;
  };
  WhatsappCloudWebhookEvent.countDocuments = async () => 1;
  WhatsappCloudWebhookEvent.findById = () => {
    const query = {
      select: () => query,
      lean: async () => ({ ...record })
    };
    return query;
  };

  const list = await webhookEventsManager.list({ page: '1', limit: '10', field: 'messages' });
  assert.equal(list.total, 1);
  assert.equal(list.items[0].field, 'messages');
  assert.equal('payload' in list.items[0], false);
  assert.equal('payloadEncrypted' in list.items[0], false);
  assert.equal('dedupeKey' in list.items[0], false);
  assert.equal('payloadHash' in list.items[0], false);

  const detail = await webhookEventsManager.getById(record._id);
  assert.deepEqual(detail.payload, payload);
  assert.equal('payloadEncrypted' in detail, false);
  await assert.rejects(
    () => webhookEventsManager.getById('id-invalido'),
    (error) => error.code === 'INVALID_WEBHOOK_EVENT_ID' && error.statusCode === 400
  );
});

test('historico e detalhes exigem autenticacao e desabilitam cache', async (context) => {
  restoreAfter(context, [
    [authManager, 'authenticateAccess'],
    [webhookEventsManager, 'list'],
    [webhookEventsManager, 'getById']
  ]);
  authManager.authenticateAccess = async () => ({ id: '507f1f77bcf86cd799439099' });
  webhookEventsManager.list = async () => ({ items: [], total: 0, page: 1, limit: 20, pages: 0 });
  webhookEventsManager.getById = async (id) => ({ id, payload: { field: 'fictitious' } });
  const app = createApp();
  const unauthorized = await request(app).get('/api/whatsapp-cloud/webhook-events');
  const list = await request(app)
    .get('/api/whatsapp-cloud/webhook-events')
    .set('Authorization', 'Bearer admin-token');
  const detail = await request(app)
    .get('/api/whatsapp-cloud/webhook-events/507f1f77bcf86cd799439011')
    .set('Authorization', 'Bearer admin-token');
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.body.error.code, 'AUTH_REQUIRED');
  for (const response of [unauthorized, list, detail]) {
    assert.match(response.headers['cache-control'], /no-store/);
    assert.equal(response.headers.pragma, 'no-cache');
    assert.match(response.headers.vary, /Authorization/i);
  }
  assert.equal(list.status, 200);
  assert.equal(detail.status, 200);
});

test('webhook assinado persiste campo Meta desconhecido e o marca como processado', async (context) => {
  restoreAfter(context, [
    [settingsManager, 'getValue'],
    [webhookEventsManager, 'persistPayload'],
    [webhookEventsManager, 'claimEvent'],
    [webhookEventsManager, 'markProcessed'],
    [webhookEventsManager, 'markFailed']
  ]);
  const appSecret = 'segredo-ficticio-da-meta';
  settingsManager.getValue = async (key) => key === 'WHATSAPP_CLOUD_APP_SECRET' ? appSecret : null;
  let persistedPayload;
  let processedClaim;
  webhookEventsManager.persistPayload = async (payload) => {
    persistedPayload = payload;
    const descriptor = webhookEventsManager.extractEvents(payload)[0];
    return {
      events: [{
        id: '507f1f77bcf86cd799439011',
        field: 'account_alerts',
        eventType: 'account_alerts',
        summary: { messageCount: 0, statusCount: 0 },
        processingStatus: 'received',
        created: true
      }],
      workItems: [{ eventId: '507f1f77bcf86cd799439011', descriptor }],
      createdCount: 1,
      duplicateCount: 0
    };
  };
  webhookEventsManager.claimEvent = async (id) => ({ id, token: 'claim-token' });
  webhookEventsManager.markProcessed = async (claim) => { processedClaim = claim; return true; };
  webhookEventsManager.markFailed = async () => assert.fail('nao deve marcar falha');
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: '1111222233334444',
      changes: [{ field: 'account_alerts', value: { alert_type: 'FICTITIOUS_ALERT' } }]
    }]
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const result = await whatsappCloudManager.webhook(payload, rawBody, signature);
  assert.deepEqual(persistedPayload, payload);
  assert.deepEqual(processedClaim, {
    id: '507f1f77bcf86cd799439011',
    token: 'claim-token'
  });
  assert.equal(result.received, true);
  assert.equal(result.receivedEvents, 1);
  assert.equal(result.persistedEvents, 1);
  assert.equal(result.receivedMessages, 0);
  assert.equal(result.receivedStatuses, 0);
});

test('webhook unsupported 131051 abre conversa tecnica sem cadastrar contato', async (context) => {
  restoreAfter(context, [
    [settingsManager, 'getValue'],
    [contactsManager, 'findByChannelAddress'],
    [contactsManager, 'findByChannelOrPhone'],
    [contactsManager, 'upsertFromChannel'],
    [logsManager, 'create'],
    [conversationsManager, 'recordInbound'],
    [webhookEventsManager, 'persistPayload'],
    [webhookEventsManager, 'claimEvent'],
    [webhookEventsManager, 'markProcessed'],
    [webhookEventsManager, 'markFailed']
  ]);
  const appSecret = 'segredo-ficticio-da-meta';
  settingsManager.getValue = async (key) => key === 'WHATSAPP_CLOUD_APP_SECRET'
    ? appSecret
    : null;
  let contactOperations = 0;
  contactsManager.findByChannelAddress = async () => { contactOperations += 1; return null; };
  contactsManager.findByChannelOrPhone = async () => { contactOperations += 1; return null; };
  contactsManager.upsertFromChannel = async () => { contactOperations += 1; return null; };
  let conversationWrites = 0;
  let conversationInput;
  conversationsManager.recordInbound = async (input) => {
    conversationWrites += 1;
    conversationInput = input;
    return {
      conversation: {
        id: '507f1f77bcf86cd799439188',
        contactId: null
      },
      message: { id: '507f1f77bcf86cd799439189', metadata: input.metadata }
    };
  };
  let diagnosticLog;
  logsManager.create = async (input) => { diagnosticLog = input; return {}; };

  const payload = unsupportedMessagePayload();
  const descriptor = webhookEventsManager.extractEvents(payload)[0];
  webhookEventsManager.persistPayload = async () => ({
    events: [{
      id: '507f1f77bcf86cd799439077',
      field: 'messages',
      eventType: 'unsupported_message',
      summary: webhookEventsManager.buildSummary(descriptor.field, descriptor.value),
      processingStatus: 'received',
      created: true
    }],
    workItems: [{ eventId: '507f1f77bcf86cd799439077', descriptor }],
    createdCount: 1,
    duplicateCount: 0
  });
  webhookEventsManager.claimEvent = async (id) => ({ id, token: 'claim-unsupported' });
  let processedClaim;
  webhookEventsManager.markProcessed = async (claim) => { processedClaim = claim; return true; };
  webhookEventsManager.markFailed = async () => assert.fail('evento unsupported nao deve falhar');

  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const result = await whatsappCloudManager.webhook(payload, rawBody, signature);

  assert.equal(result.received, true);
  assert.equal(result.unsupportedMessages, 1);
  assert.equal(result.receivedMessages, 1);
  assert.equal(result.createdContacts, 0);
  assert.equal(result.updatedContacts, 0);
  assert.equal(contactOperations, 0);
  assert.equal(conversationWrites, 1);
  assert.equal(conversationInput.contactId, undefined);
  assert.equal(conversationInput.externalId, '441234567890');
  assert.equal(conversationInput.type, 'unsupported');
  assert.match(conversationInput.body, /Conteudo original nao fornecido pela Meta/);
  assert.match(conversationInput.body, /Erro tecnico da Meta META_131051/);
  assert.match(conversationInput.body, /Message type unknown/);
  assert.match(conversationInput.body, /Message type is currently not supported/);
  assert.equal(conversationInput.metadata.unsupported.contentProvided, false);
  assert.deepEqual(conversationInput.metadata.providerErrors, [{
    code: 131051,
    title: 'Message type unknown',
    message: 'Message type unknown',
    details: 'Message type is currently not supported.'
  }]);
  assert.equal(diagnosticLog.action, 'message.unsupported');
  assert.equal(diagnosticLog.context.providerErrors[0].code, 131051);
  assert.deepEqual(processedClaim, {
    id: '507f1f77bcf86cd799439077',
    token: 'claim-unsupported'
  });
});

test('mensagem unsupported preserva codigo explicito que realmente veio no payload', () => {
  const payload = unsupportedMessagePayload();
  const message = payload.entry[0].changes[0].value.messages[0];
  message.unsupported.verification_code = '654321';

  const body = whatsappCloudManager.cloudMessageBody(message);
  const metadata = whatsappCloudManager.cloudConversationMetadata(
    message,
    payload.entry[0].changes[0].value,
    payload.entry[0].id
  );

  assert.match(body, /^654321\n/);
  assert.doesNotMatch(body, /Conteudo original nao fornecido/);
  assert.match(body, /Erro tecnico da Meta META_131051/);
  assert.equal(metadata.unsupported.contentProvided, true);

  delete message.unsupported.verification_code;
  message.unsupported.payload = { body: 'Codigo explicito em payload aninhado: 112233' };
  assert.match(
    whatsappCloudManager.cloudMessageBody(message),
    /^Codigo explicito em payload aninhado: 112233\n/
  );
});

test('webhook identifica desafio ativo e pede redacao do codigo antes da persistencia', async (context) => {
  restoreAfter(context, [
    [settingsManager, 'getValue'],
    [contactsManager, 'findByChannelAddress'],
    [chatProfileFlow, 'shouldRedactEmailVerificationCode'],
    [webhookEventsManager, 'persistPayload']
  ]);
  const appSecret = 'segredo-ficticio-da-meta';
  settingsManager.getValue = async (key) => (
    key === 'WHATSAPP_CLOUD_APP_SECRET' ? appSecret : null
  );
  contactsManager.findByChannelAddress = async (channel, address) => {
    assert.equal(channel, 'whatsapp_cloud');
    assert.equal(address, '5511931234567');
    return { id: '507f1f77bcf86cd799439011' };
  };
  chatProfileFlow.shouldRedactEmailVerificationCode = async (contactId, text) => {
    assert.equal(contactId, '507f1f77bcf86cd799439011');
    assert.equal(text, '483921');
    return true;
  };
  let persistenceOptions;
  webhookEventsManager.persistPayload = async (_payload, _rawBody, options) => {
    persistenceOptions = options;
    return {
      events: [],
      workItems: [],
      createdCount: 0,
      duplicateCount: 0
    };
  };
  const payload = fictitiousMessagePayload();
  payload.entry[0].changes[0].value.messages[0].text.body = '483921';
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = 'sha256='
    + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const result = await whatsappCloudManager.webhook(payload, rawBody, signature);

  assert.deepEqual(persistenceOptions.redactedMessageIds, ['wamid.fictitious-message']);
  assert.equal(
    persistenceOptions.redactionText,
    chatProfileFlow.EMAIL_VERIFICATION_CODE_PLACEHOLDER
  );
  assert.equal(result.received, true);
});

test('webhooks concorrentes identicos executam o efeito de mensagem uma unica vez', async (context) => {
  restoreAfter(context, [
    [settingsManager, 'getValue'],
    [settingsManager, 'isWhatsappPermissionCommand'],
    [contactsManager, 'findByChannelAddress'],
    [contactsManager, 'findByChannelOrPhone'],
    [contactsManager, 'upsertFromChannel'],
    [logsManager, 'create'],
    [adminNotificationsManager, 'create'],
    [conversationsManager, 'recordInbound'],
    [webhookEventsManager, 'persistPayload'],
    [webhookEventsManager, 'claimEvent'],
    [webhookEventsManager, 'markProcessed'],
    [webhookEventsManager, 'markFailed']
  ]);
  const appSecret = 'segredo-ficticio-da-meta';
  settingsManager.getValue = async (key) => key === 'WHATSAPP_CLOUD_APP_SECRET' ? appSecret : null;
  settingsManager.isWhatsappPermissionCommand = async () => false;
  contactsManager.findByChannelAddress = async () => null;
  contactsManager.findByChannelOrPhone = async () => null;
  let contactUpserts = 0;
  contactsManager.upsertFromChannel = async (input) => {
    contactUpserts += 1;
    return {
      id: '507f1f77bcf86cd799439088',
      displayName: input.displayName,
      channels: [],
      upsertState: { created: true, identityAdded: true }
    };
  };
  logsManager.create = async () => ({});
  adminNotificationsManager.create = async () => ({});
  conversationsManager.recordInbound = async () => ({
    conversation: { id: '507f1f77bcf86cd799439188', channel: 'whatsapp_cloud' },
    message: { id: '507f1f77bcf86cd799439189' }
  });

  const payload = fictitiousMessagePayload();
  const descriptor = webhookEventsManager.extractEvents(payload)[0];
  let persistenceCalls = 0;
  webhookEventsManager.persistPayload = async () => {
    persistenceCalls += 1;
    return {
      events: [{
        id: '507f1f77bcf86cd799439011',
        field: 'messages',
        eventType: 'message',
        summary: { messageCount: 1, statusCount: 0 },
        processingStatus: persistenceCalls === 1 ? 'received' : 'processing',
        created: persistenceCalls === 1
      }],
      workItems: [{ eventId: '507f1f77bcf86cd799439011', descriptor }],
      createdCount: persistenceCalls === 1 ? 1 : 0,
      duplicateCount: persistenceCalls === 1 ? 0 : 1
    };
  };
  let alreadyClaimed = false;
  webhookEventsManager.claimEvent = async (id) => {
    if (alreadyClaimed) return null;
    alreadyClaimed = true;
    return { id, token: 'claim-vencedor' };
  };
  let processed = 0;
  webhookEventsManager.markProcessed = async () => { processed += 1; return true; };
  webhookEventsManager.markFailed = async () => assert.fail('nao deve marcar falha');
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const results = await Promise.all([
    whatsappCloudManager.webhook(payload, rawBody, signature),
    whatsappCloudManager.webhook(payload, rawBody, signature)
  ]);

  assert.equal(contactUpserts, 1);
  assert.equal(processed, 1);
  assert.deepEqual(results.map((result) => result.claimedEvents).sort(), [0, 1]);
  assert.deepEqual(results.map((result) => result.receivedMessages).sort(), [0, 1]);
});

test('assinatura invalida e rejeitada antes de qualquer persistencia', async (context) => {
  restoreAfter(context, [
    [settingsManager, 'getValue'],
    [webhookEventsManager, 'persistPayload']
  ]);
  settingsManager.getValue = async (key) => key === 'WHATSAPP_CLOUD_APP_SECRET'
    ? 'segredo-ficticio-da-meta'
    : null;
  let persistenceAttempts = 0;
  webhookEventsManager.persistPayload = async () => { persistenceAttempts += 1; };
  const payload = { sample: { field: 'account_update', value: { event: 'FICTITIOUS_EVENT' } } };
  const rawBody = Buffer.from(JSON.stringify(payload));

  await assert.rejects(
    () => whatsappCloudManager.webhook(payload, rawBody, 'sha256=assinatura-invalida'),
    (error) => error.statusCode === 401 && /Assinatura Meta invalida/.test(error.message)
  );
  assert.equal(persistenceAttempts, 0);
});
