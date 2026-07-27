const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const Setting = require('../src/models/setting.model');
const settingsManager = require('../src/managers/settings.manager');
const settingsController = require('../src/controllers/settings.controller');
const authManager = require('../src/managers/auth.manager');
const logsManager = require('../src/managers/logs.manager');
const { encrypt } = require('../src/services/crypto.service');
const { createApp } = require('../src/app');
const { env } = require('../src/config/env');

function queryResult(value) {
  const query = {
    select() { return query; },
    async lean() { return value; }
  };
  return query;
}

test('configuracao normal fornece previews sem devolver segredos completos', async (context) => {
  const originals = { find: Setting.find, findOne: Setting.findOne };
  context.after(() => {
    Setting.find = originals.find;
    Setting.findOne = originals.findOne;
  });

  const stored = new Map([
    ['TELEGRAM_BOT_TOKEN', {
      key: 'TELEGRAM_BOT_TOKEN',
      valueEncrypted: encrypt('123456:telegram-token-super-secreto'),
      sensitive: true
    }],
    ['TELEGRAM_WEBHOOK_SECRET', {
      key: 'TELEGRAM_WEBHOOK_SECRET',
      valueEncrypted: encrypt('webhook-secret-super-secreto'),
      sensitive: true
    }]
  ]);
  Setting.find = () => queryResult([...stored.values()]);
  Setting.findOne = ({ key }) => queryResult(stored.get(key) || null);

  const items = await settingsManager.list();
  const token = items.find((item) => item.key === 'TELEGRAM_BOT_TOKEN');
  const webhookSecret = items.find((item) => item.key === 'TELEGRAM_WEBHOOK_SECRET');
  assert.equal(token.configured, true);
  assert.equal(token.value, undefined);
  assert.equal(token.preview, settingsManager.SENSITIVE_PREVIEW);
  assert.equal(token.preview, '••••••••••••');
  assert.equal(webhookSecret.preview, token.preview);
  assert.doesNotMatch(token.preview, /123456|secreto/);
  assert.doesNotMatch(JSON.stringify(items), /telegram-token-super-secreto|webhook-secret-super-secreto/);

  const revealed = await settingsManager.revealChannel('telegram');
  assert.deepEqual(Object.keys(revealed.values).sort(), ['botToken', 'webhookSecret']);
  assert.equal(revealed.values.botToken, '123456:telegram-token-super-secreto');
  assert.equal(revealed.values.webhookSecret, 'webhook-secret-super-secreto');
});

test('revelacao rejeita canal fora da allowlist e a rota exige autenticacao', async () => {
  await assert.rejects(
    settingsManager.revealChannel('whatsappWeb'),
    (error) => error.code === 'SETTING_CHANNEL_NOT_ALLOWED' && error.statusCode === 400
  );

  const response = await request(createApp()).get('/api/settings/reveal/telegram');
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_REQUIRED');
});

test('preview curto permanece totalmente mascarado', () => {
  assert.equal(settingsManager.maskedPreview('abc'), '••••••••');
  assert.notEqual(settingsManager.maskedPreview('v25.0'), 'v25.0');
});

test('resposta de revelacao desabilita cache intermediario e do navegador', async (context) => {
  const originals = {
    reveal: settingsManager.revealChannel,
    log: logsManager.create
  };
  context.after(() => {
    settingsManager.revealChannel = originals.reveal;
    logsManager.create = originals.log;
  });
  settingsManager.revealChannel = async () => ({ channel: 'email', values: { user: 'admin@example.test' } });
  let audit;
  logsManager.create = async (input) => { audit = input; return input; };
  const headers = {};
  let body;

  await settingsController.reveal(
    {
      id: 'request-safe-id',
      admin: { id: '507f1f77bcf86cd799439011' },
      validated: { params: { channel: 'email' } }
    },
    {
      set(name, value) { headers[name] = value; },
      vary(value) { headers.Vary = value; },
      json(value) { body = value; }
    }
  );

  assert.equal(headers['Cache-Control'], 'no-store, max-age=0');
  assert.equal(headers.Pragma, 'no-cache');
  assert.equal(headers.Vary, 'Authorization');
  assert.equal(body.data.channel, 'email');
  assert.deepEqual(audit.context, { settingsChannel: 'email' });
  assert.equal(audit.actor, '507f1f77bcf86cd799439011');
  assert.equal(audit.requestId, 'request-safe-id');
  assert.doesNotMatch(JSON.stringify(audit), /admin@example\.test/);
});

test('setValue e setBulk rejeitam sentinela mascarada sem escrever parcialmente', async (context) => {
  const original = Setting.updateOne;
  let writes = 0;
  context.after(() => { Setting.updateOne = original; });
  Setting.updateOne = async () => { writes += 1; return { acknowledged: true }; };

  await assert.rejects(
    settingsManager.setValue(
      'TELEGRAM_BOT_TOKEN',
      '********',
      '507f1f77bcf86cd799439011'
    ),
    (error) => error.statusCode === 422 && error.code === 'MASKED_SECRET_NOT_ALLOWED'
  );
  await assert.rejects(
    settingsManager.setBulk({
      telegram: {
        botToken: '123:token-novo',
        webhookSecret: 'web••••••••reto'
      }
    }, '507f1f77bcf86cd799439011'),
    (error) => error.statusCode === 422 && error.code === 'MASKED_SECRET_NOT_ALLOWED'
  );
  assert.equal(writes, 0);
});

test('rota autenticada de revelacao aplica limite dedicado', async (context) => {
  const originals = {
    auth: authManager.authenticateAccess,
    reveal: settingsManager.revealChannel,
    log: logsManager.create
  };
  context.after(() => {
    authManager.authenticateAccess = originals.auth;
    settingsManager.revealChannel = originals.reveal;
    logsManager.create = originals.log;
  });
  authManager.authenticateAccess = async () => ({ id: '507f1f77bcf86cd799439011' });
  settingsManager.revealChannel = async (channel) => ({ channel, values: { botToken: 'valor-real' } });
  logsManager.create = async (input) => input;
  const app = createApp();
  const revealLimit = Math.max(3, Math.min(10, env.authRateLimitMax));

  for (let attempt = 0; attempt < revealLimit; attempt += 1) {
    const response = await request(app)
      .get('/api/settings/reveal/telegram')
      .set('authorization', 'Bearer admin-token');
    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'no-store, max-age=0');
  }
  const limited = await request(app)
    .get('/api/settings/reveal/telegram')
    .set('authorization', 'Bearer admin-token');
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'SETTINGS_REVEAL_RATE_LIMITED');
});
