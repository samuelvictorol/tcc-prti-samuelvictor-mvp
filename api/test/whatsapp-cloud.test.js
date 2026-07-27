const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Setting = require('../src/models/setting.model');
const settingsManager = require('../src/managers/settings.manager');
const logsManager = require('../src/managers/logs.manager');
const contactsManager = require('../src/managers/contacts.manager');
const adminNotificationsManager = require('../src/managers/admin-notifications.manager');
const whatsappCloudManager = require('../src/managers/whatsapp-cloud.manager');
const webhookEventsManager = require('../src/managers/whatsapp-cloud-webhook-events.manager');
const whatsappCloudController = require('../src/controllers/whatsapp-cloud.controller');
const templatesManager = require('../src/managers/templates.manager');
const notificationsManager = require('../src/managers/notifications.manager');
const { channelSendSchema } = require('../src/dtos/channels.dto');
const { createTemplateSchema } = require('../src/dtos/templates.dto');
const { buildCustomTemplateMessage, normalizeBuilder } = require('../src/utils/whatsapp-cloud-templates');

function restoreAfter(context, overrides) {
  const originals = overrides.map(([target, key]) => [target, key, target[key]]);
  context.after(() => {
    for (const [target, key, original] of originals) target[key] = original;
  });
}

function stubWebhookPersistence(context) {
  restoreAfter(context, [
    [webhookEventsManager, 'persistPayload'],
    [webhookEventsManager, 'claimEvent'],
    [webhookEventsManager, 'markProcessed'],
    [webhookEventsManager, 'markFailed']
  ]);
  webhookEventsManager.persistPayload = async (payload) => {
    const descriptors = webhookEventsManager.extractEvents(payload);
    const events = descriptors.map((descriptor, index) => ({
      id: '507f1f77bcf86cd7994391' + index,
      field: descriptor.field,
      eventType: webhookEventsManager.eventTypeFor(descriptor.field, descriptor.value),
      summary: webhookEventsManager.buildSummary(descriptor.field, descriptor.value),
      processingStatus: 'received',
      created: true
    }));
    return {
      events,
      workItems: descriptors.map((descriptor, index) => ({
        eventId: events[index].id,
        descriptor
      })),
      createdCount: events.length,
      duplicateCount: 0
    };
  };
  webhookEventsManager.claimEvent = async (eventId) => ({ id: eventId, token: 'claim-token' });
  webhookEventsManager.markProcessed = async () => true;
  webhookEventsManager.markFailed = async () => true;
}

