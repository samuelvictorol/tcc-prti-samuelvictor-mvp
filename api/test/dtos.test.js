const test = require('node:test');
const assert = require('node:assert/strict');
const { refreshSchema } = require('../src/dtos/auth.dto');
const { telegramSendSchema, registerWebhookSchema } = require('../src/dtos/channels.dto');
const { bulkSettingsSchema } = require('../src/dtos/settings.dto');
const { createNotificationSchema } = require('../src/dtos/notifications.dto');

test('refresh aceita body vazio para cookie HttpOnly', () => {
  assert.equal(refreshSchema.safeParse({ body: {} }).success, true);
});

test('envio Telegram exige contato/grupo cadastrado e modo coerente', () => {
  const contact = '507f1f77bcf86cd799439011';
  assert.equal(telegramSendSchema.safeParse({ body: { contactId: contact, mode: 'quick', message: 'Oi' } }).success, true);
  assert.equal(telegramSendSchema.safeParse({ body: { mode: 'quick', message: 'Oi' } }).success, false);
  assert.equal(telegramSendSchema.safeParse({ body: { contactId: contact, groupId: contact, mode: 'quick', message: 'Oi' } }).success, false);
  assert.equal(telegramSendSchema.safeParse({ body: { contactId: contact, mode: 'template' } }).success, false);
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

test('notificacao rapida global aceita o mesmo conteudo para canais disponiveis', () => {
  const result = createNotificationSchema.safeParse({
    body: {
      kind: 'quick',
      channel: 'global',
      content: { text: 'Alerta manual' },
      contactIds: ['507f1f77bcf86cd799439011'],
      groupIds: []
    }
  });
  assert.equal(result.success, true);
});

test('webhook Telegram exige HTTPS', () => {
  assert.equal(registerWebhookSchema.safeParse({ body: { url: 'https://example.ngrok.app' } }).success, true);
  assert.equal(registerWebhookSchema.safeParse({ body: { url: 'http://example.ngrok.app' } }).success, false);
});
