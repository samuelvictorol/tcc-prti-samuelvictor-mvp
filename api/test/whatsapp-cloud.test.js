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
const conversationsManager = require('../src/managers/conversations.manager');
const profileManager = require('../src/managers/profile.manager');
const chatProfileFlow = require('../src/services/chat-profile-flow.service');
const { channelSendSchema } = require('../src/dtos/channels.dto');
const { createTemplateSchema } = require('../src/dtos/templates.dto');
const {
  buildCustomTemplateMessage,
  buildCustomTemplatePreview,
  normalizeBuilder
} = require('../src/utils/whatsapp-cloud-templates');
const { env } = require('../src/config/env');

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
    [webhookEventsManager, 'markFailed'],
    [conversationsManager, 'recordInbound'],
    [conversationsManager, 'recordOutbound'],
    [conversationsManager, 'getById'],
    [conversationsManager, 'requireOpenCloudServiceWindow'],
    [contactsManager, 'getById']
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
  conversationsManager.recordInbound = async (input) => ({
    conversation: { id: '507f1f77bcf86cd799439177', channel: input.channel },
    message: { id: '507f1f77bcf86cd799439178', body: input.body }
  });
  conversationsManager.recordOutbound = async (input) => ({
    conversation: { id: '507f1f77bcf86cd799439177', channel: input.channel },
    message: { id: '507f1f77bcf86cd799439179', body: input.body }
  });
  conversationsManager.getById = async (id) => ({
    id,
    channel: 'whatsapp_cloud',
    contactId: '507f1f77bcf86cd799439011',
    serviceWindow: { open: true, expiresAt: new Date(Date.now() + 60_000).toISOString() }
  });
  conversationsManager.requireOpenCloudServiceWindow = async (id) => ({
    conversation: {
      _id: id,
      contact: '507f1f77bcf86cd799439011'
    },
    externalId: '551131234567',
    serviceWindow: { open: true, expiresAt: new Date(Date.now() + 60_000) }
  });
  contactsManager.getById = async (id) => ({
    id,
    displayName: 'Samuel',
    channels: [{ channel: 'whatsapp_cloud', metadata: {} }]
  });
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
  process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID = '1000000000000001';
  delete process.env.WHATSAPP_CLOUD_VERIFY_TOKEN;
  delete process.env.WHATSAPP_CLOUD_APP_SECRET;

  assert.equal(await settingsManager.channelConfigured('whatsapp_cloud'), true);
  process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID = 'phone-id';
  assert.equal(await settingsManager.channelConfigured('whatsapp_cloud'), false);
});

