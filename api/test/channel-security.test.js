const test = require('node:test');
const assert = require('node:assert/strict');
const settingsManager = require('../src/managers/settings.manager');
const contactsManager = require('../src/managers/contacts.manager');
const groupsManager = require('../src/managers/groups.manager');
const logsManager = require('../src/managers/logs.manager');
const socketService = require('../src/services/socket.service');
const whatsappCloudManager = require('../src/managers/whatsapp-cloud.manager');
const telegramManager = require('../src/managers/telegram.manager');
const settingsController = require('../src/controllers/settings.controller');

test('WhatsApp Cloud impede payload de sobrescrever destino e produto', async (context) => {
  const originals = { getValue: settingsManager.getValue, log: logsManager.create, fetch: global.fetch };
  context.after(() => { settingsManager.getValue = originals.getValue; logsManager.create = originals.log; global.fetch = originals.fetch; });
  const values = {
    WHATSAPP_CLOUD_ACCESS_TOKEN: 'access',
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: 'phone-id',
    WHATSAPP_CLOUD_VERIFY_TOKEN: 'verify',
    WHATSAPP_CLOUD_APP_SECRET: 'secret',
    WHATSAPP_CLOUD_API_VERSION: 'v23.0'
  };
  settingsManager.getValue = async (key) => values[key];
  logsManager.create = async () => ({});
  let sentBody;
  global.fetch = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ messages: [{ id: 'wamid.1' }] }) };
  };

  await whatsappCloudManager.send({
    destination: '5511999999999',
    allowUnconsented: true,
    payload: { messaging_product: 'evil', recipient_type: 'group', to: 'attacker', type: 'text', text: { body: 'Oi' } }
  });
  assert.equal(sentBody.messaging_product, 'whatsapp');
  assert.equal(sentBody.recipient_type, 'individual');
  assert.equal(sentBody.to, '5511999999999');
});

test('Telegram libera retry do mesmo update apos falha e aceita write_access_allowed', async (context) => {
  const originals = {
    getValue: settingsManager.getValue,
    findContact: contactsManager.findByChannelAddress,
    upsert: contactsManager.upsertFromChannel,
    update: contactsManager.update,
    consent: contactsManager.setChannelConsent,
    log: logsManager.create,
    emit: socketService.emit,
    upsertGroup: groupsManager.upsertExternal,
    findGroup: groupsManager.findByExternalId
  };
  context.after(() => {
    settingsManager.getValue = originals.getValue;
    contactsManager.findByChannelAddress = originals.findContact;
    contactsManager.upsertFromChannel = originals.upsert;
    contactsManager.update = originals.update;
    contactsManager.setChannelConsent = originals.consent;
    logsManager.create = originals.log;
    socketService.emit = originals.emit;
    groupsManager.upsertExternal = originals.upsertGroup;
    groupsManager.findByExternalId = originals.findGroup;
  });
  settingsManager.getValue = async () => 'webhook-secret';
  contactsManager.findByChannelAddress = async () => ({ channels: [{ channel: 'telegram', consentStatus: 'revoked' }] });
  let attempts = 0;
  let lastInput;
  contactsManager.upsertFromChannel = async (input) => {
    attempts += 1;
    lastInput = input;
    if (attempts === 1) throw new Error('falha transitoria');
    return { id: '507f1f77bcf86cd799439011' };
  };
  contactsManager.update = async () => ({});
  contactsManager.setChannelConsent = async () => ({});
  logsManager.create = async () => ({});
  const socketEvents = [];
  socketService.emit = (event, payload) => socketEvents.push({ event, payload });

  const update = {
    update_id: 987654321,
    message: {
      message_id: 45,
      date: 1_700_000_000,
      text: 'Ola pelo Telegram',
      chat: { id: 123, type: 'private' },
      from: { id: 123, first_name: 'Ana', username: 'ana_teste' },
      write_access_allowed: { from_request: true }
    }
  };
  await assert.rejects(() => telegramManager.webhook(update, 'webhook-secret'), /falha transitoria/);
  const result = await telegramManager.webhook(update, 'webhook-secret');
  assert.equal(result.received, true);
  assert.equal(attempts, 2);
  assert.equal(lastInput.authorize, true);
  assert.equal(lastInput.source, 'telegram_write_access_allowed');
  assert.deepEqual(socketEvents.map((item) => item.event), ['telegram:message', 'telegram:chats', 'telegram:webhook']);
  const messageEvent = socketEvents.find((item) => item.event === 'telegram:message').payload;
  assert.equal(messageEvent.contactId, '507f1f77bcf86cd799439011');
  assert.equal(messageEvent.chat.id, '123');
  assert.equal(messageEvent.from.username, 'ana_teste');
  assert.equal(messageEvent.text, 'Ola pelo Telegram');
  assert.equal(messageEvent.sentAt, '2023-11-14T22:13:20.000Z');
  assert.doesNotMatch(JSON.stringify(socketEvents), /webhook-secret|bot-token/i);

  let groupChanges = 0;
  groupsManager.upsertExternal = async () => { groupChanges += 1; };
  await telegramManager.webhook({ update_id: 987654322, chat_member: { chat: { id: -1, type: 'supergroup' } } }, 'webhook-secret');
  assert.equal(groupChanges, 0);
});

