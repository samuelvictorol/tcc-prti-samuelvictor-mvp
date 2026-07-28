const test = require('node:test');
const assert = require('node:assert/strict');

const settingsManager = require('../src/managers/settings.manager');
const contactsManager = require('../src/managers/contacts.manager');
const conversationsManager = require('../src/managers/conversations.manager');
const logsManager = require('../src/managers/logs.manager');
const adminNotificationsManager = require('../src/managers/admin-notifications.manager');
const telegramManager = require('../src/managers/telegram.manager');
const socketService = require('../src/services/socket.service');
const { encrypt, decrypt, searchHash } = require('../src/services/crypto.service');
const Contact = require('../src/models/contact.model');
const ContactGroup = require('../src/models/contact-group.model');
const ConsentEvent = require('../src/models/consent-event.model');
const AdminNotification = require('../src/models/admin-notification.model');
const Conversation = require('../src/models/conversation.model');
const ConversationMessage = require('../src/models/conversation-message.model');
const Invite = require('../src/models/invite.model');
const InviteClick = require('../src/models/invite-click.model');
const Notification = require('../src/models/notification.model');
const ProfileAuthChallenge = require('../src/models/profile-auth-challenge.model');
const { env } = require('../src/config/env');

function telegramUpdate(updateId, overrides = {}) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_753_056_000,
      chat: { id: 445566, type: 'private' },
      from: {
        id: 445566,
        first_name: 'Samuel',
        username: 'samuel_teste',
        photo_url: 'https://cdn.example/samuel.jpg'
      },
      ...overrides
    }
  };
}

function stubTelegramInbound(context, options = {}) {
  const originals = {
    getValue: settingsManager.getValue,
    find: contactsManager.findByChannelAddress,
    upsert: contactsManager.upsertFromChannel,
    update: contactsManager.update,
    record: conversationsManager.recordInbound,
    log: logsManager.create,
    notify: adminNotificationsManager.create,
    emit: socketService.emit,
    fetch: global.fetch,
    publicAppUrl: env.publicAppUrl
  };
  telegramManager.clearIdentityCache();
  env.publicAppUrl = options.publicAppUrl || 'https://notify.example';
  context.after(() => {
    settingsManager.getValue = originals.getValue;
    contactsManager.findByChannelAddress = originals.find;
    contactsManager.upsertFromChannel = originals.upsert;
    contactsManager.update = originals.update;
    conversationsManager.recordInbound = originals.record;
    logsManager.create = originals.log;
    adminNotificationsManager.create = originals.notify;
    socketService.emit = originals.emit;
    global.fetch = originals.fetch;
    env.publicAppUrl = originals.publicAppUrl;
    telegramManager.clearIdentityCache();
  });
  settingsManager.getValue = async (key) => ({
    TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
    TELEGRAM_BOT_TOKEN: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcd',
    START_NOTIFY_WHATSAPP_PERMISSION: options.notifyCommand || '/notify-me',
    START_VERIFY_TELEGRAM_PERMISSION: options.verifyCommand || '/verify-me'
  })[key] || null;
  contactsManager.findByChannelAddress = async () => options.existing || null;
  let upsertInput;
  contactsManager.upsertFromChannel = async (input) => {
    upsertInput = input;
    return options.contact || {
      id: '507f1f77bcf86cd799439011',
      displayName: 'Samuel',
      phone: input.phone || null,
      upsertState: { created: false, identityAdded: true }
    };
  };
  contactsManager.update = async () => ({});
  conversationsManager.recordInbound = async () => ({ conversation: { id: '507f1f77bcf86cd799439012' } });
  const logs = [];
  logsManager.create = async (entry) => { logs.push(entry); return entry; };
  adminNotificationsManager.create = async () => ({});
  socketService.emit = () => undefined;
  const providerCalls = [];
  global.fetch = options.fetch || (async (_url, request) => {
    providerCalls.push(JSON.parse(request.body));
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 991 } }) };
  });
  return {
    input: () => upsertInput,
    logs,
    providerCalls
  };
}