test('status separa preparo de envio, challenge e assinatura do WhatsApp Cloud', async (context) => {
  restoreAfter(context, [[settingsManager, 'getValue']]);
  const values = {
    WHATSAPP_CLOUD_ACCESS_TOKEN: 'access',
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: '1000000000000001',
    WHATSAPP_CLOUD_DISPLAY_PHONE_NUMBER: '5511931234567',
    WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID: '2000000000000001',
    WHATSAPP_CLOUD_API_VERSION: 'v25.0'
  };
  settingsManager.getValue = async (key) => values[key] || null;

  assert.deepEqual(await whatsappCloudManager.status(), {
    configured: true,
    sendConfigured: true,
    webhookVerificationConfigured: false,
    webhookSignatureConfigured: false,
    webhookConfigured: false,
    phoneNumberId: '1000000000000001',
    displayPhoneNumber: '5511931234567',
    businessAccountId: '2000000000000001',
    apiVersion: 'v25.0'
  });

  values.WHATSAPP_CLOUD_PHONE_NUMBER_ID = 'phone-id';
  assert.deepEqual(await whatsappCloudManager.status(), {
    configured: false,
    sendConfigured: false,
    webhookVerificationConfigured: false,
    webhookSignatureConfigured: false,
    webhookConfigured: false,
    phoneNumberId: null,
    displayPhoneNumber: '5511931234567',
    businessAccountId: '2000000000000001',
    apiVersion: 'v25.0'
  });
  values.WHATSAPP_CLOUD_PHONE_NUMBER_ID = '1000000000000001';
  values.WHATSAPP_CLOUD_API_VERSION = '25';
  assert.equal((await whatsappCloudManager.status()).sendConfigured, false);
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

test('metadata de template recebido preserva somente preview seguro para o chat', () => {
  const metadata = whatsappCloudManager.cloudConversationMetadata({
    type: 'template',
    template: {
      name: 'campanha_recebida',
      language: { code: 'pt_BR' },
      components: [
        {
          type: 'header',
          parameters: [{ type: 'video', video: { link: 'https://cdn.example.com/video.mp4' } }]
        },
        {
          type: 'button', sub_type: 'quick_reply', index: '0',
          parameters: [{ type: 'payload', payload: 'nao-expor-este-payload' }]
        }
      ]
    }
  }, {
    metadata: { phone_number_id: '1000000000000001', display_phone_number: '15550001111' }
  }, '1000000000000002');

  assert.deepEqual(metadata.template, { name: 'campanha_recebida', languageCode: 'pt_BR' });
  assert.deepEqual(metadata.templatePreview, {
    version: 1,
    name: 'campanha_recebida',
    languageCode: 'pt_BR',
    header: {
      type: 'video',
      text: null,
      media: { type: 'video', url: 'https://cdn.example.com/video.mp4', filename: null }
    },
    body: null,
    footer: null,
    buttons: []
  });
  assert.doesNotMatch(JSON.stringify(metadata), /nao-expor-este-payload|components/);
});

test('envio oficial usa apenas credenciais de envio e normaliza telefone para digitos', async (context) => {
  restoreAfter(context, [
    [settingsManager, 'getValue'],
    [logsManager, 'create'],
    [contactsManager, 'findByChannelAddress'],
    [conversationsManager, 'recordOutbound']
  ]);
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  const values = {
    WHATSAPP_CLOUD_ACCESS_TOKEN: 'access',
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: '1000000000000001',
    WHATSAPP_CLOUD_API_VERSION: 'v25.0'
  };
  settingsManager.getValue = async (key) => values[key] || null;
  logsManager.create = async () => ({});
  contactsManager.findByChannelAddress = async () => ({
    id: '507f1f77bcf86cd799439012',
    displayName: 'Contato ficticio',
    avatarUrl: null
  });
  let recorded;
  conversationsManager.recordOutbound = async (input) => {
    recorded = input;
    return { message: { id: '507f1f77bcf86cd799439013' } };
  };
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
  assert.equal(recorded.body, '[Template: jaspers_market_order_confirmation_v1]');
  assert.equal(recorded.type, 'template');
  assert.equal(recorded.contactId, '507f1f77bcf86cd799439012');
  assert.equal(recorded.metadata.template.languageCode, 'en_US');
  assert.equal(recorded.metadata.template.components, undefined);
  assert.deepEqual(recorded.metadata.templatePreview, {
    version: 1,
    name: 'jaspers_market_order_confirmation_v1',
    languageCode: 'en_US',
    header: null,
    body: { text: 'Pedido 123456 de John Doe confirmado em Jul 20, 2026.' },
    footer: null,
    buttons: []
  });
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
  restoreAfter(context, [
    [settingsManager, 'getValue'],
    [logsManager, 'create'],
    [contactsManager, 'findByChannelAddress'],
    [conversationsManager, 'recordOutbound']
  ]);
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  settingsManager.getValue = async (key) => ({
    WHATSAPP_CLOUD_ACCESS_TOKEN: 'access',
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: '1000000000000001',
    WHATSAPP_CLOUD_API_VERSION: 'v25.0'
  })[key] || null;
  logsManager.create = async () => ({});
  contactsManager.findByChannelAddress = async () => null;
  const recorded = [];
  conversationsManager.recordOutbound = async (input) => {
    recorded.push(input);
    return { message: { id: String(recorded.length) } };
  };
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
  assert.deepEqual(
    recorded.map((item) => item.body),
    ['[Template: jaspers_market_plain_text_v1]', '[Template: hello_world]']
  );
});

test('fila usa o Phone Number ID confiavel do contato recebido pelo webhook', async (context) => {
  restoreAfter(context, [
    [settingsManager, 'getValue'],
    [logsManager, 'create'],
    [contactsManager, 'getDestination'],
    [conversationsManager, 'recordOutbound']
  ]);
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  settingsManager.getValue = async (key) => ({
    WHATSAPP_CLOUD_ACCESS_TOKEN: 'access',
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: '1999999999999999',
    WHATSAPP_CLOUD_API_VERSION: 'v25.0'
  })[key] || null;
  logsManager.create = async () => ({});
  contactsManager.getDestination = async () => ({
    address: '5511931234567',
    contact: {
      id: '507f1f77bcf86cd799439012',
      displayName: 'Contato ficticio',
      channels: [{
        channel: 'whatsapp_cloud',
        address: '5511931234567',
        authorized: true,
        consentStatus: 'granted',
        metadata: { phoneNumberId: '1000000000000001' }
      }]
    }
  });
  conversationsManager.recordOutbound = async (input) => ({
    message: { id: '507f1f77bcf86cd799439013', body: input.body }
  });
  let providerUrl;
  global.fetch = async (url) => {
    providerUrl = url;
    return { ok: true, json: async () => ({ messages: [{ id: 'wamid.contact-phone-id' }] }) };
  };

  const result = await whatsappCloudManager.send({
    contactId: '507f1f77bcf86cd799439012',
    officialTemplate: { preset: 'hello_world' }
  });

  assert.equal(providerUrl, 'https://graph.facebook.com/v25.0/1000000000000001/messages');
  assert.equal(result.providerMessageId, 'wamid.contact-phone-id');
});

test('erro da Meta vira diagnostico seguro e acionavel sem expor access token', async (context) => {
  restoreAfter(context, [
    [settingsManager, 'getValue'],
    [contactsManager, 'findByChannelAddress']
  ]);
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  settingsManager.getValue = async (key) => ({
    WHATSAPP_CLOUD_ACCESS_TOKEN: 'EAA-token-que-nao-deve-aparecer',
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: '1000000000000001',
    WHATSAPP_CLOUD_API_VERSION: 'v25.0'
  })[key] || null;
  contactsManager.findByChannelAddress = async () => null;
  global.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({
      error: {
        message: 'Error validating application. Application has been deleted.',
        type: 'OAuthException',
        code: 190,
        fbtrace_id: 'trace-ficticio'
      }
    })
  });

  await assert.rejects(
    () => whatsappCloudManager.send({
      destination: '5511931234567',
      allowUnconsented: true,
      officialTemplate: { preset: 'hello_world' }
    }),
    (error) => {
      assert.equal(error.code, 'WHATSAPP_CLOUD_ERROR');
      assert.equal(error.statusCode, 502);
      assert.equal(error.expose, true);
      assert.match(error.message, /Access token da Meta invalido/i);
      assert.equal(error.details.providerHttpStatus, 401);
      assert.equal(error.details.providerErrorCode, 190);
      assert.equal(error.details.providerTraceId, 'trace-ficticio');
      assert.doesNotMatch(JSON.stringify(error), /EAA-token-que-nao-deve-aparecer/);
      return true;
    }
  );
});

