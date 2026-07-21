const test = require('node:test');
const assert = require('node:assert/strict');
const { refreshSchema } = require('../src/dtos/auth.dto');
const { channelSendSchema, telegramSendSchema, whatsappWebSendSchema, registerWebhookSchema } = require('../src/dtos/channels.dto');
const { createContactSchema } = require('../src/dtos/contacts.dto');
const { createTemplateSchema } = require('../src/dtos/templates.dto');
const templatesManager = require('../src/managers/templates.manager');
const settingsManager = require('../src/managers/settings.manager');
const { bulkSettingsSchema } = require('../src/dtos/settings.dto');
const { consentSchema } = require('../src/dtos/privacy.dto');
const {
  createNotificationSchema,
  listNotificationsSchema,
  listDeliveryIssuesSchema
} = require('../src/dtos/notifications.dto');

test('refresh aceita body vazio para cookie HttpOnly', () => {
  assert.equal(refreshSchema.safeParse({ body: {} }).success, true);
});

test('envio de canal exige exatamente um tipo de destino', () => {
  const contactId = '507f1f77bcf86cd799439011';
  assert.equal(channelSendSchema.safeParse({ body: { contactId } }).success, true);
  assert.equal(channelSendSchema.safeParse({ body: { groupId: contactId } }).success, true);
  assert.equal(channelSendSchema.safeParse({ body: { destination: 'destino@example.com' } }).success, true);
  assert.equal(channelSendSchema.safeParse({ body: {} }).success, false);
  assert.equal(channelSendSchema.safeParse({ body: { contactId, destination: 'attacker@example.com' } }).success, false);
  assert.equal(channelSendSchema.safeParse({ body: { contactId, groupId: contactId } }).success, false);
  assert.equal(channelSendSchema.safeParse({ body: { groupId: contactId, destination: '5511999999999' } }).success, false);
});

test('cadastro manual remove consentimento e metadados de proveniencia forjados', () => {
  const parsed = createContactSchema.safeParse({ body: {
    displayName: 'Contato manual',
    channels: [{
      channel: 'email',
      address: 'contato@example.com',
      authorized: true,
      consentStatus: 'granted',
      source: 'automatic_permission_command',
      metadata: {
        note: 'permitido',
        consentSource: 'forjado',
        consent_command: '/forjado',
        consentChangedByAdmin: true,
        permissionCommandReceived: true,
        auto_registered_via: 'whatsapp_cloud'
      }
    }]
  } });

  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data.body.channels[0], {
    channel: 'email',
    address: 'contato@example.com',
    metadata: { note: 'permitido' }
  });
});

test('consentimento manual limita canais e exige confirmacao para remover permissao', () => {
  const params = { id: '507f1f77bcf86cd799439011' };
  const granted = consentSchema.safeParse({
    params,
    body: { channel: 'whatsapp_web', status: 'granted', source: 'forjado_pelo_cliente' }
  });
  assert.equal(granted.success, true);
  assert.equal(granted.data.body.source, undefined);
  assert.equal(consentSchema.safeParse({ params, body: { channel: 'whatsapp_cloud', status: 'revoked' } }).success, false);
  assert.equal(consentSchema.safeParse({ params, body: { channel: 'email', status: 'denied', confirmed: true } }).success, true);
  assert.equal(consentSchema.safeParse({ params, body: { channel: 'telegram', status: 'granted' } }).success, false);
});

test('envio Telegram exige contato/grupo cadastrado e modo coerente', () => {
  const contact = '507f1f77bcf86cd799439011';
  assert.equal(telegramSendSchema.safeParse({ body: { contactId: contact, mode: 'quick', message: 'Oi' } }).success, true);
  assert.equal(telegramSendSchema.safeParse({ body: { mode: 'quick', message: 'Oi' } }).success, false);
  assert.equal(telegramSendSchema.safeParse({ body: { contactId: contact, groupId: contact, mode: 'quick', message: 'Oi' } }).success, false);
  assert.equal(telegramSendSchema.safeParse({ body: { contactId: contact, mode: 'template' } }).success, false);
});

test('WhatsApp Web aceita somente resposta individual e rejeita groupId', () => {
  const contact = '507f1f77bcf86cd799439011';
  assert.equal(whatsappWebSendSchema.safeParse({ body: { contactId: contact, text: 'Oi' } }).success, true);
  assert.equal(whatsappWebSendSchema.safeParse({ body: { destination: '5511999999999@c.us', text: 'Oi' } }).success, true);
  assert.equal(whatsappWebSendSchema.safeParse({ body: { groupId: contact, text: 'Oi' } }).success, false);
  assert.equal(whatsappWebSendSchema.safeParse({ body: { destination: '120@g.us', groupId: contact, text: 'Oi' } }).success, false);
});

test('templates rejeitam WhatsApp Web no contrato HTTP', () => {
  assert.equal(createTemplateSchema.safeParse({ body: {
    name: 'Template indevido', channel: 'whatsapp_web', body: 'Oi'
  } }).success, false);
  assert.throws(
    () => templatesManager.validateTemplateInput({ name: 'Template indevido', channel: 'whatsapp_web', body: 'Oi' }),
    (error) => error.code === 'WHATSAPP_WEB_DIRECT_ONLY' && error.statusCode === 422
  );
});

test('settings bulk aceita contrato amigavel do frontend', () => {
  const result = bulkSettingsSchema.safeParse({
    body: {
      telegram: { botToken: '123:token', webhookSecret: 'secret' },
      whatsappWeb: { sessionTtlDays: 90 },
      email: { user: 'admin@example.com', appPassword: 'app-pass' }
    }
  });
  assert.equal(result.success, true);
});