test('Telegram aceita telefone somente do contato compartilhado pelo proprio remetente', async (context) => {
  const state = stubTelegramInbound(context);
  const result = await telegramManager.webhook(telegramUpdate(2_026_072_201, {
    contact: {
      phone_number: '+55 (11) 3123-4567',
      first_name: 'Samuel',
      user_id: 445566
    }
  }), 'webhook-secret');

  assert.equal(result.received, true);
  assert.equal(state.input().phone, '551131234567');
  assert.equal(state.input().phoneVerified, true);
  assert.equal(state.input().metadata.phoneSharedByOwner, true);
  assert.equal(state.input().metadata.contactUserId, '445566');
  assert.equal(state.providerCalls.length, 1);
  assert.deepEqual(state.providerCalls[0].reply_markup, { remove_keyboard: true });
  assert.equal(state.logs.some((entry) => entry.action === 'contact.phone_share_rejected'), false);
});

test('Telegram ignora telefone de terceiro mesmo que o payload contact seja valido', async (context) => {
  const state = stubTelegramInbound(context);
  await telegramManager.webhook(telegramUpdate(2_026_072_202, {
    contact: {
      phone_number: '+55 61 99999-0000',
      first_name: 'Outra pessoa',
      user_id: 998877
    }
  }), 'webhook-secret');

  assert.equal(state.input().phone, null);
  assert.equal(state.input().phoneVerified, false);
  assert.equal(state.input().metadata.phoneSharedByOwner, undefined);
  assert.equal(state.providerCalls.length, 1);
  assert.match(state.providerCalls[0].text, /pr[oó]prio n[uú]mero/i);
  assert.deepEqual(state.providerCalls[0].reply_markup, { remove_keyboard: true });
  const rejection = state.logs.find((entry) => entry.action === 'contact.phone_share_rejected');
  assert.equal(rejection.context.reason, 'CONTACT_OWNER_MISMATCH');
  assert.doesNotMatch(JSON.stringify(rejection), /999990000/);
});

test('/start concede Telegram mesmo se o envio do pedido opcional de telefone falhar', async (context) => {
  const state = stubTelegramInbound(context, {
    contact: {
      id: '507f1f77bcf86cd799439011', displayName: 'Samuel', phone: null,
      upsertState: { created: true, identityAdded: true }
    },
    fetch: async () => ({
      ok: false,
      status: 502,
      json: async () => ({ ok: false, error_code: 502, description: 'provider unavailable' })
    })
  });
  const result = await telegramManager.webhook(telegramUpdate(2_026_072_203, {
    text: '/start notify-me'
  }), 'webhook-secret');

  assert.equal(result.received, true);
  assert.equal(state.input().authorize, true);
  assert.equal(state.input().consentStatus, 'granted');
  assert.ok(state.logs.some((entry) => entry.action === 'onboarding.menu_send_failed'));
});

test('comando Telegram configurado autoriza o contato e envia menu de onboarding', async (context) => {
  const state = stubTelegramInbound(context, {
    verifyCommand: '/validar-telegram',
    contact: {
      id: '507f1f77bcf86cd799439011', displayName: 'Samuel', phone: null,
      upsertState: { created: false, identityAdded: false }
    }
  });

  await telegramManager.webhook(telegramUpdate(2_026_072_204, {
    text: ' /VALIDAR-TELEGRAM '
  }), 'webhook-secret');

  assert.equal(state.input().authorize, true);
  assert.equal(state.input().consentStatus, 'granted');
  assert.equal(state.input().consentSource, 'automatic_permission_command');
  assert.equal(state.input().consentCommand, '/validar-telegram');
  assert.equal(state.input().metadata.permissionCommandReceived, true);
  assert.equal(state.input().metadata.permissionCommandReceivedVia, 'telegram');
  assert.equal(state.providerCalls.length, 1);
  const menu = state.providerCalls[0];
  assert.equal(menu.chat_id, '445566');
  assert.equal(menu.reply_markup.inline_keyboard.length, 3);
  assert.match(menu.reply_markup.inline_keyboard[0][0].callback_data, /onboarding:phone/);
  assert.match(menu.reply_markup.inline_keyboard[1][0].url, /^https?:\/\/.*\/meu-perfil$/);
  assert.match(menu.reply_markup.inline_keyboard[2][0].callback_data, /onboarding:help/);
  assert.equal(JSON.stringify(menu).includes('request_contact'), false);
});