test('canal fica disponivel para envio sem depender das credenciais de webhook', async (context) => {
  const originalFindOne = Setting.findOne;
  const keys = [
    'WHATSAPP_CLOUD_ACCESS_TOKEN',
    'WHATSAPP_CLOUD_PHONE_NUMBER_ID',
    'WHATSAPP_CLOUD_VERIFY_TOKEN',
    'WHATSAPP_CLOUD_APP_SECRET'
  ];
  const originalEnvironment = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  context.after(() => {
    Setting.findOne = originalFindOne;
    for (const key of keys) {
      if (originalEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[key];
    }
  });
  const query = { select: () => query, lean: async () => null };
  Setting.findOne = () => query;
  process.env.WHATSAPP_CLOUD_ACCESS_TOKEN = 'access';
  process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID = 'phone-id';
  delete process.env.WHATSAPP_CLOUD_VERIFY_TOKEN;
  delete process.env.WHATSAPP_CLOUD_APP_SECRET;

  assert.equal(await settingsManager.channelConfigured('whatsapp_cloud'), true);
});

test('status separa preparo de envio, challenge e assinatura do WhatsApp Cloud', async (context) => {
  restoreAfter(context, [[settingsManager, 'getValue']]);
  const values = {
    WHATSAPP_CLOUD_ACCESS_TOKEN: 'access',
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: 'phone-id',
    WHATSAPP_CLOUD_API_VERSION: 'v25.0'
  };
  settingsManager.getValue = async (key) => values[key] || null;

  assert.deepEqual(await whatsappCloudManager.status(), {
    configured: true,
    sendConfigured: true,
    webhookVerificationConfigured: false,
    webhookSignatureConfigured: false,
    webhookConfigured: false,
    apiVersion: 'v25.0'
  });
});

test('challenge do webhook exige somente o verify token', async (context) => {
  restoreAfter(context, [[settingsManager, 'getValue']]);
  const requested = [];
  settingsManager.getValue = async (key) => {
    requested.push(key);
    return key === 'WHATSAPP_CLOUD_VERIFY_TOKEN' ? 'verify-only' : null;
  };

  assert.equal(await whatsappCloudManager.verifyChallenge('subscribe', 'verify-only', 'meta-challenge'), 'meta-challenge');
  assert.deepEqual(requested, ['WHATSAPP_CLOUD_VERIFY_TOKEN']);
});

test('controller aceita parametros hub sanitizados com underscore', async (context) => {
  restoreAfter(context, [[settingsManager, 'getValue']]);
  settingsManager.getValue = async (key) => key === 'WHATSAPP_CLOUD_VERIFY_TOKEN' ? 'verify-only' : null;
  const response = {
    statusCode: null,
    body: null,
    status(value) { this.statusCode = value; return this; },
    send(value) { this.body = value; return this; }
  };

  await whatsappCloudController.verifyWebhook({
    query: {
      hub_mode: 'subscribe',
      hub_verify_token: 'verify-only',
      hub_challenge: 'meta-sanitized-challenge'
    }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, 'meta-sanitized-challenge');
});

test('POST do webhook valida somente com App Secret', async (context) => {
  stubWebhookPersistence(context);
  restoreAfter(context, [[settingsManager, 'getValue']]);
  const rawBody = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');
  const appSecret = 'app-secret-only';
  const signature = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const requested = [];
  settingsManager.getValue = async (key) => {
    requested.push(key);
    return key === 'WHATSAPP_CLOUD_APP_SECRET' ? appSecret : null;
  };

  const result = await whatsappCloudManager.webhook({ entry: [] }, rawBody, signature);
  assert.equal(result.received, true);
  assert.deepEqual(
    { receivedMessages: result.receivedMessages, receivedStatuses: result.receivedStatuses, createdContacts: result.createdContacts, updatedContacts: result.updatedContacts },
    { receivedMessages: 0, receivedStatuses: 0, createdContacts: 0, updatedContacts: 0 }
  );
  assert.deepEqual(requested, ['WHATSAPP_CLOUD_APP_SECRET']);
});

test('envio oficial usa apenas credenciais de envio e normaliza telefone para digitos', async (context) => {
  restoreAfter(context, [[settingsManager, 'getValue'], [logsManager, 'create']]);
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  const values = {
    WHATSAPP_CLOUD_ACCESS_TOKEN: 'access',
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: '1000000000000001',
    WHATSAPP_CLOUD_API_VERSION: 'v25.0'
  };
  settingsManager.getValue = async (key) => values[key] || null;
  logsManager.create = async () => ({});
  let request;
  global.fetch = async (url, options) => {
    request = { url, headers: options.headers, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ messages: [{ id: 'wamid.confirmation' }] }) };
  };

  const result = await whatsappCloudManager.send({
    destination: '+55 (11) 93123-4567',
    allowUnconsented: true,
    officialTemplate: {
      preset: 'order_confirmation',
      parameters: { customerName: 'John Doe', orderNumber: '123456', orderDate: 'Jul 20, 2026' }
    }
  });

  assert.equal(result.providerMessageId, 'wamid.confirmation');
  assert.equal(request.url, 'https://graph.facebook.com/v25.0/1000000000000001/messages');
  assert.equal(request.headers.authorization, 'Bearer access');
  assert.deepEqual(request.body, {
    type: 'template',
    template: {
      name: 'jaspers_market_order_confirmation_v1',
      language: { code: 'en_US' },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: 'John Doe' },
          { type: 'text', text: '123456' },
          { type: 'text', text: 'Jul 20, 2026' }
        ]
      }]
    },
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '5511931234567'
  });
});