test('configuracao rejeita Phone Number ID nao numerico antes de chamar a Meta', async (context) => {
  restoreAfter(context, [
    [settingsManager, 'getValue'],
    [contactsManager, 'findByChannelAddress']
  ]);
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  settingsManager.getValue = async (key) => ({
    WHATSAPP_CLOUD_ACCESS_TOKEN: 'access',
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: 'numero-incorreto',
    WHATSAPP_CLOUD_API_VERSION: 'v25.0'
  })[key] || null;
  contactsManager.findByChannelAddress = async () => null;
  let providerCalled = false;
  global.fetch = async () => {
    providerCalled = true;
    throw new Error('nao deveria chamar');
  };

  await assert.rejects(
    () => whatsappCloudManager.send({
      destination: '5511931234567',
      allowUnconsented: true,
      officialTemplate: { preset: 'hello_world' }
    }),
    (error) => {
      assert.equal(error.code, 'WHATSAPP_CLOUD_PHONE_NUMBER_ID_INVALID');
      assert.equal(error.expose, true);
      return true;
    }
  );
  assert.equal(providerCalled, false);
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

test('cadastro WhatsApp Cloud aceita nomes legados, custom minimo e custom oficial com builder', () => {
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
        category: 'marketing',
        mode: 'standard',
        components: [
          {
            id: 'header-main',
            type: 'header',
            parameters: [{
              id: 'hero', type: 'image', key: 'heroUrl', label: 'Imagem',
              fixedValue: 'https://cdn.example.com/hero.png'
            }]
          },
          {
            id: 'body-main',
            type: 'body',
            text: 'Confirmacao aprovada na Meta',
            parameters: [{
              id: 'customer', type: 'text', key: 'customerName', label: 'Cliente',
              fixedValue: 'Ana', example: 'Exemplo documental'
            }]
          }
        ]
      }
    }
  });
  assert.doesNotThrow(() => templatesManager.validateTemplateInput(custom));
  assert.equal(custom.externalTemplateName, 'pedido_aprovado_v2');
  assert.equal(custom.payload.builder.version, 1);
  assert.deepEqual(custom.payload.components, [
    { type: 'header', parameters: [{ type: 'image', image: { link: 'https://cdn.example.com/hero.png' } }] },
    { type: 'body', parameters: [{ type: 'text', text: 'Ana' }] }
  ]);

  const minimal = templatesManager.normalizeTemplateInput({
    name: 'Somente nome oficial',
    channel: 'whatsapp_cloud',
    externalTemplateName: 'nome_valido'
  });
  assert.doesNotThrow(() => templatesManager.validateTemplateInput(minimal));
  assert.equal(minimal.whatsappCloudPreset, 'custom');
  assert.equal(minimal.externalTemplateName, 'nome_valido');
  assert.equal(minimal.languageCode, 'pt_BR');
  assert.equal(minimal.body, null);
  assert.deepEqual(minimal.payload, {
    builder: {
      version: 1,
      category: 'marketing',
      mode: 'standard',
      components: []
    },
    components: []
  });
  assert.deepEqual(buildCustomTemplateMessage({
    name: minimal.externalTemplateName,
    languageCode: minimal.languageCode,
    builder: minimal.payload.builder
  }), {
    type: 'template',
    template: {
      name: 'nome_valido',
      language: { code: 'pt_BR' }
    }
  });
});

test('template Marketing Padrao usa valores fixos sem transformar descricao interna em body', () => {
  const builder = {
    version: 1,
    category: 'marketing',
    mode: 'standard',
    components: [
      {
        id: 'header-media',
        type: 'header',
        parameters: [{
          id: 'hero',
          type: 'image',
          key: 'heroUrl',
          label: 'Imagem principal',
          fixedValue: 'https://cdn.example.com/campanha.png'
        }]
      },
      {
        id: 'body-main',
        type: 'body',
        text: 'Conteudo oficial aprovado na Meta.',
        parameters: [{
          id: 'audience',
          type: 'text',
          key: 'audience',
          label: 'Publico',
          fixedValue: 'Cliente Notify Flow'
        }]
      },
      { id: 'footer-main', type: 'footer', text: 'Gerencie suas preferencias.', parameters: [] },
      {
        id: 'site-button',
        type: 'button',
        subType: 'url',
        index: 0,
        text: 'Abrir convite',
        url: 'https://notify.example/invite/grupo-alpha',
        parameters: []
      }
    ]
  };
  const normalized = templatesManager.normalizeTemplateInput({
    name: 'Campanha Grupo Alpha',
    description: 'Descricao visivel somente para o administrador.',
    body: 'Descricao visivel somente para o administrador.',
    channel: 'whatsapp_cloud',
    whatsappCloudPreset: 'custom',
    externalTemplateName: 'campanha_grupo_alpha',
    languageCode: 'pt_BR',
    payload: { builder }
  });

  assert.equal(normalized.description, 'Descricao visivel somente para o administrador.');
  assert.equal(normalized.body, 'Conteudo oficial aprovado na Meta.');
  assert.equal(normalized.payload.builder.category, 'marketing');
  assert.equal(normalized.payload.builder.mode, 'standard');
  assert.equal(normalized.payload.builder.components[2].type, 'footer');
  assert.equal(normalized.payload.builder.components[3].url, 'https://notify.example/invite/grupo-alpha');
  assert.deepEqual(normalized.payload.components, [
    { type: 'header', parameters: [{ type: 'image', image: { link: 'https://cdn.example.com/campanha.png' } }] },
    { type: 'body', parameters: [{ type: 'text', text: 'Cliente Notify Flow' }] }
  ]);

  assert.deepEqual(buildCustomTemplateMessage({
    name: normalized.externalTemplateName,
    languageCode: normalized.languageCode,
    builder: normalized.payload.builder
  }), {
    type: 'template',
    template: {
      name: 'campanha_grupo_alpha',
      language: { code: 'pt_BR' },
      components: [
        { type: 'header', parameters: [{ type: 'image', image: { link: 'https://cdn.example.com/campanha.png' } }] },
        { type: 'body', parameters: [{ type: 'text', text: 'Cliente Notify Flow' }] }
      ]
    }
  });
  assert.equal(channelSendSchema.safeParse({ body: {
    destination: '5511931234567',
    customTemplate: {
      name: normalized.externalTemplateName,
      languageCode: normalized.languageCode,
      builder: normalized.payload.builder
    }
  } }).success, true);

  const preview = buildCustomTemplatePreview({
    name: normalized.externalTemplateName,
    languageCode: normalized.languageCode,
    builder: normalized.payload.builder
  });
  assert.deepEqual(preview, {
    version: 1,
    name: 'campanha_grupo_alpha',
    languageCode: 'pt_BR',
    header: {
      type: 'image',
      text: null,
      media: { type: 'image', url: 'https://cdn.example.com/campanha.png', filename: null }
    },
    body: { text: 'Conteudo oficial aprovado na Meta.' },
    footer: { text: 'Gerencie suas preferencias.' },
    buttons: [{
      index: '0',
      type: 'url',
      text: 'Abrir convite',
      url: 'https://notify.example/invite/grupo-alpha'
    }]
  });
  assert.doesNotMatch(JSON.stringify(preview), /Cliente Notify Flow|fixedValue|components|payload/);
});