test('deep-link do comando /notify dinamico abre o mesmo onboarding Telegram', async (context) => {
  const state = stubTelegramInbound(context, {
    notifyCommand: '/quero-alertas',
    contact: {
      id: '507f1f77bcf86cd799439011', displayName: 'Samuel', phone: null,
      upsertState: { created: false, identityAdded: false }
    }
  });

  await telegramManager.webhook(telegramUpdate(2_026_072_205, {
    text: '/start quero-alertas'
  }), 'webhook-secret');

  assert.equal(state.input().consentCommand, '/quero-alertas');
  assert.equal(state.input().metadata.permissionCommandSource, 'configured_notify_deep_link');
  assert.equal(state.providerCalls[0].reply_markup.inline_keyboard.length, 3);
});

test('menu usa a origem HTTPS do webhook quando PUBLIC_APP_URL ainda aponta para localhost', async (context) => {
  let menuPayload;
  const state = stubTelegramInbound(context, {
    publicAppUrl: 'http://localhost:8080',
    contact: {
      id: '507f1f77bcf86cd799439011', displayName: 'Samuel', phone: null,
      upsertState: { created: false, identityAdded: false }
    },
    fetch: async (url, request) => {
      if (String(url).endsWith('/getWebhookInfo')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            result: { url: 'https://notify-test.ngrok-free.app/api/webhooks/telegram' }
          })
        };
      }
      menuPayload = JSON.parse(request.body);
      return { ok: true, json: async () => ({ ok: true, result: { message_id: 992 } }) };
    }
  });

  await telegramManager.webhook(telegramUpdate(2_026_072_209, {
    text: '/notify-me'
  }), 'webhook-secret');

  assert.equal(menuPayload.reply_markup.inline_keyboard.length, 3);
  assert.equal(
    menuPayload.reply_markup.inline_keyboard[1][0].url,
    'https://notify-test.ngrok-free.app/meu-perfil'
  );
  assert.equal(state.logs.some((entry) => entry.action === 'contact.phone_request_failed'), false);
});

test('menu preserva as tres opcoes quando nenhuma URL publica do perfil esta disponivel', async (context) => {
  let menuPayload;
  const state = stubTelegramInbound(context, {
    publicAppUrl: 'http://localhost:8080',
    contact: {
      id: '507f1f77bcf86cd799439011', displayName: 'Samuel', phone: null,
      upsertState: { created: false, identityAdded: false }
    },
    fetch: async (url, request) => {
      if (String(url).endsWith('/getWebhookInfo')) {
        return { ok: true, json: async () => ({ ok: true, result: { url: '' } }) };
      }
      menuPayload = JSON.parse(request.body);
      return { ok: true, json: async () => ({ ok: true, result: { message_id: 993 } }) };
    }
  });

  await telegramManager.webhook(telegramUpdate(2_026_072_210, {
    text: '/notify-me'
  }), 'webhook-secret');

  assert.equal(menuPayload.reply_markup.inline_keyboard.length, 3);
  assert.equal(menuPayload.reply_markup.inline_keyboard[1][0].url, undefined);
  assert.match(menuPayload.reply_markup.inline_keyboard[1][0].callback_data, /onboarding:profile/);
  assert.ok(state.logs.some((entry) => entry.action === 'onboarding.profile_url_unavailable'));
  assert.equal(state.logs.some((entry) => entry.action === 'contact.phone_request_failed'), false);
});

