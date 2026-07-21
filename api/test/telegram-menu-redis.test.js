const test = require('node:test');
const assert = require('node:assert/strict');

const redisService = require('../src/services/redis.service');
const originalGetRedis = redisService.getRedis;
const values = new Map();
const fakeRedis = {
  async set(key, value, options = {}) {
    if (options.NX && values.has(key)) return null;
    values.set(key, value);
    return 'OK';
  },
  async get(key) { return values.get(key) || null; },
  async del(key) { return values.delete(key) ? 1 : 0; }
};
redisService.getRedis = () => fakeRedis;

const settingsManager = require('../src/managers/settings.manager');
const contactsManager = require('../src/managers/contacts.manager');
const logsManager = require('../src/managers/logs.manager');
const conversationsManager = require('../src/managers/conversations.manager');
const telegramManager = require('../src/managers/telegram.manager');

test('sessão de menu fica cifrada no Redis e conteúdo corrompido expira com segurança', async (context) => {
  const originals = {
    getValue: settingsManager.getValue,
    getDestination: contactsManager.getDestination,
    log: logsManager.create,
    recordOutbound: conversationsManager.recordOutbound,
    fetch: global.fetch
  };
  context.after(() => {
    redisService.getRedis = originalGetRedis;
    settingsManager.getValue = originals.getValue;
    contactsManager.getDestination = originals.getDestination;
    logsManager.create = originals.log;
    conversationsManager.recordOutbound = originals.recordOutbound;
    global.fetch = originals.fetch;
    values.clear();
  });
  settingsManager.getValue = async (key) => ({
    TELEGRAM_BOT_TOKEN: '123:redis-menu-token',
    TELEGRAM_WEBHOOK_SECRET: 'redis-webhook-secret'
  })[key] || null;
  contactsManager.getDestination = async () => ({ address: '24680' });
  logsManager.create = async () => ({});
  conversationsManager.recordOutbound = async () => ({});

  const calls = [];
  global.fetch = async (url, options) => {
    const method = String(url).split('/').at(-1);
    const body = JSON.parse(options.body);
    calls.push({ method, body });
    return {
      ok: true,
      json: async () => ({
        ok: true,
        result: ['sendMessage', 'editMessageText'].includes(method)
          ? { message_id: 9, date: 1_700_000_000, chat: { id: 24680, type: 'private' } }
          : true
      })
    };
  };

  const definition = {
    version: 1,
    kind: 'menu',
    rootNodeId: 'inicio',
    nodes: [
      { id: 'inicio', title: 'Informação sigilosa', text: 'Escolha', rows: [[{ id: 'abrir', label: 'Abrir', action: 'submenu', targetNodeId: 'filho' }]] },
      { id: 'filho', parentId: 'inicio', title: 'Detalhes', text: 'Conteúdo', rows: [] }
    ]
  };
  await telegramManager.send({ contactId: '507f1f77bcf86cd799439011', payload: { telegram: definition } });

  const menuEntry = [...values.entries()].find(([key]) => key.startsWith('telegram:menu:'));
  assert.ok(menuEntry);
  assert.match(menuEntry[1], /^enc:v1:/);
  assert.doesNotMatch(menuEntry[1], /Informação sigilosa|Escolha|24680/);

  const callbackData = calls[0].body.reply_markup.inline_keyboard[0][0].callback_data;
  const navigated = await telegramManager.webhook({
    update_id: 880001,
    callback_query: { id: 'cb-ok', data: callbackData, message: { message_id: 9, chat: { id: 24680, type: 'private' } } }
  }, 'redis-webhook-secret');
  assert.equal(navigated.callback, 'navigated');

  values.set(menuEntry[0], 'enc:v1:conteudo-corrompido');
  const expired = await telegramManager.webhook({
    update_id: 880002,
    callback_query: { id: 'cb-expired', data: callbackData, message: { message_id: 9, chat: { id: 24680, type: 'private' } } }
  }, 'redis-webhook-secret');
  assert.equal(expired.callback, 'expired');
  assert.equal(calls.at(-1).method, 'answerCallbackQuery');
  assert.equal(calls.at(-1).body.show_alert, true);
});