test('templates oficiais sem parametros omitem components', async (context) => {
  restoreAfter(context, [[settingsManager, 'getValue'], [logsManager, 'create']]);
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  settingsManager.getValue = async (key) => ({
    WHATSAPP_CLOUD_ACCESS_TOKEN: 'access',
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: 'phone-id',
    WHATSAPP_CLOUD_API_VERSION: 'v25.0'
  })[key] || null;
  logsManager.create = async () => ({});
  const sent = [];
  global.fetch = async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ messages: [{ id: 'wamid.no-params' }] }) };
  };

  for (const preset of ['plain_text', 'hello_world']) {
    await whatsappCloudManager.send({ destination: '5511931234567', allowUnconsented: true, officialTemplate: { preset } });
  }
  assert.deepEqual(sent.map((payload) => payload.template), [
    { name: 'jaspers_market_plain_text_v1', language: { code: 'en_US' } },
    { name: 'hello_world', language: { code: 'en_US' } }
  ]);
});

test('contrato amigavel valida os tres presets sem payload JSON manual', () => {
  const destination = '5511931234567';
  assert.equal(channelSendSchema.safeParse({ body: {
    destination,
    officialTemplate: {
      preset: 'order_confirmation',
      parameters: { customerName: 'John Doe', orderNumber: '123456', orderDate: 'Jul 20, 2026' }
    }
  } }).success, true);
  assert.equal(channelSendSchema.safeParse({ body: { destination, officialTemplate: { preset: 'plain_text' } } }).success, true);
  assert.equal(channelSendSchema.safeParse({ body: { destination, officialTemplate: { preset: 'hello_world' } } }).success, true);
  assert.equal(channelSendSchema.safeParse({ body: {
    destination,
    officialTemplate: { preset: 'order_confirmation', parameters: { customerName: 'John' } }
  } }).success, false);

  const template = createTemplateSchema.safeParse({ body: {
    name: 'Confirmacao de pedido',
    channel: 'whatsapp_cloud',
    whatsappCloudPreset: 'order_confirmation'
  } });
  assert.equal(template.success, true);
});

test('template salvo por preset deriva contrato Meta e variaveis da notificacao', () => {
  const normalized = templatesManager.normalizeTemplateInput({
    name: 'Confirmacao de pedido',
    channel: 'whatsapp_cloud',
    whatsappCloudPreset: 'order_confirmation'
  });
  assert.equal(normalized.templateType, 'approved_template');
  assert.equal(normalized.externalTemplateName, 'jaspers_market_order_confirmation_v1');
  assert.equal(normalized.languageCode, 'en_US');
  assert.deepEqual(normalized.payload.components[0].parameters.map((parameter) => parameter.text), [
    '{{customerName}}', '{{orderNumber}}', '{{orderDate}}'
  ]);

  const delivery = notificationsManager.normalizeTemplateContent(normalized, 'whatsapp_cloud');
  assert.deepEqual(delivery.officialTemplate, {
    preset: 'order_confirmation',
    parameters: {
      customerName: '{{customerName}}',
      orderNumber: '{{orderNumber}}',
      orderDate: '{{orderDate}}'
    }
  });
});