test('valores dinamicos opcionais sobrescrevem fixedValue sem promover example legado', () => {
  const builder = {
    version: 1,
    components: [{
      type: 'body',
      text: 'Ola, {{1}}.',
      parameters: [
        { type: 'text', key: 'fixedName', label: 'Nome fixo', fixedValue: 'Nome cadastrado' },
        { type: 'text', key: 'legacyCode', label: 'Codigo legado', example: 'COD-001' }
      ]
    }]
  };

  assert.throws(
    () => buildCustomTemplateMessage({ name: 'fallback_fixo_v1', languageCode: 'pt_BR', builder }),
    (error) => error.code === 'WHATSAPP_TEMPLATE_PARAMETERS_REQUIRED'
      && error.details.missingParameters.includes('legacyCode')
  );
  assert.deepEqual(buildCustomTemplateMessage({
    name: 'fallback_fixo_v1', languageCode: 'pt_BR', builder,
    variables: { fixedName: 'Nome dinamico', legacyCode: 'COD-DINAMICO' }
  }).template.components[0].parameters, [
    { type: 'text', text: 'Nome dinamico' },
    { type: 'text', text: 'COD-DINAMICO' }
  ]);
  assert.throws(
    () => buildCustomTemplateMessage({
      name: 'fallback_fixo_v1', languageCode: 'pt_BR', builder,
      variables: { legacyCode: '' }
    }),
    (error) => error.code === 'WHATSAPP_TEMPLATE_PARAMETERS_REQUIRED'
  );
});

test('builder rejeita botoes que redirecionam para WhatsApp ou wa.me', () => {
  for (const url of [
    'https://wa.me/5511999999999',
    'https://api.whatsapp.com/send?phone=5511999999999',
    'https://chat.whatsapp.com/convite',
    'whatsapp://send?phone=5511999999999'
  ]) {
    const builder = {
      version: 1,
      category: 'marketing',
      mode: 'standard',
      components: [{
        type: 'button', subType: 'url', index: 0, text: 'Abrir', url, parameters: []
      }]
    };
    assert.throws(
      () => normalizeBuilder(builder),
      (error) => error.code === 'WHATSAPP_TEMPLATE_BUTTON_URL_FORBIDDEN'
    );
    assert.equal(createTemplateSchema.safeParse({ body: {
      name: 'Botao inseguro',
      channel: 'whatsapp_cloud',
      whatsappCloudPreset: 'custom',
      externalTemplateName: 'botao_inseguro',
      languageCode: 'pt_BR',
      payload: { builder }
    } }).success, false);
  }
  assert.throws(
    () => normalizeBuilder({
      version: 1,
      components: [{
        type: 'button', subType: 'url', index: 0, text: 'Abrir',
        url: 'https://notify.example/destino',
        parameters: [{
          type: 'text', key: 'destino', label: 'Destino', fixedValue: 'whatsapp://send?phone=5511999999999'
        }]
      }]
    }),
    (error) => error.code === 'WHATSAPP_TEMPLATE_BUTTON_URL_FORBIDDEN'
  );
});

test('botao URL preserva um unico placeholder {{1}} somente no caminho ou query', () => {
  for (const url of [
    'https://notify.example/invite/{{1}}',
    'https://notify.example/invite?codigo={{1}}'
  ]) {
    const normalized = normalizeBuilder({
      version: 1,
      components: [{
        type: 'button', subType: 'url', index: 0, text: 'Abrir', url,
        parameters: [{ type: 'text', key: 'suffix', label: 'Sufixo' }]
      }]
    });
    assert.equal(normalized.components[0].url, url);
  }

  for (const url of [
    'https://{{1}}.notify.example/invite',
    'https://notify.example/invite/{{slug}}',
    'https://notify.example/invite/{{',
    'https://notify.example/{{1}}/{{1}}',
    'https://notify.example/invite#{{1}}'
  ]) {
    assert.throws(
      () => normalizeBuilder({
        version: 1,
        components: [{
          type: 'button', subType: 'url', index: 0, text: 'Abrir', url,
          parameters: [{ type: 'text', key: 'suffix', label: 'Sufixo' }]
        }]
      }),
      (error) => error.code === 'WHATSAPP_TEMPLATE_BUTTON_URL_PLACEHOLDER_INVALID'
    );
  }
});

test('botao URL recupera configuracao legada de sufixo e exige parametro no contrato dinamico', () => {
  const normalizedLegacy = normalizeBuilder({
    version: 1,
    components: [{
      type: 'button', subType: 'url', index: 0, text: 'Abrir',
      url: 'https://notify.example/invite/',
      parameters: [{ type: 'text', key: 'suffix', label: 'Sufixo' }]
    }]
  });
  assert.equal(normalizedLegacy.components[0].url, 'https://notify.example/invite/{{1}}');
  assert.equal(normalizedLegacy.components[0].parameters[0].contentMode, 'dynamic');

  assert.throws(
    () => normalizeBuilder({
      version: 1,
      components: [{
        type: 'button', subType: 'url', index: 0, text: 'Abrir',
        url: 'https://notify.example/invite/{{1}}', parameters: []
      }]
    }),
    (error) => error.code === 'WHATSAPP_TEMPLATE_BUTTON_URL_PARAMETER_MISMATCH'
  );
});

test('modos fixo e por disparo persistem para descricao e sufixo sem afetar botao URL fixa', () => {
  const fixedBuilder = normalizeBuilder({
    version: 1,
    category: 'marketing',
    mode: 'standard',
    components: [
      {
        type: 'body', text: '{{body_description}}', parameters: [{
          type: 'text', key: 'body_description', parameterName: 'body_description',
          label: 'Descricao', contentMode: 'fixed', fixedValue: 'Descricao sempre reutilizada'
        }]
      },
      {
        type: 'button', subType: 'url', index: 0, text: 'Ver convite',
        url: 'https://notify.example/invite/{{1}}', parameters: [{
          type: 'text', key: 'invite_slug', label: 'Convite',
          contentMode: 'fixed', fixedValue: 'grupo-alpha'
        }]
      }
    ]
  });
  assert.deepEqual(
    fixedBuilder.components.map((component) => component.parameters[0].contentMode),
    ['fixed', 'fixed']
  );
  assert.deepEqual(buildCustomTemplateMessage({
    name: 'convite_fixo', languageCode: 'pt_BR', builder: fixedBuilder
  }).template.components, [
    {
      type: 'body',
      parameters: [{ type: 'text', text: 'Descricao sempre reutilizada', parameter_name: 'body_description' }]
    },
    {
      type: 'button', sub_type: 'url', index: '0',
      parameters: [{ type: 'text', text: 'grupo-alpha' }]
    }
  ]);

  const dynamicBuilder = normalizeBuilder({
    version: 1,
    category: 'marketing',
    mode: 'standard',
    components: [
      {
        type: 'body', text: '{{body_description}}', parameters: [{
          type: 'text', key: 'body_description', parameterName: 'body_description',
          label: 'Descricao', contentMode: 'dynamic', example: 'Exemplo'
        }]
      },
      {
        type: 'button', subType: 'url', index: 0, text: 'Ver convite',
        url: 'https://notify.example/invite/{{1}}', parameters: [{
          type: 'text', key: 'invite_slug', label: 'Convite',
          contentMode: 'dynamic', example: 'grupo-alpha'
        }]
      }
    ]
  });
  assert.throws(
    () => buildCustomTemplateMessage({
      name: 'convite_dinamico', languageCode: 'pt_BR', builder: dynamicBuilder
    }),
    (error) => error.code === 'WHATSAPP_TEMPLATE_PARAMETERS_REQUIRED'
  );
  assert.deepEqual(buildCustomTemplateMessage({
    name: 'convite_dinamico', languageCode: 'pt_BR', builder: dynamicBuilder,
    variables: { body_description: 'Descricao do envio', invite_slug: 'grupo-beta' }
  }).template.components, [
    {
      type: 'body',
      parameters: [{ type: 'text', text: 'Descricao do envio', parameter_name: 'body_description' }]
    },
    {
      type: 'button', sub_type: 'url', index: '0',
      parameters: [{ type: 'text', text: 'grupo-beta' }]
    }
  ]);

  const noButton = buildCustomTemplateMessage({
    name: 'sem_botao', languageCode: 'pt_BR',
    builder: { version: 1, category: 'marketing', mode: 'standard', components: [] }
  });
  assert.equal(noButton.template.components, undefined);
});

