const test = require('node:test');
const assert = require('node:assert/strict');
const settingsManager = require('../src/managers/settings.manager');
const contactsManager = require('../src/managers/contacts.manager');
const logsManager = require('../src/managers/logs.manager');
const conversationsManager = require('../src/managers/conversations.manager');
const adminNotificationsManager = require('../src/managers/admin-notifications.manager');
const socketService = require('../src/services/socket.service');
const telegramManager = require('../src/managers/telegram.manager');

test('Telegram cria contato, conversa e aviso administrativo somente no primeiro inbound', async (context) => {
  const originals = {
    setting: settingsManager.getValue,
    find: contactsManager.findByChannelAddress,
    upsert: contactsManager.upsertFromChannel,
    log: logsManager.create,
    record: conversationsManager.recordInbound,
    notify: adminNotificationsManager.create,
    emit: socketService.emit
  };
  context.after(() => {
    settingsManager.getValue = originals.setting;
    contactsManager.findByChannelAddress = originals.find;
    contactsManager.upsertFromChannel = originals.upsert;
    logsManager.create = originals.log;
    conversationsManager.recordInbound = originals.record;
    adminNotificationsManager.create = originals.notify;
    socketService.emit = originals.emit;
  });

  settingsManager.getValue = async (key) => (
    key === 'TELEGRAM_WEBHOOK_SECRET' ? 'webhook-secret' : null
  );
  contactsManager.findByChannelAddress = async () => null;
  let contactInput;
  contactsManager.upsertFromChannel = async (input) => {
    contactInput = input;
    return { id: '507f1f77bcf86cd799439011', displayName: 'Ana' };
  };
  logsManager.create = async () => ({});
  let conversationInput;
  conversationsManager.recordInbound = async (input) => {
    conversationInput = input;
    return { conversation: { id: '507f1f77bcf86cd799439021' } };
  };
  const notices = [];
  adminNotificationsManager.create = async (input) => {
    notices.push(input);
    return input;
  };
  socketService.emit = () => undefined;

  await telegramManager.webhook({
    update_id: 2_026_072_100,
    message: {
      message_id: 77,
      date: 1_753_056_000,
      text: 'Oi',
      chat: { id: 123, type: 'private' },
      from: { id: 123, first_name: 'Ana', photo_url: 'https://cdn.example/ana.jpg' }
    }
  }, 'webhook-secret');

  assert.equal(contactInput.authorize, false);
  assert.equal(contactInput.consentStatus, undefined);
  assert.equal(contactInput.avatarUrl, 'https://cdn.example/ana.jpg');
  assert.equal(conversationInput.contactId, '507f1f77bcf86cd799439011');
  assert.equal(conversationInput.body, 'Oi');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].kind, 'contact_auto_created');
  assert.equal(notices[0].channel, 'telegram');
});