test('cadastro WhatsApp Cloud aceita nomes legados e custom oficial com builder', () => {
  const inferred = templatesManager.normalizeTemplateInput({
    name: 'Ola mundo existente',
    channel: 'whatsapp_cloud',
    templateType: 'approved_template',
    externalTemplateName: 'hello_world'
  });
  assert.equal(inferred.whatsappCloudPreset, 'hello_world');

  const custom = templatesManager.normalizeTemplateInput({
    name: 'Template aprovado personalizado',
    channel: 'whatsapp_cloud',
    whatsappCloudPreset: 'custom',
    externalTemplateName: 'pedido_aprovado_v2',
    languageCode: 'pt_BR',
    description: 'Confirmacao aprovada na Meta',
    payload: {
      builder: {
        version: 1,
        components: [{
          id: 'body-main',
          type: 'body',
          parameters: [{ id: 'customer', type: 'text', key: 'customerName', label: 'Cliente', example: 'Ana' }]
        }]
      }
    }
  });
  assert.doesNotThrow(() => templatesManager.validateTemplateInput(custom));
  assert.equal(custom.externalTemplateName, 'pedido_aprovado_v2');
  assert.equal(custom.payload.builder.version, 1);
  assert.deepEqual(custom.payload.components, [{
    type: 'body',
    parameters: [{ type: 'text', text: '{{customerName}}' }]
  }]);

  assert.throws(() => templatesManager.normalizeTemplateInput({
    name: 'Incompleto', channel: 'whatsapp_cloud', whatsappCloudPreset: 'custom',
    externalTemplateName: 'nome_valido', languageCode: 'pt_BR', payload: {}
  }), (error) => error.code === 'WHATSAPP_TEMPLATE_BUILDER_INVALID');
});

test('builder custom gera somente schema de envio Meta e suporta tipos comuns', () => {
  const message = buildCustomTemplateMessage({
    name: 'pedido_aprovado_v2',
    languageCode: 'pt_BR',
    builder: {
      version: 1,
      components: [
        { id: 'header', type: 'header', parameters: [{ id: 'hero', type: 'image', key: 'heroUrl', label: 'Imagem', example: 'https://example.com/hero.jpg' }] },
        { id: 'body', type: 'body', parameters: [
          { id: 'name', type: 'text', key: 'customerName', label: 'Cliente', example: 'Ana' },
          { id: 'price', type: 'currency', key: 'total', label: 'Total', currencyCode: 'BRL', example: 'R$ 25,90' },
          { id: 'date', type: 'date_time', key: 'deliveryDate', label: 'Data', example: '21/07/2026' }
        ] },
        { id: 'button', type: 'button', subType: 'quick_reply', index: 0, parameters: [{ id: 'action', type: 'payload', key: 'actionId', label: 'Acao' }] },
        { id: 'coupon', type: 'button', subType: 'copy_code', index: 1, parameters: [{ id: 'coupon-code', type: 'coupon_code', key: 'couponCode', label: 'Cupom' }] }
      ]
    },
    variables: {
      heroUrl: 'https://example.com/hero.jpg',
      customerName: 'Ana',
      total: { fallbackValue: 'R$ 25,90', code: 'BRL', amount1000: 25900 },
      deliveryDate: '21/07/2026',
      actionId: 'confirm-order-123',
      couponCode: 'PROMO2026'
    }
  });

  assert.deepEqual(message, {
    type: 'template',
    template: {
      name: 'pedido_aprovado_v2',
      language: { code: 'pt_BR' },
      components: [
        { type: 'header', parameters: [{ type: 'image', image: { link: 'https://example.com/hero.jpg' } }] },
        { type: 'body', parameters: [
          { type: 'text', text: 'Ana' },
          { type: 'currency', currency: { fallback_value: 'R$ 25,90', code: 'BRL', amount_1000: 25900 } },
          { type: 'date_time', date_time: { fallback_value: '21/07/2026' } }
        ] },
        { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'confirm-order-123' }] },
        { type: 'button', sub_type: 'copy_code', index: '1', parameters: [{ type: 'coupon_code', coupon_code: 'PROMO2026' }] }
      ]
    }
  });
  assert.doesNotMatch(JSON.stringify(message), /"builder"|"customerName"|"label"|"example"|"id"/);
});