test('custom oficial torna componentes opcionais e valida rigorosamente os que forem preenchidos', () => {
  const base = {
    name: 'Novo marketing',
    channel: 'whatsapp_cloud',
    whatsappCloudPreset: 'custom',
    externalTemplateName: 'novo_marketing',
    languageCode: 'pt_BR'
  };
  const acceptedBuilders = [
    undefined,
    {
      version: 1,
      components: [
        { type: 'header', parameters: [{ type: 'image', key: 'hero', label: 'Hero', fixedValue: 'https://cdn.example/hero.png' }] },
        { type: 'body', text: 'Texto', parameters: [] }
      ]
    },
    {
      version: 1, category: 'marketing', mode: 'standard',
      components: [{ type: 'body', text: 'Texto', parameters: [] }]
    },
    {
      version: 1, category: 'marketing', mode: 'standard',
      components: [{
        type: 'header',
        parameters: [{ type: 'image', key: 'hero', label: 'Hero', fixedValue: 'https://cdn.example/hero.png' }]
      }]
    },
    {
      version: 1, category: 'marketing', mode: 'standard',
      components: [{ type: 'footer', text: 'Rodape opcional', parameters: [] }]
    },
    {
      version: 1, category: 'marketing', mode: 'standard',
      components: [{
        type: 'button', subType: 'url', index: 0, text: 'Abrir',
        url: 'https://notify.example/destino', parameters: []
      }]
    },
    {
      version: 1, category: 'marketing', mode: 'standard',
      components: [
        { type: 'header', parameters: [{ type: 'image', key: 'hero', label: 'Hero', example: 'https://cdn.example/hero.png' }] },
        { type: 'body', text: 'Texto', parameters: [] }
      ]
    }
  ];
  for (const builder of acceptedBuilders) {
    const normalized = templatesManager.normalizeTemplateInput({
      ...base,
      ...(builder ? { payload: { builder } } : {})
    });
    assert.doesNotThrow(() => templatesManager.validateTemplateInput(normalized));
    assert.equal(normalized.payload.builder.category, 'marketing');
    assert.equal(normalized.payload.builder.mode, 'standard');
  }

  const invalidBuilders = [
    {
      version: 1, category: 'marketing', mode: 'standard',
      components: [
        { type: 'header', parameters: [{ type: 'image', key: 'hero', label: 'Hero', fixedValue: 'https://cdn.example/hero.png' }] },
        { type: 'body', parameters: [] }
      ]
    },
    {
      version: 1, category: 'marketing', mode: 'standard',
      components: [
        { type: 'header', parameters: [{ type: 'image', key: 'hero', label: 'Hero', fixedValue: 'https://cdn.example/hero.png' }] },
        { type: 'body', text: 'Texto', parameters: [] },
        { type: 'button', subType: 'quick_reply', index: 0, text: 'Responder', parameters: [] }
      ]
    }
  ];
  for (const builder of invalidBuilders) {
    assert.throws(
      () => templatesManager.normalizeTemplateInput({ ...base, payload: { builder } }),
      (error) => error.code === 'WHATSAPP_MARKETING_STANDARD_INVALID'
    );
  }
});