test('callback de telefone responde ao Telegram e so entao abre o request_contact nativo', async (context) => {
  const state = stubTelegramInbound(context);
  const update = {
    update_id: 2_026_072_206,
    callback_query: {
      id: 'callback-phone-1',
      data: 'notify:onboarding:phone:v1',
      from: { id: 445566, first_name: 'Samuel' },
      message: { message_id: 900, chat: { id: 445566, type: 'private' } }
    }
  };

  const result = await telegramManager.webhook(update, 'webhook-secret');
  assert.equal(result.callback, 'onboarding_phone');
  assert.equal(state.providerCalls.length, 2);
  assert.equal(state.providerCalls[0].callback_query_id, 'callback-phone-1');
  assert.equal(state.providerCalls[1].chat_id, '445566');
  assert.equal(state.providerCalls[1].reply_markup.keyboard[0][0].request_contact, true);
  assert.equal(state.providerCalls[1].reply_markup.one_time_keyboard, true);

  const duplicate = await telegramManager.webhook(update, 'webhook-secret');
  assert.equal(duplicate.duplicate, true);
  assert.equal(state.providerCalls.length, 2);
});

test('callback de Ajuda explica vinculo e Meu perfil sem pedir telefone', async (context) => {
  const state = stubTelegramInbound(context);
  const result = await telegramManager.webhook({
    update_id: 2_026_072_207,
    callback_query: {
      id: 'callback-help-1',
      data: 'notify:onboarding:help:v1',
      from: { id: 445566, first_name: 'Samuel' },
      message: { message_id: 901, chat: { id: 445566, type: 'private' } }
    }
  }, 'webhook-secret');

  assert.equal(result.callback, 'onboarding_help');
  assert.equal(state.providerCalls[0].callback_query_id, 'callback-help-1');
  assert.match(state.providerCalls[1].text, /Vincular meu telefone/i);
  assert.match(state.providerCalls[1].text, /Meu perfil/i);
  assert.equal(JSON.stringify(state.providerCalls).includes('request_contact'), false);
});

test('callback de onboarding encaminhado para outro chat nao pode solicitar telefone', async (context) => {
  const state = stubTelegramInbound(context);
  const result = await telegramManager.webhook({
    update_id: 2_026_072_208,
    callback_query: {
      id: 'callback-forwarded-1',
      data: 'notify:onboarding:phone:v1',
      from: { id: 998877, first_name: 'Outra pessoa' },
      message: { message_id: 902, chat: { id: 445566, type: 'private' } }
    }
  }, 'webhook-secret');

  assert.equal(result.callback, 'onboarding_forbidden');
  assert.equal(state.providerCalls.length, 1);
  assert.equal(state.providerCalls[0].show_alert, true);
});

test('telefone Telegram so participa da deduplicacao quando foi verificado', () => {
  assert.equal(contactsManager.mergePhoneIdentity('telegram', '+55 11 93123-4567'), null);
  const verified = contactsManager.mergePhoneIdentity(
    'telegram',
    '+55 11 93123-4567',
    { verified: true }
  );
  assert.equal(verified.normalized, '5511931234567');
  assert.ok(verified.hashes.includes(searchHash('551131234567')));
});