test('builder custom omite componentes vazios do payload final sem perder o metadata do editor', () => {
  const builder = {
    version: 1,
    components: [{ id: 'body-static', type: 'body', parameters: [] }]
  };
  const normalized = normalizeBuilder(builder);
  assert.deepEqual(normalized.components, [{ id: 'body-static', type: 'body', parameters: [] }]);

  assert.deepEqual(buildCustomTemplateMessage({
    name: 'mensagem_estatica_v1',
    languageCode: 'pt_BR',
    builder,
    variables: {}
  }), {
    type: 'template',
    template: {
      name: 'mensagem_estatica_v1',
      language: { code: 'pt_BR' }
    }
  });
});

test('builder custom envia parameter_name para templates Meta com parametros nomeados', () => {
  const message = buildCustomTemplateMessage({
    name: 'pedido_nomeado_v1',
    languageCode: 'pt_BR',
    builder: {
      version: 1,
      components: [{ type: 'body', parameters: [
        { type: 'text', key: 'customerName', parameterName: 'customer_name', label: 'Nome do cliente' },
        { type: 'text', key: 'orderNumber', parameterName: 'order_number', label: 'Pedido' }
      ] }]
    },
    variables: { customerName: 'Ana', orderNumber: '1234' }
  });
  assert.deepEqual(message.template.components[0].parameters, [
    { type: 'text', text: 'Ana', parameter_name: 'customer_name' },
    { type: 'text', text: '1234', parameter_name: 'order_number' }
  ]);
  assert.throws(() => normalizeBuilder({
    version: 1,
    components: [{ type: 'body', parameters: [
      { type: 'text', key: 'one', parameterName: 'one', label: 'Um' },
      { type: 'text', key: 'two', label: 'Dois' }
    ] }]
  }), /Nao misture parametros nomeados e posicionais/);
});

test('builder aplica cardinalidade e matriz de parametros da Meta', () => {
  const invalidBuilders = [
    {
      message: /Header aceita apenas text, image, document e video/,
      components: [{ type: 'header', parameters: [{ type: 'currency', key: 'total', label: 'Total' }] }]
    },
    {
      message: /no maximo um componente header/,
      components: [{ type: 'header', parameters: [] }, { type: 'header', parameters: [] }]
    },
    {
      message: /no maximo um componente body/,
      components: [{ type: 'body', parameters: [] }, { type: 'body', parameters: [] }]
    },
    {
      message: /header aceita no maximo um parametro/i,
      components: [{ type: 'header', parameters: [
        { type: 'text', key: 'title', label: 'Titulo' },
        { type: 'text', key: 'subtitle', label: 'Subtitulo' }
      ] }]
    },
    {
      message: /button aceita no maximo um parametro/i,
      components: [{ type: 'button', subType: 'url', index: 0, parameters: [
        { type: 'text', key: 'path', label: 'Caminho' },
        { type: 'text', key: 'query', label: 'Query' }
      ] }]
    },
    {
      message: /Indices de button devem ser unicos/,
      components: [
        { type: 'button', subType: 'url', index: 0, parameters: [] },
        { type: 'button', subType: 'quick_reply', index: 0, parameters: [] }
      ]
    }
  ];

  for (const invalid of invalidBuilders) {
    assert.throws(() => normalizeBuilder({ version: 1, components: invalid.components }), invalid.message);
  }

  const dto = createTemplateSchema.safeParse({ body: {
    name: 'Header invalido',
    channel: 'whatsapp_cloud',
    whatsappCloudPreset: 'custom',
    externalTemplateName: 'header_invalido_v1',
    languageCode: 'pt_BR',
    payload: { builder: { version: 1, components: invalidBuilders[0].components } }
  } });
  assert.equal(dto.success, false);
});