test('Marketing Standard aceita midia dinamica, body nomeado e sufixo posicional no botao URL', () => {
  const input = {
    name: 'Convite dinamico',
    channel: 'whatsapp_cloud',
    externalTemplateName: 'convite_dinamico_v1',
    payload: {
      builder: {
        version: 1,
        category: 'marketing',
        mode: 'standard',
        components: [
          {
            type: 'header',
            parameters: [{
              type: 'image', key: 'headerMedia', label: 'Imagem',
              example: 'https://cdn.example.com/convite.png'
            }]
          },
          {
            type: 'body',
            text: 'Ola, {{customer_name}}.',
            parameters: [{
              type: 'text', key: 'customerName', parameterName: 'customer_name', label: 'Nome'
            }]
          },
          {
            type: 'button', subType: 'url', index: 0, text: 'Abrir convite',
            url: 'https://notify.example/invite/{{1}}',
            parameters: [{ type: 'text', key: 'inviteSuffix', label: 'Sufixo do convite' }]
          }
        ]
      }
    }
  };
  assert.equal(createTemplateSchema.safeParse({ body: input }).success, true);
  const normalized = templatesManager.normalizeTemplateInput(input);

  assert.equal(normalized.languageCode, 'pt_BR');
  assert.equal(
    normalized.payload.builder.components[2].url,
    'https://notify.example/invite/{{1}}'
  );
  assert.deepEqual(normalized.payload.components, [
    { type: 'header', parameters: [{ type: 'image', image: { link: '{{headerMedia}}' } }] },
    {
      type: 'body',
      parameters: [{ type: 'text', text: '{{customerName}}', parameter_name: 'customer_name' }]
    },
    {
      type: 'button', sub_type: 'url', index: '0',
      parameters: [{ type: 'text', text: '{{inviteSuffix}}' }]
    }
  ]);

  assert.deepEqual(buildCustomTemplateMessage({
    name: normalized.externalTemplateName,
    languageCode: normalized.languageCode,
    builder: normalized.payload.builder,
    variables: {
      headerMedia: 'https://cdn.example.com/convite-real.png',
      customerName: 'Samuel',
      inviteSuffix: 'grupo-alpha'
    }
  }), {
    type: 'template',
    template: {
      name: 'convite_dinamico_v1',
      language: { code: 'pt_BR' },
      components: [
        { type: 'header', parameters: [{ type: 'image', image: { link: 'https://cdn.example.com/convite-real.png' } }] },
        {
          type: 'body',
          parameters: [{ type: 'text', text: 'Samuel', parameter_name: 'customer_name' }]
        },
        {
          type: 'button', sub_type: 'url', index: '0',
          parameters: [{ type: 'text', text: 'grupo-alpha' }]
        }
      ]
    }
  });
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

test('builder preserva a associacao da midia hospedada sem expor metadata no payload Meta', () => {
  const builder = {
    version: 1,
    components: [{
      id: 'header-media',
      type: 'header',
      parameters: [{
        id: 'header-image',
        type: 'image',
        key: 'imagem_cabecalho',
        label: 'Link da imagem',
        example: 'https://notify.example/api/media/token-assinado',
        contentMode: 'dynamic',
        mediaSource: 'upload',
        mediaAssetId: '507f1f77bcf86cd799439011',
        mimeType: 'image/png',
        mediaType: 'image',
        uploadedFilename: 'cabecalho.png'
      }]
    }]
  };

  const normalized = normalizeBuilder(builder);
  assert.deepEqual(normalized.components[0].parameters[0], builder.components[0].parameters[0]);
  assert.equal(createTemplateSchema.safeParse({
    body: {
      name: 'Aviso com imagem',
      channel: 'whatsapp_cloud',
      templateType: 'approved_template',
      body: 'Aviso com cabecalho de imagem',
      payload: { builder },
      variables: ['imagem_cabecalho'],
      whatsappCloudPreset: 'custom',
      externalTemplateName: 'aviso_com_imagem',
      languageCode: 'pt_BR'
    }
  }).success, true);

  const message = buildCustomTemplateMessage({
    name: 'aviso_com_imagem',
    languageCode: 'pt_BR',
    builder,
    variables: { imagem_cabecalho: builder.components[0].parameters[0].example }
  });
  assert.deepEqual(message.template.components[0].parameters[0], {
    type: 'image',
    image: { link: 'https://notify.example/api/media/token-assinado' }
  });
  assert.doesNotMatch(JSON.stringify(message), /mediaAssetId|mediaSource|uploadedFilename|mimeType/);
  assert.throws(
    () => normalizeBuilder({
      version: 1,
      components: [{
        type: 'header',
        parameters: [{
          type: 'video',
          key: 'video_cabecalho',
          label: 'Video',
          mediaSource: 'upload'
        }]
      }]
    }),
    /identificador do arquivo armazenado/
  );
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
  let recordedInbound;
  conversationsManager.recordInbound = async (input) => {
    recordedInbound = input;
    return {
      conversation: { id: '507f1f77bcf86cd799439177', channel: input.channel },
      message: { id: '507f1f77bcf86cd799439178', body: input.body }
    };
  };
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
  assert.equal(upsertInput.shareWhatsappConsent, undefined);
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
  assert.equal(recordedInbound.channel, 'whatsapp_cloud');
  assert.equal(recordedInbound.externalId, '551131234567');
  assert.equal(recordedInbound.contactId, '507f1f77bcf86cd799439011');
  assert.equal(recordedInbound.providerMessageId, 'wamid.inbound');
  assert.equal(recordedInbound.body, '/notify-me');
  assert.equal(recordedInbound.metadata.phoneNumberId, '1000000000000001');
  assert.equal(recordedInbound.metadata.businessAccountId, '1000000000000002');
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

test('/meu-perfil no WhatsApp responde com resumo privado e link publico', async (context) => {
  stubWebhookPersistence(context);
  restoreAfter(context, [
    [settingsManager, 'getValue'],
    [settingsManager, 'isWhatsappPermissionCommand'],
    [contactsManager, 'findByChannelAddress'],
    [contactsManager, 'findByChannelOrPhone'],
    [contactsManager, 'upsertFromChannel'],
    [logsManager, 'create'],
    [adminNotificationsManager, 'create'],
    [global, 'fetch'],
    [env, 'publicAppUrl']
  ]);
  const appSecret = 'cloud-secret';
  env.publicAppUrl = 'https://notify.example';
  settingsManager.getValue = async (key) => ({
    WHATSAPP_CLOUD_APP_SECRET: appSecret,
    WHATSAPP_CLOUD_ACCESS_TOKEN: 'test-access-token',
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: '1000000000000001',
    WHATSAPP_CLOUD_API_VERSION: 'v25.0'
  })[key] || null;
  settingsManager.isWhatsappPermissionCommand = async () => false;
  contactsManager.findByChannelAddress = async () => null;
  contactsManager.findByChannelOrPhone = async () => null;
  contactsManager.upsertFromChannel = async () => ({
    id: '507f1f77bcf86cd799439011',
    displayName: 'Samuel',
    upsertState: { created: false, identityAdded: false }
  });
  contactsManager.getById = async () => ({
    id: '507f1f77bcf86cd799439011',
    displayName: 'Samuel',
    email: 'samuel@example.test',
    phone: '5511999999999',
    telegramUsername: 'samuel_teste',
    channels: [{ channel: 'whatsapp_cloud', authorized: true, consentStatus: 'granted', metadata: {} }]
  });
  logsManager.create = async (entry) => entry;
  adminNotificationsManager.create = async () => ({});
  const providerPayloads = [];
  global.fetch = async (_url, options) => {
    providerPayloads.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.profile-response' }] })
    };
  };
  const payload = {
    entry: [{ changes: [{ value: {
      contacts: [{ wa_id: '551131234567', profile: { name: 'Samuel' } }],
      messages: [{
        id: 'wamid.profile-command',
        from: '551131234567',
        type: 'text',
        text: { body: '/meu-perfil' }
      }]
    } }] }]
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const result = await whatsappCloudManager.webhook(payload, rawBody, signature);

  assert.equal(result.receivedMessages, 1);
  const response = providerPayloads.find((item) => /Seus dados no Notify Flow/.test(item.text?.body || ''));
  assert.ok(response);
  assert.match(response.text.body, /samuel@example\.test/);
  assert.match(response.text.body, /https:\/\/notify\.example\/meu-perfil/);
  assert.doesNotMatch(response.text.body, /507f1f77bcf86cd799439011/);
});

test('/help no WhatsApp responde com a lista fixa e o comando dinamico atual', async (context) => {
  stubWebhookPersistence(context);
  restoreAfter(context, [
    [settingsManager, 'getValue'],
    [settingsManager, 'isWhatsappPermissionCommand'],
    [contactsManager, 'findByChannelAddress'],
    [contactsManager, 'findByChannelOrPhone'],
    [contactsManager, 'upsertFromChannel'],
    [logsManager, 'create'],
    [adminNotificationsManager, 'create'],
    [global, 'fetch']
  ]);
  const appSecret = 'cloud-secret';
  settingsManager.getValue = async (key) => ({
    WHATSAPP_CLOUD_APP_SECRET: appSecret,
    WHATSAPP_CLOUD_ACCESS_TOKEN: 'test-access-token',
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: '1000000000000001',
    WHATSAPP_CLOUD_API_VERSION: 'v25.0',
    START_NOTIFY_WHATSAPP_PERMISSION: '/avisos',
    START_VERIFY_TELEGRAM_PERMISSION: '/validar-telegram'
  })[key] || null;
  settingsManager.isWhatsappPermissionCommand = async () => false;
  contactsManager.findByChannelAddress = async () => null;
  contactsManager.findByChannelOrPhone = async () => null;
  contactsManager.upsertFromChannel = async () => ({
    id: '507f1f77bcf86cd799439011',
    displayName: 'Samuel',
    upsertState: { created: false, identityAdded: false }
  });
  logsManager.create = async (entry) => entry;
  adminNotificationsManager.create = async () => ({});
  const providerPayloads = [];
  global.fetch = async (_url, options) => {
    providerPayloads.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.help-response' }] })
    };
  };
  const payload = {
    entry: [{ changes: [{ value: {
      contacts: [{ wa_id: '551131234567', profile: { name: 'Samuel' } }],
      messages: [{
        id: 'wamid.help-command',
        from: '551131234567',
        type: 'text',
        text: { body: '/help' }
      }]
    } }] }]
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const result = await whatsappCloudManager.webhook(payload, rawBody, signature);

  assert.equal(result.receivedMessages, 1);
  const response = providerPayloads.find((item) => /Ajuda do Notify Flow no WhatsApp/.test(item.text?.body || ''));
  assert.ok(response);
  assert.match(response.text.body, /\/avisos/);
  assert.match(response.text.body, /\/login/);
  assert.match(response.text.body, /\/meu-perfil/);
  assert.match(response.text.body, /\/cancelar/);
  assert.doesNotMatch(response.text.body, /\/stop/);
});

test('codigo de verificacao de email e redigido antes de salvar o chat do WhatsApp', async (context) => {
  stubWebhookPersistence(context);
  restoreAfter(context, [
    [settingsManager, 'getValue'],
    [settingsManager, 'isWhatsappPermissionCommand'],
    [contactsManager, 'findByChannelAddress'],
    [contactsManager, 'findByChannelOrPhone'],
    [contactsManager, 'upsertFromChannel'],
    [logsManager, 'create'],
    [adminNotificationsManager, 'create'],
    [chatProfileFlow, 'safeInboundText'],
    [chatProfileFlow, 'handleInbound'],
    [global, 'fetch']
  ]);
  const appSecret = 'cloud-secret';
  settingsManager.getValue = async (key) => ({
    WHATSAPP_CLOUD_APP_SECRET: appSecret,
    WHATSAPP_CLOUD_ACCESS_TOKEN: 'test-access-token',
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: '1000000000000001',
    WHATSAPP_CLOUD_API_VERSION: 'v25.0'
  })[key] || null;
  settingsManager.isWhatsappPermissionCommand = async () => false;
  contactsManager.findByChannelAddress = async () => null;
  contactsManager.findByChannelOrPhone = async () => null;
  contactsManager.upsertFromChannel = async () => ({
    id: '507f1f77bcf86cd799439011',
    displayName: 'Samuel',
    upsertState: { created: false, identityAdded: false }
  });
  let recordedInbound;
  conversationsManager.recordInbound = async (input) => {
    recordedInbound = input;
    return { conversation: { id: '507f1f77bcf86cd799439177' } };
  };
  chatProfileFlow.safeInboundText = async (_contactId, text) => (
    text === '483921' ? chatProfileFlow.EMAIL_VERIFICATION_CODE_PLACEHOLDER : text
  );
  chatProfileFlow.handleInbound = async (input) => {
    assert.equal(input.text, '483921');
    return {
      handled: true,
      kind: 'email_updated',
      text: 'Email verificado com sucesso.'
    };
  };
  const logs = [];
  logsManager.create = async (entry) => { logs.push(entry); return entry; };
  adminNotificationsManager.create = async () => ({});
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ messages: [{ id: 'wamid.email-code-response' }] })
  });
  const payload = {
    entry: [{ changes: [{ value: {
      contacts: [{ wa_id: '551131234567', profile: { name: 'Samuel' } }],
      messages: [{
        id: 'wamid.email-code',
        from: '551131234567',
        type: 'text',
        text: { body: '483921' }
      }]
    } }] }]
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = 'sha256='
    + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  await whatsappCloudManager.webhook(payload, rawBody, signature);

  assert.equal(
    recordedInbound.body,
    chatProfileFlow.EMAIL_VERIFICATION_CODE_PLACEHOLDER
  );
  assert.doesNotMatch(JSON.stringify(recordedInbound), /483921/);
  assert.doesNotMatch(JSON.stringify(logs), /483921/);
});

test('/login sem parametro no WhatsApp emite link temporario direto sem alterar o fluxo assinado', async (context) => {
  stubWebhookPersistence(context);
  restoreAfter(context, [
    [settingsManager, 'getValue'],
    [settingsManager, 'isWhatsappPermissionCommand'],
    [contactsManager, 'findByChannelAddress'],
    [contactsManager, 'findByChannelOrPhone'],
    [contactsManager, 'upsertFromChannel'],
    [logsManager, 'create'],
    [adminNotificationsManager, 'create'],
    [profileManager, 'createDirectProfileLink'],
    [profileManager, 'activateProfileLoginFromWhatsapp'],
    [global, 'fetch']
  ]);
  const appSecret = 'cloud-secret';
  settingsManager.getValue = async (key) => ({
    WHATSAPP_CLOUD_APP_SECRET: appSecret,
    WHATSAPP_CLOUD_ACCESS_TOKEN: 'test-access-token',
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: '1000000000000001',
    WHATSAPP_CLOUD_API_VERSION: 'v25.0'
  })[key] || null;
  settingsManager.isWhatsappPermissionCommand = async () => false;
  contactsManager.findByChannelAddress = async () => null;
  contactsManager.findByChannelOrPhone = async () => null;
  contactsManager.upsertFromChannel = async () => ({
    id: '507f1f77bcf86cd799439011',
    displayName: 'Samuel',
    upsertState: { created: false, identityAdded: false }
  });
  let directRequest;
  profileManager.createDirectProfileLink = async (contactId, options) => {
    directRequest = { contactId, options };
    return {
      challengeId: 'profile-challenge-safe-id',
      url: 'https://notify.example/meu-perfil#acesso=token-opaco',
      expiresAt: new Date(Date.now() + 300_000).toISOString()
    };
  };
  let signedActivationCalled = false;
  profileManager.activateProfileLoginFromWhatsapp = async () => {
    signedActivationCalled = true;
    return { activated: false };
  };
  const logs = [];
  logsManager.create = async (entry) => { logs.push(entry); return entry; };
  adminNotificationsManager.create = async () => ({});
  const providerPayloads = [];
  global.fetch = async (_url, options) => {
    providerPayloads.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.direct-login-response' }] })
    };
  };
  const payload = {
    entry: [{ changes: [{ value: {
      contacts: [{ wa_id: '551131234567', profile: { name: 'Samuel' } }],
      messages: [{
        id: 'wamid.direct-login',
        from: '551131234567',
        type: 'text',
        text: { body: ' /LOGIN ' }
      }]
    } }] }]
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const result = await whatsappCloudManager.webhook(payload, rawBody, signature);

  assert.equal(result.receivedMessages, 1);
  assert.deepEqual(directRequest, {
    contactId: '507f1f77bcf86cd799439011',
    options: { source: 'whatsapp_login_command' }
  });
  assert.equal(signedActivationCalled, false);
  const response = providerPayloads.find((item) => /token-opaco/.test(item.text?.body || ''));
  assert.ok(response);
  assert.match(response.text.body, /link pode ser usado uma vez/i);
  assert.match(response.text.body, /envie \/login/i);
  assert.doesNotMatch(JSON.stringify(logs), /token-opaco/);
  assert.ok(logs.some((entry) => entry.action === 'profile_auth.link_issued'));
});

test('falha ao entregar magic link revoga o grant e nao registra sucesso falso', async (context) => {
  stubWebhookPersistence(context);
  restoreAfter(context, [
    [settingsManager, 'getValue'],
    [settingsManager, 'isWhatsappPermissionCommand'],
    [contactsManager, 'findByChannelAddress'],
    [contactsManager, 'findByChannelOrPhone'],
    [contactsManager, 'upsertFromChannel'],
    [logsManager, 'create'],
    [adminNotificationsManager, 'create'],
    [profileManager, 'parseProfileLoginInvocation'],
    [profileManager, 'activateProfileLoginFromWhatsapp'],
    [profileManager, 'createDirectProfileLink'],
    [profileManager, 'revokeProfileLink'],
    [global, 'fetch']
  ]);
  const appSecret = 'cloud-secret';
  settingsManager.getValue = async (key) => ({
    WHATSAPP_CLOUD_APP_SECRET: appSecret,
    WHATSAPP_CLOUD_ACCESS_TOKEN: 'test-access-token',
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: '1000000000000001',
    WHATSAPP_CLOUD_API_VERSION: 'v25.0'
  })[key] || null;
  settingsManager.isWhatsappPermissionCommand = async () => false;
  contactsManager.findByChannelAddress = async () => null;
  contactsManager.findByChannelOrPhone = async () => null;
  contactsManager.upsertFromChannel = async () => ({
    id: '507f1f77bcf86cd799439011',
    displayName: 'Samuel',
    upsertState: { created: false, identityAdded: false }
  });
  profileManager.parseProfileLoginInvocation = () => ({ command: '/login', marker: 'safe-marker' });
  profileManager.activateProfileLoginFromWhatsapp = async () => ({
    activated: true,
    challengeId: '9f9e0f12-353a-4c28-9a96-b9e267def122',
    url: 'https://notify.example/meu-perfil#acesso=token-opaco'
  });
  let directProfileLinkCalled = false;
  profileManager.createDirectProfileLink = async () => {
    directProfileLinkCalled = true;
    throw new Error('o fluxo assinado nao deve emitir um grant direto');
  };
  let revokedChallengeId = null;
  profileManager.revokeProfileLink = async (challengeId) => {
    revokedChallengeId = challengeId;
    return { revoked: true };
  };
  const actions = [];
  logsManager.create = async (input) => { actions.push(input.action); return {}; };
  adminNotificationsManager.create = async () => ({});
  global.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: { message: 'provider unavailable', code: 2 } })
  });
  const payload = {
    entry: [{ changes: [{ value: {
      contacts: [{ wa_id: '551131234567', profile: { name: 'Samuel' } }],
      messages: [{
        id: 'wamid.profile-login',
        from: '551131234567',
        type: 'text',
        text: { body: '/login safe-marker' }
      }]
    } }] }]
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const result = await whatsappCloudManager.webhook(payload, rawBody, signature);

  assert.equal(result.receivedMessages, 1);
  assert.equal(directProfileLinkCalled, false);
  assert.equal(revokedChallengeId, '9f9e0f12-353a-4c28-9a96-b9e267def122');
  assert.ok(actions.includes('profile_auth.link_delivery_failed'));
  assert.equal(actions.includes('profile_auth.link_issued'), false);
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
    channels: [{ channel: 'email', address: 'contato@example.com', authorized: true, consentStatus: 'granted' }]
  });
  contactsManager.upsertFromChannel = async (input) => ({
    id: '507f1f77bcf86cd799439011',
    displayName: 'Contato Web existente',
    upsertState: { created: false, identityAdded: true },
    channels: [{ channel: 'email' }, { channel: input.channel }]
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