test('Telegram gera segredo de webhook quando apenas token e URL foram informados', async (context) => {
  const originals = {
    getValue: settingsManager.getValue,
    setValue: settingsManager.setValue,
    fetch: global.fetch
  };
  context.after(() => {
    settingsManager.getValue = originals.getValue;
    settingsManager.setValue = originals.setValue;
    global.fetch = originals.fetch;
  });

  let storedSecret;
  let requestPayload;
  settingsManager.getValue = async (key) => {
    if (key === 'TELEGRAM_BOT_TOKEN') return '123:bot-token';
    if (key === 'TELEGRAM_WEBHOOK_SECRET') return storedSecret || null;
    return null;
  };
  settingsManager.setValue = async (key, value) => {
    assert.equal(key, 'TELEGRAM_WEBHOOK_SECRET');
    storedSecret = value;
    return { key, configured: true };
  };
  global.fetch = async (_url, options) => {
    requestPayload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ ok: true, result: true }) };
  };

  const result = await telegramManager.registerWebhook('https://example.ngrok-free.app/', 'admin-id');
  assert.equal(result.registered, true);
  assert.equal(result.webhookSecretGenerated, true);
  assert.equal(result.url, 'https://example.ngrok-free.app/api/webhooks/telegram');
  assert.match(storedSecret, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(requestPayload.secret_token, storedSecret);
  assert.equal(requestPayload.url, 'https://example.ngrok-free.app/api/webhooks/telegram');
});

test('Telegram preserva caminho customizado e relata token invalido sem vazar segredo', async (context) => {
  const originals = { getValue: settingsManager.getValue, fetch: global.fetch };
  context.after(() => {
    settingsManager.getValue = originals.getValue;
    global.fetch = originals.fetch;
  });
  settingsManager.getValue = async (key) => key === 'TELEGRAM_BOT_TOKEN' ? '123:super-secret-token' : 'webhook-secret';
  global.fetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({ ok: false, error_code: 404, description: 'Not Found bot123:super-secret-token' })
  });

  await assert.rejects(
    () => telegramManager.registerWebhook('https://hooks.example.com/custom/telegram'),
    (error) => {
      assert.equal(error.code, 'TELEGRAM_ERROR');
      assert.equal(error.expose, true);
      assert.equal(error.message, 'Token do bot Telegram invalido ou revogado');
      assert.equal(error.details.providerErrorCode, 404);
      assert.doesNotMatch(JSON.stringify(error), /super-secret-token/);
      return true;
    }
  );
  assert.equal(telegramManager.normalizeWebhookUrl('https://hooks.example.com/custom/telegram'), 'https://hooks.example.com/custom/telegram');
});

test('Telegram consulta getMe uma vez, normaliza a identidade e nunca expoe o token', async (context) => {
  const originals = {
    configured: settingsManager.channelConfigured,
    getValue: settingsManager.getValue,
    fetch: global.fetch
  };
  context.after(() => {
    settingsManager.channelConfigured = originals.configured;
    settingsManager.getValue = originals.getValue;
    global.fetch = originals.fetch;
    telegramManager.clearIdentityCache();
  });
  telegramManager.clearIdentityCache();
  settingsManager.channelConfigured = async () => true;
  settingsManager.getValue = async () => '999:token-que-nao-pode-vazar';
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({
        ok: true,
        result: { id: 999, is_bot: true, first_name: 'Notify Bot', username: '@notify_bot' }
      })
    };
  };

  const first = await telegramManager.status({ probe: true, force: true });
  const cached = await telegramManager.status({ probe: true });
  assert.deepEqual(first, {
    configured: true,
    reachable: true,
    bot: { id: '999', username: 'notify_bot', firstName: 'Notify Bot', displayName: 'Notify Bot' }
  });
  assert.deepEqual(cached, first);
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(first), /token-que-nao-pode-vazar/);
});

test('salvar token enriquece a configuracao com getMe sem bloquear o salvamento', async (context) => {
  const originals = {
    setBulk: settingsManager.setBulk,
    status: telegramManager.status,
    clear: telegramManager.clearIdentityCache
  };
  context.after(() => {
    settingsManager.setBulk = originals.setBulk;
    telegramManager.status = originals.status;
    telegramManager.clearIdentityCache = originals.clear;
  });
  settingsManager.setBulk = async () => ({
    updated: ['TELEGRAM_BOT_TOKEN'],
    configuration: { telegram: { configured: true, botTokenConfigured: true } }
  });
  let cacheCleared = false;
  let statusOptions;
  telegramManager.clearIdentityCache = () => { cacheCleared = true; };
  telegramManager.status = async (options) => {
    statusOptions = options;
    return {
      configured: true,
      reachable: true,
      bot: { id: '999', username: 'notify_bot', firstName: 'Notify Bot', displayName: 'Notify Bot' }
    };
  };
  let response;
  await settingsController.updateBulk(
    { validated: { body: { telegram: { botToken: 'segredo' } } }, admin: { id: 'admin-id' } },
    { json: (value) => { response = value; } }
  );

  assert.equal(cacheCleared, true);
  assert.deepEqual(statusOptions, { probe: true, force: true });
  assert.equal(response.data.configuration.telegram.bot.username, 'notify_bot');
  assert.doesNotMatch(JSON.stringify(response), /segredo/);
});