test('copy_code exige coupon_code enquanto quick_reply preserva payload', () => {
  const dto = createTemplateSchema.safeParse({ body: {
    name: 'Cupom aprovado',
    channel: 'whatsapp_cloud',
    whatsappCloudPreset: 'custom',
    externalTemplateName: 'cupom_aprovado_v1',
    languageCode: 'pt_BR',
    payload: { builder: { version: 1, components: [{
      id: 'copy', type: 'button', subType: 'copy_code', index: 0,
      parameters: [{ id: 'coupon', type: 'coupon_code', key: 'couponCode', label: 'Cupom' }]
    }] } }
  } });
  assert.equal(dto.success, true);

  assert.throws(() => templatesManager.normalizeTemplateInput({
    name: 'Invalido', channel: 'whatsapp_cloud', whatsappCloudPreset: 'custom',
    externalTemplateName: 'cupom_invalido_v1', languageCode: 'pt_BR',
    payload: { builder: { version: 1, components: [{
      id: 'copy', type: 'button', subType: 'copy_code', index: 0,
      parameters: [{ id: 'wrong', type: 'payload', key: 'couponCode', label: 'Cupom' }]
    }] } }
  }), /copy_code aceita parametro coupon_code/);
});

test('webhook Cloud vincula payload Meta e concede somente ao receber o comando', async (context) => {
  stubWebhookPersistence(context);
  restoreAfter(context, [
    [settingsManager, 'getValue'], [settingsManager, 'isWhatsappPermissionCommand'], [contactsManager, 'findByChannelAddress'], [contactsManager, 'findByChannelOrPhone'], [contactsManager, 'upsertFromChannel'],
    [logsManager, 'create'], [adminNotificationsManager, 'create'], [notificationsManager, 'reconcileCloudReceipt']
  ]);
  const appSecret = 'cloud-secret';
  settingsManager.getValue = async (key) => key === 'WHATSAPP_CLOUD_APP_SECRET' ? appSecret : null;
  settingsManager.isWhatsappPermissionCommand = async (value) => value === '/notify-me';
  contactsManager.findByChannelAddress = async () => null;
  contactsManager.findByChannelOrPhone = async () => null;
  let upsertInput;
  contactsManager.upsertFromChannel = async (input) => {
    upsertInput = input;
    return { id: '507f1f77bcf86cd799439011', displayName: input.displayName, upsertState: { created: true, identityAdded: true } };
  };
  const actions = [];
  logsManager.create = async (input) => { actions.push(input.action); return {}; };
  let adminNotification;
  adminNotificationsManager.create = async (input) => { adminNotification = input; return {}; };
  const payload = {
    entry: [{ id: '1000000000000002', changes: [{ value: {
      metadata: { display_phone_number: '15550001111', phone_number_id: '1000000000000001' },
      contacts: [{ user_id: 'BR.12345678901234567', country_code: 'BR', profile: { name: 'Samuel', avatar_url: 'https://example.com/avatar.jpg' } }],
      messages: [{ id: 'wamid.inbound', from: '551131234567', from_user_id: 'BR.12345678901234567', from_logical_id: '123456789012345', type: 'text', text: { body: '/notify-me' }, timestamp: '1784605483' }]
    } }] }]
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const result = await whatsappCloudManager.webhook(payload, rawBody, signature);
  assert.equal(result.createdContacts, 1);
  assert.equal(result.receivedMessages, 1);
  assert.equal(upsertInput.address, '551131234567');
  assert.equal(upsertInput.phone, '551131234567');
  assert.equal(upsertInput.displayName, 'Samuel');
  assert.equal(upsertInput.avatarUrl, 'https://example.com/avatar.jpg');
  assert.equal(upsertInput.authorize, true);
  assert.equal(upsertInput.consentStatus, 'granted');
  assert.equal(upsertInput.consentSource, 'automatic_permission_command');
  assert.equal(upsertInput.consentCommand, '/notify-me');
  assert.equal(upsertInput.shareWhatsappConsent, true);
  assert.equal(upsertInput.metadata.permissionCommandReceivedVia, 'whatsapp_cloud');
  assert.equal(upsertInput.metadata.sharedWhatsappConsent, true);
  assert.equal(upsertInput.metadata.userId, 'BR.12345678901234567');
  assert.equal(upsertInput.metadata.fromUserId, 'BR.12345678901234567');
  assert.equal(upsertInput.metadata.fromLogicalId, '123456789012345');
  assert.equal(upsertInput.metadata.businessAccountId, '1000000000000002');
  assert.equal(upsertInput.metadata.phoneNumberId, '1000000000000001');
  assert.ok(actions.includes('contact.auto_created'));
  assert.ok(actions.includes('contact.permission_granted'));
  assert.equal(adminNotification.channel, 'whatsapp_cloud');
  assert.equal(adminNotification.contactId, '507f1f77bcf86cd799439011');
});

test('webhook Cloud salva novo usuario como unknown sem o comando de permissao', async (context) => {
  stubWebhookPersistence(context);
  restoreAfter(context, [
    [settingsManager, 'getValue'], [settingsManager, 'isWhatsappPermissionCommand'],
    [contactsManager, 'findByChannelAddress'], [contactsManager, 'findByChannelOrPhone'], [contactsManager, 'upsertFromChannel'],
    [logsManager, 'create'], [adminNotificationsManager, 'create']
  ]);
  const appSecret = 'cloud-secret';
  settingsManager.getValue = async (key) => key === 'WHATSAPP_CLOUD_APP_SECRET' ? appSecret : null;
  settingsManager.isWhatsappPermissionCommand = async () => false;
  contactsManager.findByChannelAddress = async () => null;
  contactsManager.findByChannelOrPhone = async () => null;
  let upsertInput;
  contactsManager.upsertFromChannel = async (input) => {
    upsertInput = input;
    return {
      id: '507f1f77bcf86cd799439099',
      displayName: input.displayName,
      upsertState: { created: true, identityAdded: true }
    };
  };
  let adminNotifications = 0;
  adminNotificationsManager.create = async () => { adminNotifications += 1; return {}; };
  const actions = [];
  logsManager.create = async (input) => { actions.push(input.action); return {}; };
  const payload = {
    entry: [{ changes: [{ value: {
      contacts: [{ wa_id: '551131234567', profile: { name: 'Samuel' } }],
      messages: [{ id: 'wamid.without-permission', from: '551131234567', type: 'text', text: { body: 'Ola' } }]
    } }] }]
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const result = await whatsappCloudManager.webhook(payload, rawBody, signature);

  assert.equal(result.receivedMessages, 1);
  assert.equal(result.createdContacts, 1);
  assert.equal(result.updatedContacts, 0);
  assert.equal(upsertInput.authorize, false);
  assert.equal(upsertInput.consentStatus, undefined);
  assert.equal(upsertInput.source, 'whatsapp_cloud_webhook');
  assert.equal(adminNotifications, 1);
  assert.deepEqual(actions, ['contact.auto_created', 'message.received']);
});

test('webhook Cloud contact-only nao cadastra contato nem concede opt-in', async (context) => {
  stubWebhookPersistence(context);
  restoreAfter(context, [
    [settingsManager, 'getValue'], [contactsManager, 'findByChannelAddress'], [contactsManager, 'upsertFromChannel'],
    [logsManager, 'create'], [adminNotificationsManager, 'create'], [notificationsManager, 'reconcileCloudReceipt']
  ]);
  const appSecret = 'cloud-secret';
  settingsManager.getValue = async (key) => key === 'WHATSAPP_CLOUD_APP_SECRET' ? appSecret : null;
  contactsManager.findByChannelAddress = async () => null;
  let upsertInput;
  contactsManager.upsertFromChannel = async (input) => {
    upsertInput = input;
    return {
      id: '507f1f77bcf86cd799439011',
      displayName: input.displayName,
      upsertState: { created: true, identityAdded: true }
    };
  };
  const actions = [];
  logsManager.create = async (input) => { actions.push(input.action); return {}; };
  let adminNotifications = 0;
  adminNotificationsManager.create = async () => { adminNotifications += 1; return {}; };
  notificationsManager.reconcileCloudReceipt = async (receipt) => ({ matched: false, providerStatus: receipt.status });
  const payload = {
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: 'phone-id' },
      contacts: [{ wa_id: '551131234567', profile: { name: 'Samuel' } }],
      statuses: [{ id: 'wamid.status', status: 'delivered' }]
    } }] }]
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const result = await whatsappCloudManager.webhook(payload, rawBody, signature);

  assert.equal(upsertInput, undefined);
  assert.equal(result.receivedMessages, 0);
  assert.equal(result.createdContacts, 0);
  assert.equal(adminNotifications, 0);
  assert.equal(actions.includes('contact.auto_created'), false);
});