test('settings bulk aceita comando WhatsApp amigavel e rejeita caracteres de controle', () => {
  const valid = bulkSettingsSchema.safeParse({ body: {
    whatsappPermission: { command: '/notify-me' }
  } });
  const invalid = bulkSettingsSchema.safeParse({ body: {
    whatsappPermission: { command: '/notify\nme' }
  } });
  assert.equal(valid.success, true);
  assert.equal(valid.data.body.whatsappPermission.command, '/notify-me');
  assert.equal(invalid.success, false);
});

test('comando de permissao WhatsApp e comparado de forma exata sem diferenciar maiusculas', async (context) => {
  const original = settingsManager.getValue;
  context.after(() => { settingsManager.getValue = original; });
  settingsManager.getValue = async (key) => key === 'START_NOTIFY_WHATSAPP_PERMISSION' ? '/Quero-Alertas' : null;

  assert.equal(await settingsManager.isWhatsappPermissionCommand('  /quero-alertas  '), true);
  assert.equal(await settingsManager.isWhatsappPermissionCommand('/quero-alertas agora'), false);
});

test('settings bulk ignora campos vazios de canais opcionais', () => {
  const result = bulkSettingsSchema.safeParse({
    body: {
      telegram: { botToken: '123:token', webhookSecret: '' },
      whatsappWeb: { sessionTtlDays: '' },
      whatsappCloud: { accessToken: '', apiVersion: '' },
      email: { user: '', from: '', appPassword: '' }
    }
  });
  assert.equal(result.success, true);
  assert.equal(result.data.body.telegram.botToken, '123:token');
  assert.equal(result.data.body.telegram.webhookSecret, undefined);
  assert.equal(result.data.body.email.user, undefined);
  assert.equal(result.data.body.whatsappCloud.apiVersion, undefined);
  assert.equal(result.data.body.whatsappWeb.sessionTtlDays, undefined);
});

test('settings bulk ignora nulls enviados por formularios de outros canais', () => {
  const result = bulkSettingsSchema.safeParse({
    body: {
      telegram: { botToken: '123:token' },
      whatsappCloud: { businessAccountId: null, apiVersion: null },
      email: { user: null, from: null, fromName: null }
    }
  });
  assert.equal(result.success, true);
  assert.equal(result.data.body.whatsappCloud.businessAccountId, undefined);
  assert.equal(result.data.body.whatsappCloud.apiVersion, undefined);
  assert.equal(result.data.body.email.user, undefined);
  assert.equal(result.data.body.email.from, undefined);
  assert.equal(result.data.body.email.fromName, undefined);
});

test('notificacao global rejeita envio rapido e exige templates por canal', () => {
  const quick = createNotificationSchema.safeParse({
    body: {
      kind: 'quick',
      channel: 'global',
      content: { text: 'Alerta manual' },
      contactIds: ['507f1f77bcf86cd799439011'],
      groupIds: []
    }
  });
  assert.equal(quick.success, false);

  const global = createNotificationSchema.safeParse({
    body: {
      kind: 'global',
      channel: 'global',
      templateIds: {
        telegram: '507f1f77bcf86cd799439012',
        whatsapp_cloud: '507f1f77bcf86cd799439013',
        email: '507f1f77bcf86cd799439014'
      },
      content: { variables: { nome: 'Ana' } },
      contactIds: ['507f1f77bcf86cd799439011'],
      groupIds: []
    }
  });
  assert.equal(global.success, true);
});

test('notificacoes removem WhatsApp Web e exigem template no Cloud', () => {
  const contactIds = ['507f1f77bcf86cd799439011'];
  const templateId = '507f1f77bcf86cd799439012';
  assert.equal(createNotificationSchema.safeParse({ body: {
    kind: 'quick', channel: 'whatsapp_web', content: { text: 'Oi' }, contactIds, groupIds: []
  } }).success, false);
  assert.equal(createNotificationSchema.safeParse({ body: {
    kind: 'quick', channel: 'whatsapp_cloud', content: { text: 'Oi' }, contactIds, groupIds: []
  } }).success, false);
  assert.equal(createNotificationSchema.safeParse({ body: {
    kind: 'template', channel: 'whatsapp_cloud', templateId, content: { variables: {} }, contactIds, groupIds: []
  } }).success, true);
});

test('listagem de notificacoes exige opt-in explicito para incluir deliveries', () => {
  const detailed = listNotificationsSchema.safeParse({ query: { includeDeliveries: 'true', limit: '10' } });
  const compact = listNotificationsSchema.safeParse({ query: { limit: '10' } });
  assert.equal(detailed.success, true);
  assert.equal(detailed.data.query.includeDeliveries, true);
  assert.equal(compact.success, true);
  assert.equal(compact.data.query.includeDeliveries, undefined);
});

test('detalhes de falhas da fila possuem paginacao e filtros estritos', () => {
  const valid = listDeliveryIssuesSchema.safeParse({ query: {
    channel: 'whatsapp_cloud',
    notificationId: '507f1f77bcf86cd799439011',
    status: 'skipped',
    page: '2',
    limit: '25'
  } });
  assert.equal(valid.success, true);
  assert.equal(valid.data.query.limit, 25);
  assert.equal(listDeliveryIssuesSchema.safeParse({ query: { channel: 'whatsapp_web' } }).success, false);
  assert.equal(listDeliveryIssuesSchema.safeParse({ query: { status: 'sent' } }).success, false);
});

test('webhook Telegram exige HTTPS', () => {
  assert.equal(registerWebhookSchema.safeParse({ body: { url: 'https://example.ngrok.app' } }).success, true);
  assert.equal(registerWebhookSchema.safeParse({ body: { url: 'http://example.ngrok.app' } }).success, false);
});