test('Telegram-only e consolidado no contato WhatsApp do mesmo telefone sem perder consentimento ou avatar', async (context) => {
  const sourceId = '507f1f77bcf86cd799439021';
  const targetId = '507f1f77bcf86cd799439022';
  const telegramAddress = '445566';
  const telegramIdentity = {
    _id: '507f1f77bcf86cd799439023',
    channel: 'telegram',
    addressEncrypted: encrypt(telegramAddress),
    addressHash: searchHash(telegramAddress),
    authorized: true,
    consentStatus: 'granted',
    source: 'telegram_webhook',
    metadataEncrypted: encrypt({ chatId: telegramAddress, userId: telegramAddress })
  };
  const source = {
    _id: sourceId,
    displayNameEncrypted: encrypt('Samuel Telegram'),
    displayNameHash: searchHash('samuel telegram'),
    displayNameSource: 'telegram',
    telegramUsernameEncrypted: encrypt('samuel_teste'),
    telegramUsernameHash: searchHash('samuel_teste'),
    channels: [telegramIdentity],
    channelAvatars: [{ channel: 'telegram', urlEncrypted: encrypt('https://cdn.example/telegram.jpg') }],
    tags: ['telegram'],
    active: true,
    notificationDisabled: false,
    async save() {},
    toObject() { return { ...this }; }
  };
  const target = {
    _id: targetId,
    displayNameEncrypted: encrypt('Samuel cadastrado'),
    displayNameHash: searchHash('samuel cadastrado'),
    displayNameSource: 'manual',
    phoneEncrypted: encrypt('551131234567'),
    phoneHash: searchHash('551131234567'),
    channels: [{
      _id: '507f1f77bcf86cd799439024',
      channel: 'whatsapp_cloud',
      addressEncrypted: encrypt('551131234567'),
      addressHash: searchHash('551131234567'),
      authorized: true,
      consentStatus: 'granted',
      source: 'whatsapp_cloud_webhook'
    }],
    channelAvatars: [{ channel: 'whatsapp_cloud', urlEncrypted: encrypt('https://cdn.example/whatsapp.jpg') }],
    tags: ['cliente'],
    active: true,
    notificationDisabled: false,
    async save() {},
    toObject() { return { ...this }; }
  };

  const originals = {
    findOne: Contact.findOne,
    find: Contact.find,
    contactGroup: ContactGroup.updateMany,
    consentCreate: ConsentEvent.create,
    consentUpdate: ConsentEvent.updateMany,
    admin: AdminNotification.updateMany,
    conversation: Conversation.updateMany,
    message: ConversationMessage.updateMany,
    invite: Invite.updateMany,
    click: InviteClick.updateMany,
    notification: Notification.updateMany,
    challenge: ProfileAuthChallenge.updateMany
  };
  context.after(() => {
    Contact.findOne = originals.findOne;
    Contact.find = originals.find;
    ContactGroup.updateMany = originals.contactGroup;
    ConsentEvent.create = originals.consentCreate;
    ConsentEvent.updateMany = originals.consentUpdate;
    AdminNotification.updateMany = originals.admin;
    Conversation.updateMany = originals.conversation;
    ConversationMessage.updateMany = originals.message;
    Invite.updateMany = originals.invite;
    InviteClick.updateMany = originals.click;
    Notification.updateMany = originals.notification;
    ProfileAuthChallenge.updateMany = originals.challenge;
  });
  Contact.findOne = () => ({ select: async () => source });
  Contact.find = () => {
    const query = {
      select() { return query; },
      async limit() { return [target]; }
    };
    return query;
  };
  ConsentEvent.create = async () => ({});
  const referenceUpdates = [];
  for (const model of [
    ContactGroup, ConsentEvent, AdminNotification, Conversation, ConversationMessage,
    Invite, InviteClick, Notification, ProfileAuthChallenge
  ]) {
    model.updateMany = async (...args) => { referenceUpdates.push({ model: model.modelName, args }); return {}; };
  }

  const result = await contactsManager.upsertFromChannel({
    channel: 'telegram',
    address: telegramAddress,
    displayName: 'Samuel Telegram',
    phone: '+55 11 3123-4567',
    phoneVerified: true,
    avatarUrl: 'https://cdn.example/telegram-nova.jpg',
    authorize: true,
    consentStatus: 'granted',
    source: 'telegram_webhook',
    metadata: { chatId: telegramAddress, userId: telegramAddress }
  });

  assert.equal(result.id, targetId);
  assert.equal(result.upsertState.merged, true);
  assert.equal(result.upsertState.mergedSourceContactId, sourceId);
  assert.deepEqual(result.channels.map((identity) => identity.channel), ['whatsapp_cloud', 'telegram']);
  assert.equal(result.channels.find((identity) => identity.channel === 'telegram').consentStatus, 'granted');
  assert.equal(result.avatarUrl, 'https://cdn.example/whatsapp.jpg');
  assert.equal(result.avatarSource, 'whatsapp_cloud');
  assert.equal(decrypt(target.displayNameEncrypted), 'Samuel cadastrado');
  assert.equal(source.channels.length, 0);
  assert.ok(source.deletedAt instanceof Date);
  assert.deepEqual(target.tags.sort(), ['cliente', 'telegram']);
  assert.ok(referenceUpdates.some((entry) => entry.model === 'Conversation'));
  assert.ok(referenceUpdates.some((entry) => entry.model === 'Notification'));
});