test('webhook Cloud trata canal anexado por telefone como identidade nova, nao contato novo', async (context) => {
  stubWebhookPersistence(context);
  restoreAfter(context, [
    [settingsManager, 'getValue'], [settingsManager, 'isWhatsappPermissionCommand'], [contactsManager, 'findByChannelAddress'], [contactsManager, 'findByChannelOrPhone'], [contactsManager, 'upsertFromChannel'],
    [logsManager, 'create'], [adminNotificationsManager, 'create']
  ]);
  const appSecret = 'cloud-secret';
  settingsManager.getValue = async (key) => key === 'WHATSAPP_CLOUD_APP_SECRET' ? appSecret : null;
  settingsManager.isWhatsappPermissionCommand = async (value) => value === '/notify-me';
  contactsManager.findByChannelAddress = async () => null;
  contactsManager.findByChannelOrPhone = async () => ({
    id: '507f1f77bcf86cd799439011',
    channels: [{ channel: 'whatsapp_web', address: '551131234567@c.us', authorized: true, consentStatus: 'granted' }]
  });
  contactsManager.upsertFromChannel = async (input) => ({
    id: '507f1f77bcf86cd799439011',
    displayName: 'Contato Web existente',
    upsertState: { created: false, identityAdded: true },
    channels: [{ channel: 'whatsapp_web' }, { channel: input.channel }]
  });
  const actions = [];
  logsManager.create = async (input) => { actions.push(input.action); return {}; };
  let adminNotifications = 0;
  adminNotificationsManager.create = async () => { adminNotifications += 1; return {}; };
  const payload = {
    entry: [{ changes: [{ value: {
      contacts: [{ wa_id: '551131234567', profile: { name: 'Samuel' } }],
      messages: [{ id: 'wamid.inbound', from: '551131234567', type: 'text', text: { body: '/notify-me' } }]
    } }] }]
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const result = await whatsappCloudManager.webhook(payload, rawBody, signature);

  assert.equal(result.createdContacts, 0);
  assert.equal(result.updatedContacts, 1);
  assert.equal(result.receivedMessages, 1);
  assert.equal(adminNotifications, 0);
  assert.equal(actions.includes('contact.auto_created'), false);
  assert.ok(actions.includes('contact.permission_granted'));
});

test('numero Meta rejeita destino sem DDI ou acima do limite E.164', () => {
  assert.equal(whatsappCloudManager.normalizeMetaDestination('+55-11-93123-4567'), '5511931234567');
  assert.throws(() => whatsappCloudManager.normalizeMetaDestination('123'), (error) => error.code === 'WHATSAPP_DESTINATION_INVALID');
  assert.throws(() => whatsappCloudManager.normalizeMetaDestination('1234567890123456'), (error) => error.code === 'WHATSAPP_DESTINATION_INVALID');
});
