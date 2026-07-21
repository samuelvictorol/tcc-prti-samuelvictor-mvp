const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Setting = require('../src/models/setting.model');
const settingsManager = require('../src/managers/settings.manager');
const logsManager = require('../src/managers/logs.manager');
const whatsappCloudManager = require('../src/managers/whatsapp-cloud.manager');
const whatsappCloudController = require('../src/controllers/whatsapp-cloud.controller');
const templatesManager = require('../src/managers/templates.manager');
const notificationsManager = require('../src/managers/notifications.manager');
const { channelSendSchema } = require('../src/dtos/channels.dto');
const { createTemplateSchema } = require('../src/dtos/templates.dto');

function restoreAfter(context, overrides) {
  const originals = Object.fromEntries(overrides.map(([target, key]) => [key, target[key]]));
  context.after(() => {
    for (const [target, key] of overrides) target[key] = originals[key];
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
  restoreAfter(context, [[settingsManager, 'getValue']]);
  const rawBody = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');
  const appSecret = 'app-secret-only';
  const signature = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const requested = [];
  settingsManager.getValue = async (key) => {
    requested.push(key);
    return key === 'WHATSAPP_CLOUD_APP_SECRET' ? appSecret : null;
  };

  assert.deepEqual(await whatsappCloudManager.webhook({ entry: [] }, rawBody, signature), { received: true });
  assert.deepEqual(requested, ['WHATSAPP_CLOUD_APP_SECRET']);
});

test('envio oficial usa apenas credenciais de envio e normaliza telefone para digitos', async (context) => {
  restoreAfter(context, [[settingsManager, 'getValue'], [logsManager, 'create']]);
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  const values = {
    WHATSAPP_CLOUD_ACCESS_TOKEN: 'access',
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: '1273327629189888',
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
    destination: '+55 (61) 98174-8795',
    allowUnconsented: true,
    officialTemplate: {
      preset: 'order_confirmation',
      parameters: { customerName: 'John Doe', orderNumber: '123456', orderDate: 'Jul 20, 2026' }
    }
  });

  assert.equal(result.providerMessageId, 'wamid.confirmation');
  assert.equal(request.url, 'https://graph.facebook.com/v25.0/1273327629189888/messages');
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
    to: '5561981748795'
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
    await whatsappCloudManager.send({ destination: '5561981748795', allowUnconsented: true, officialTemplate: { preset } });
  }
  assert.deepEqual(sent.map((payload) => payload.template), [
    { name: 'jaspers_market_plain_text_v1', language: { code: 'en_US' } },
    { name: 'hello_world', language: { code: 'en_US' } }
  ]);
});

test('contrato amigavel valida os tres presets sem payload JSON manual', () => {
  const destination = '5561981748795';
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

test('cadastro WhatsApp Cloud aceita os tres nomes legados e rejeita templates arbitrarios', () => {
  const inferred = templatesManager.normalizeTemplateInput({
    name: 'Ola mundo existente',
    channel: 'whatsapp_cloud',
    templateType: 'approved_template',
    externalTemplateName: 'hello_world'
  });
  assert.equal(inferred.whatsappCloudPreset, 'hello_world');

  const arbitrary = templatesManager.normalizeTemplateInput({
    name: 'Nao aprovado no fluxo atual',
    channel: 'whatsapp_cloud',
    templateType: 'approved_template',
    externalTemplateName: 'qualquer_outro_template'
  });
  assert.throws(
    () => templatesManager.validateTemplateInput(arbitrary),
    (error) => error.code === 'WHATSAPP_TEMPLATE_PRESET_REQUIRED'
  );
});

test('numero Meta rejeita destino sem DDI ou acima do limite E.164', () => {
  assert.equal(whatsappCloudManager.normalizeMetaDestination('+55-61-98174-8795'), '5561981748795');
  assert.throws(() => whatsappCloudManager.normalizeMetaDestination('123'), (error) => error.code === 'WHATSAPP_DESTINATION_INVALID');
  assert.throws(() => whatsappCloudManager.normalizeMetaDestination('1234567890123456'), (error) => error.code === 'WHATSAPP_DESTINATION_INVALID');
});
