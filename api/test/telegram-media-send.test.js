const test = require('node:test');
const assert = require('node:assert/strict');

const safeMediaPath = require.resolve('../src/services/safe-media.service');
const safeMediaService = require(safeMediaPath);
const originalDownload = safeMediaService.downloadTelegramMedia;
safeMediaService.downloadTelegramMedia = async (_url, kind) => ({
  buffer: kind === 'photo'
    ? Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    : Buffer.from('0000ftypisom', 'ascii'),
  mimeType: kind === 'photo' ? 'image/jpeg' : 'video/mp4',
  filename: kind === 'photo' ? 'telegram-photo.jpg' : 'telegram-video.mp4'
});

const settingsManager = require('../src/managers/settings.manager');
const contactsManager = require('../src/managers/contacts.manager');
const logsManager = require('../src/managers/logs.manager');
const conversationsManager = require('../src/managers/conversations.manager');
const telegramManager = require('../src/managers/telegram.manager');

test('Telegram baixa mídia validada e envia foto/vídeo como multipart', async (context) => {
  const originals = {
    getValue: settingsManager.getValue,
    getDestination: contactsManager.getDestination,
    setConsentByAddress: contactsManager.setConsentByAddress,
    log: logsManager.create,
    recordOutbound: conversationsManager.recordOutbound,
    fetch: global.fetch
  };
  context.after(() => {
    safeMediaService.downloadTelegramMedia = originalDownload;
    settingsManager.getValue = originals.getValue;
    contactsManager.getDestination = originals.getDestination;
    contactsManager.setConsentByAddress = originals.setConsentByAddress;
    logsManager.create = originals.log;
    conversationsManager.recordOutbound = originals.recordOutbound;
    global.fetch = originals.fetch;
  });

  settingsManager.getValue = async (key) => key === 'TELEGRAM_BOT_TOKEN' ? '123:media-token-for-tests' : null;
  contactsManager.getDestination = async () => ({ address: '123456789' });
  contactsManager.setConsentByAddress = async () => ({});
  logsManager.create = async () => ({});
  conversationsManager.recordOutbound = async () => ({});

  const calls = [];
  global.fetch = async (url, options) => {
    const method = String(url).split('/').at(-1);
    calls.push({ method, options });
    const result = {
      message_id: method === 'sendPhoto' ? 10 : 11,
      date: 1_700_000_000,
      chat: { id: 123456789, type: 'private', first_name: 'Ana' },
      ...(method === 'sendPhoto'
        ? { photo: [{ file_id: 'photo-small' }, { file_id: 'photo-large' }] }
        : { video: { file_id: 'video-file' } })
    };
    return { ok: true, json: async () => ({ ok: true, result }) };
  };

  await telegramManager.send({
    contactId: '507f1f77bcf86cd799439011',
    payload: { telegram: { version: 1, kind: 'photo', mediaUrl: 'https://cdn.example.com/a.jpg', caption: 'Foto segura' } }
  });
  await telegramManager.send({
    contactId: '507f1f77bcf86cd799439011',
    payload: { telegram: { version: 1, kind: 'video', mediaUrl: 'https://cdn.example.com/a.mp4', caption: 'Vídeo seguro' } }
  });

  assert.deepEqual(calls.map((call) => call.method), ['sendPhoto', 'sendVideo']);
  assert.ok(calls[0].options.body instanceof FormData);
  assert.equal(calls[0].options.headers, undefined);
  assert.equal(calls[0].options.body.get('chat_id'), '123456789');
  assert.equal(calls[0].options.body.get('caption'), 'Foto segura');
  assert.equal(calls[0].options.body.get('photo').type, 'image/jpeg');
  assert.equal(calls[1].options.body.get('video').type, 'video/mp4');
});

test('OTP de perfil no Telegram nao grava codigo em logs ou historico e retorna somente confirmacao', async (context) => {
  const originals = {
    getValue: settingsManager.getValue,
    getDestination: contactsManager.getDestination,
    setConsentByAddress: contactsManager.setConsentByAddress,
    log: logsManager.create,
    recordOutbound: conversationsManager.recordOutbound,
    fetch: global.fetch
  };
  context.after(() => {
    settingsManager.getValue = originals.getValue;
    contactsManager.getDestination = originals.getDestination;
    contactsManager.setConsentByAddress = originals.setConsentByAddress;
    logsManager.create = originals.log;
    conversationsManager.recordOutbound = originals.recordOutbound;
    global.fetch = originals.fetch;
  });

  settingsManager.getValue = async (key) => key === 'TELEGRAM_BOT_TOKEN' ? '123:profile-token-for-tests' : null;
  contactsManager.getDestination = async () => ({ address: '123456789' });
  contactsManager.setConsentByAddress = async () => ({});
  let logWrites = 0;
  let historyWrites = 0;
  logsManager.create = async () => { logWrites += 1; };
  conversationsManager.recordOutbound = async () => { historyWrites += 1; };
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      result: {
        message_id: 91,
        date: 1_700_000_000,
        chat: { id: 123456789, type: 'private', first_name: 'Ana' }
      }
    })
  });

  const result = await telegramManager.send({
    contactId: '507f1f77bcf86cd799439011',
    useCase: 'profile_auth',
    text: 'Seu codigo de acesso ao perfil e 123456. Ele expira em 10 minutos.'
  });

  assert.deepEqual(result, { delivered: true });
  assert.equal(logWrites, 0);
  assert.equal(historyWrites, 0);
  assert.doesNotMatch(JSON.stringify(result), /123456|message_id|chat/i);
});
