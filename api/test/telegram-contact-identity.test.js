const test = require('node:test');
const assert = require('node:assert/strict');

const settingsManager = require('../src/managers/settings.manager');
const contactsManager = require('../src/managers/contacts.manager');
const conversationsManager = require('../src/managers/conversations.manager');
const logsManager = require('../src/managers/logs.manager');
const adminNotificationsManager = require('../src/managers/admin-notifications.manager');
const telegramManager = require('../src/managers/telegram.manager');
const profileManager = require('../src/managers/profile.manager');
const socketService = require('../src/services/socket.service');
const chatProfileFlow = require('../src/services/chat-profile-flow.service');
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
const ChatEmailChallenge = require('../src/models/chat-email-challenge.model');
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
    getById: contactsManager.getById,
    update: contactsManager.update,
    record: conversationsManager.recordInbound,
    log: logsManager.create,
    notify: adminNotificationsManager.create,
    emit: socketService.emit,
    fetch: global.fetch,
    directProfileLink: profileManager.createDirectProfileLink,
    publicAppUrl: env.publicAppUrl
  };
  telegramManager.clearIdentityCache();
  chatProfileFlow.resetLocalStateForTests();
  env.publicAppUrl = options.publicAppUrl || 'https://notify.example';
  context.after(() => {
    settingsManager.getValue = originals.getValue;
    contactsManager.findByChannelAddress = originals.find;
    contactsManager.upsertFromChannel = originals.upsert;
    contactsManager.getById = originals.getById;
    contactsManager.update = originals.update;
    conversationsManager.recordInbound = originals.record;
    logsManager.create = originals.log;
    adminNotificationsManager.create = originals.notify;
    socketService.emit = originals.emit;
    global.fetch = originals.fetch;
    profileManager.createDirectProfileLink = originals.directProfileLink;
    env.publicAppUrl = originals.publicAppUrl;
    telegramManager.clearIdentityCache();
    chatProfileFlow.resetLocalStateForTests();
  });
  settingsManager.getValue = async (key) => ({
    TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
    TELEGRAM_BOT_TOKEN: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcd',
    START_NOTIFY_WHATSAPP_PERMISSION: options.notifyCommand || '/notify-me',
    START_VERIFY_TELEGRAM_PERMISSION: options.verifyCommand || '/verify-me',
    TELEGRAM_ONBOARDING_MESSAGE: options.telegramMessages?.onboarding,
    TELEGRAM_PHONE_SHARE_MESSAGE: options.telegramMessages?.phoneShare,
    TELEGRAM_PROFILE_MESSAGE: options.telegramMessages?.profile,
    TELEGRAM_HELP_MESSAGE: options.telegramMessages?.help
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
  contactsManager.getById = async () => options.profileContact || {
    id: '507f1f77bcf86cd799439011',
    displayName: 'Samuel',
    email: 'samuel@example.test',
    phone: '5511999999999',
    telegramUsername: 'samuel_teste',
    channels: [{ channel: 'telegram', authorized: true, consentStatus: 'granted' }]
  };
  contactsManager.update = async () => ({});
  profileManager.createDirectProfileLink = async () => ({
    url: `${env.publicAppUrl.replace(/\/$/, '')}/meu-perfil#acesso=grant-seguro-teste`,
    expiresAt: new Date(Date.now() + 300_000).toISOString()
  });
  let recordedInbound;
  conversationsManager.recordInbound = async (input) => {
    recordedInbound = input;
    return { conversation: { id: '507f1f77bcf86cd799439012' } };
  };
  const logs = [];
  logsManager.create = async (entry) => { logs.push(entry); return entry; };
  adminNotificationsManager.create = async () => ({});
  const socketEvents = [];
  socketService.emit = (event, payload) => { socketEvents.push({ event, payload }); };
  const providerCalls = [];
  global.fetch = options.fetch || (async (_url, request) => {
    providerCalls.push(JSON.parse(request.body));
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 991 } }) };
  });
  return {
    input: () => upsertInput,
    recordedInbound: () => recordedInbound,
    logs,
    providerCalls,
    socketEvents
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

test('primeira mensagem privada cadastra a conversa sem conceder notificacoes', async (context) => {
  const state = stubTelegramInbound(context, {
    contact: {
      id: '507f1f77bcf86cd799439011', displayName: 'Samuel', phone: null,
      upsertState: { created: true, identityAdded: true }
    }
  });

  const result = await telegramManager.webhook(telegramUpdate(2_026_072_299, {
    text: 'Ola, quero conhecer o bot'
  }), 'webhook-secret');

  assert.equal(result.received, true);
  assert.equal(state.input().authorize, false);
  assert.equal(state.input().consentStatus, undefined);
  assert.equal(state.input().consentSource, undefined);
  assert.equal(state.providerCalls.length, 0);
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
  assert.equal(state.providerCalls.length, 3);
  const menu = state.providerCalls.find((payload) => payload.reply_markup?.inline_keyboard);
  const emailPrompt = state.providerCalls.find((payload) => (
    !payload.reply_markup && /cadastrar ou atualizar seu email/i.test(payload.text)
  ));
  const phonePrompt = state.providerCalls.find((payload) => payload.reply_markup?.keyboard);
  assert.equal(menu.chat_id, '445566');
  assert.equal(menu.reply_markup.inline_keyboard.length, 3);
  assert.match(menu.reply_markup.inline_keyboard[0][0].callback_data, /onboarding:phone/);
  assert.match(menu.reply_markup.inline_keyboard[1][0].url, /^https?:\/\/.*\/meu-perfil#acesso=/);
  assert.match(menu.reply_markup.inline_keyboard[2][0].callback_data, /onboarding:help/);
  assert.match(menu.text, /\/login/);
  assert.equal(JSON.stringify(menu).includes('request_contact'), false);
  assert.match(emailPrompt.text, /cadastrar ou atualizar seu email/i);
  assert.equal(phonePrompt.reply_markup.keyboard[0][0].request_contact, true);
});

test('opt-in com email existente ainda solicita o telefone nativo e usa mensagens configuradas', async (context) => {
  const state = stubTelegramInbound(context, {
    existing: { id: '507f1f77bcf86cd799439011' },
    telegramMessages: {
      onboarding: 'Bem-vindo, {name}! Convites:\n{invites}\nUsei {command}.',
      phoneShare: 'Mensagem personalizada para vincular seu telefone.'
    },
    contact: {
      id: '507f1f77bcf86cd799439011',
      displayName: 'Samuel',
      email: 'samuel@example.test',
      phone: null,
      inviteOrigins: [{ title: 'Convite TCC', slug: 'convite-tcc' }],
      upsertState: { created: false, identityAdded: false }
    }
  });

  await telegramManager.webhook(telegramUpdate(2_026_072_214, {
    text: '/notify-me'
  }), 'webhook-secret');

  const menu = state.providerCalls.find((payload) => payload.reply_markup?.inline_keyboard);
  const phonePrompt = state.providerCalls.find((payload) => payload.reply_markup?.keyboard);
  assert.equal(state.providerCalls.some((payload) => /cadastrar ou atualizar seu email/i.test(payload.text)), false);
  assert.match(menu.text, /Bem-vindo, Samuel/);
  assert.match(menu.text, /Convite TCC \(convite-tcc\)/);
  assert.match(menu.text, /\/notify-me/);
  assert.match(menu.text, /\/login/);
  assert.match(menu.text, /Bem Vindo\(a\) Novamente/i);
  assert.match(menu.text, /atualizamos a autoriza/i);
  assert.equal(phonePrompt.text, 'Mensagem personalizada para vincular seu telefone.');
  assert.equal(phonePrompt.reply_markup.keyboard[0][0].request_contact, true);
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
  assert.equal(
    state.providerCalls.find((payload) => payload.reply_markup?.inline_keyboard)
      .reply_markup.inline_keyboard.length,
    3
  );
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
      const payload = JSON.parse(request.body);
      if (payload.reply_markup?.inline_keyboard) menuPayload = payload;
      return { ok: true, json: async () => ({ ok: true, result: { message_id: 992 } }) };
    }
  });

  await telegramManager.webhook(telegramUpdate(2_026_072_209, {
    text: '/notify-me'
  }), 'webhook-secret');

  assert.equal(menuPayload.reply_markup.inline_keyboard.length, 3);
  assert.equal(
    menuPayload.reply_markup.inline_keyboard[1][0].url,
    'https://notify-test.ngrok-free.app/meu-perfil#acesso=grant-seguro-teste'
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
      const payload = JSON.parse(request.body);
      if (payload.reply_markup?.inline_keyboard) menuPayload = payload;
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

test('/meu-perfil responde com os dados do proprio contato e link publico', async (context) => {
  const state = stubTelegramInbound(context, {
    publicAppUrl: 'https://notify.example',
    contact: {
      id: '507f1f77bcf86cd799439011', displayName: 'Samuel', phone: '5511999999999',
      upsertState: { created: false, identityAdded: false }
    },
    profileContact: {
      id: '507f1f77bcf86cd799439011',
      displayName: 'Samuel',
      email: 'samuel@example.test',
      phone: '5511999999999',
      telegramUsername: 'samuel_teste',
      channels: [
        { channel: 'telegram', authorized: true, consentStatus: 'granted' },
        { channel: 'whatsapp_cloud', authorized: false, consentStatus: 'unknown' }
      ]
    }
  });

  await telegramManager.webhook(telegramUpdate(2_026_072_211, {
    text: '/meu-perfil'
  }), 'webhook-secret');

  const response = state.providerCalls.find((payload) => /Seus dados no Notify Flow/.test(payload.text));
  assert.ok(response);
  assert.match(response.text, /samuel@example\.test/);
  assert.match(response.text, /https:\/\/notify\.example\/meu-perfil#acesso=grant-seguro-teste/);
  assert.doesNotMatch(response.text, /507f1f77bcf86cd799439011/);
});

test('/help no Telegram responde com a lista fixa e os comandos dinamicos atuais', async (context) => {
  const state = stubTelegramInbound(context, {
    notifyCommand: '/avisos',
    verifyCommand: '/validar-telegram'
  });

  await telegramManager.webhook(telegramUpdate(2_026_072_219, {
    text: '/help'
  }), 'webhook-secret');

  const response = state.providerCalls.find((payload) => /Ajuda do Notify Flow no Telegram/.test(payload.text || ''));
  assert.ok(response);
  assert.match(response.text, /\/validar-telegram/);
  assert.match(response.text, /\/avisos/);
  assert.match(response.text, /\/login/);
  assert.match(response.text, /\/meu-perfil/);
  assert.match(response.text, /\/cancelar/);
  assert.match(response.text, /\/stop/);
  assert.doesNotMatch(response.text, /payload|chat_id|contactId|user_id|token/i);
});

test('/help com alias privado do bot usa a mesma ajuda segura', async (context) => {
  const state = stubTelegramInbound(context, {
    notifyCommand: '/avisos',
    verifyCommand: '/validar-telegram'
  });

  await telegramManager.webhook(telegramUpdate(2_026_072_220, {
    text: '/help@EjugNotifyBot'
  }), 'webhook-secret');

  const response = state.providerCalls.find((payload) => /Ajuda do Notify Flow no Telegram/.test(payload.text || ''));
  assert.ok(response);
  assert.match(response.text, /\/validar-telegram/);
  assert.match(response.text, /\/help/);
  assert.doesNotMatch(response.text, /payload|chat_id|contactId|user_id|token/i);
});

test('codigo de verificacao de email e redigido do historico e do websocket do Telegram', async (context) => {
  const state = stubTelegramInbound(context);
  const originalSafeInboundText = chatProfileFlow.safeInboundText;
  const originalHandleInbound = chatProfileFlow.handleInbound;
  context.after(() => {
    chatProfileFlow.safeInboundText = originalSafeInboundText;
    chatProfileFlow.handleInbound = originalHandleInbound;
  });
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

  await telegramManager.webhook(telegramUpdate(2_026_072_217, {
    text: '483921'
  }), 'webhook-secret');

  assert.equal(
    state.recordedInbound().body,
    chatProfileFlow.EMAIL_VERIFICATION_CODE_PLACEHOLDER
  );
  const realtime = state.socketEvents.find((entry) => entry.event === 'telegram:message');
  assert.equal(realtime.payload.text, chatProfileFlow.EMAIL_VERIFICATION_CODE_PLACEHOLDER);
  assert.doesNotMatch(JSON.stringify(state.socketEvents), /483921/);
  assert.doesNotMatch(JSON.stringify(state.logs), /483921/);
});

test('/login direto no Telegram emite link temporario e explica como gerar outro acesso', async (context) => {
  const state = stubTelegramInbound(context, {
    publicAppUrl: 'https://notify.example',
    contact: {
      id: '507f1f77bcf86cd799439011',
      displayName: 'Samuel',
      upsertState: { created: false, identityAdded: false }
    }
  });
  let linkRequest;
  profileManager.createDirectProfileLink = async (contactId, options) => {
    linkRequest = { contactId, options };
    return {
      challengeId: 'profile-challenge-safe-id',
      url: 'https://notify.example/meu-perfil#acesso=grant-seguro-teste',
      expiresAt: new Date(Date.now() + 300_000).toISOString()
    };
  };

  await telegramManager.webhook(telegramUpdate(2_026_072_216, {
    text: '/login'
  }), 'webhook-secret');

  assert.deepEqual(linkRequest, {
    contactId: '507f1f77bcf86cd799439011',
    options: { source: 'telegram_login_command' }
  });
  const response = state.providerCalls.find((payload) => /grant-seguro-teste/.test(payload.text || ''));
  assert.ok(response);
  assert.match(response.text, /link temporario/i);
  assert.match(response.text, /envie \/login/i);
  assert.equal(state.recordedInbound().body, '/login');
  assert.doesNotMatch(JSON.stringify(state.logs), /grant-seguro-teste/);
  assert.ok(state.logs.some((entry) => entry.action === 'profile_auth.link_issued'));
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

test('callback Meu perfil emite link pessoal temporario que autentica sem codigo', async (context) => {
  const state = stubTelegramInbound(context, {
    existing: { id: '507f1f77bcf86cd799439011' },
    telegramMessages: {
      profile: 'Seu link pessoal está pronto e só pode ser usado uma vez.'
    }
  });
  const result = await telegramManager.webhook({
    update_id: 2_026_072_215,
    callback_query: {
      id: 'callback-profile-1',
      data: 'notify:onboarding:profile:v1',
      from: { id: 445566, first_name: 'Samuel' },
      message: { message_id: 905, chat: { id: 445566, type: 'private' } }
    }
  }, 'webhook-secret');

  assert.equal(result.callback, 'onboarding_profile');
  const profileMessage = state.providerCalls.find((payload) => payload.reply_markup?.inline_keyboard);
  assert.match(profileMessage.text, /^Seu link pessoal está pronto e só pode ser usado uma vez\./);
  assert.match(profileMessage.text, /\/login/);
  assert.match(
    profileMessage.reply_markup.inline_keyboard[0][0].url,
    /^https:\/\/notify\.example\/meu-perfil#acesso=/
  );
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
  assert.match(state.providerCalls[1].text, /\/login/);
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

test('entrega Telegram prefere o chat_id confirmado pelo webhook ao identificador legado', async (context) => {
  const original = Contact.findById;
  context.after(() => { Contact.findById = original; });
  const contact = new Contact({
    _id: '507f1f77bcf86cd799439031',
    displayNameEncrypted: encrypt('Samuel'),
    displayNameHash: searchHash('samuel'),
    displayNameSource: 'telegram',
    channels: [{
      _id: '507f1f77bcf86cd799439032',
      channel: 'telegram',
      addressEncrypted: encrypt('998877'),
      addressHash: searchHash('998877'),
      authorized: true,
      consentStatus: 'granted',
      source: 'telegram_webhook',
      metadataEncrypted: encrypt({ chatId: '445566', userId: '998877' })
    }],
    channelAvatars: [],
    pendingWhatsappConsents: [],
    tags: [],
    active: true,
    notificationDisabled: false
  });
  Contact.findById = () => ({ select: async () => contact });

  const serialized = contactsManager.serialize(contact);
  assert.equal(serialized.channels[0].address, '998877');
  assert.equal(serialized.channels[0].deliveryAddress, '445566');
  const destination = await contactsManager.getDestination(contact._id, 'telegram');
  assert.equal(destination.address, '445566');
});

test('entrega Telegram rejeita username legado sem chat_id numerico confirmado', async (context) => {
  const original = Contact.findById;
  context.after(() => { Contact.findById = original; });
  const contact = new Contact({
    _id: '507f1f77bcf86cd799439033',
    displayNameEncrypted: encrypt('Contato legado'),
    displayNameHash: searchHash('contato legado'),
    displayNameSource: 'telegram',
    channels: [{
      _id: '507f1f77bcf86cd799439034',
      channel: 'telegram',
      addressEncrypted: encrypt('@usuario_legado'),
      addressHash: searchHash('@usuario_legado'),
      authorized: true,
      consentStatus: 'granted',
      source: 'legacy_import',
      metadataEncrypted: encrypt({})
    }],
    channelAvatars: [],
    pendingWhatsappConsents: [],
    tags: [],
    active: true,
    notificationDisabled: false
  });
  Contact.findById = () => ({ select: async () => contact });

  const serialized = contactsManager.serialize(contact);
  assert.equal(serialized.channels[0].deliveryAddress, null);
  assert.equal(serialized.channels[0].addressUnavailableReason, 'TELEGRAM_CHAT_UNAVAILABLE');
  await assert.rejects(
    contactsManager.getDestination(contact._id, 'telegram'),
    (error) => error.code === 'TELEGRAM_CHAT_UNAVAILABLE'
  );
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
    challenge: ProfileAuthChallenge.updateMany,
    emailChallenge: ChatEmailChallenge.updateMany
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
    ChatEmailChallenge.updateMany = originals.emailChallenge;
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
    Invite, InviteClick, Notification, ProfileAuthChallenge, ChatEmailChallenge
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

test('lista Telegram inclui conversas iniciadas mesmo sem consentimento de notificacao', async (context) => {
  const originalList = contactsManager.list;
  context.after(() => { contactsManager.list = originalList; });
  let filter;
  contactsManager.list = async (input) => {
    filter = input;
    return {
      items: [{
        id: '507f1f77bcf86cd799439091',
        displayName: 'Contato sem opt-in',
        channels: [{
          channel: 'telegram',
          authorized: false,
          consentStatus: 'unknown',
          deliveryAddress: '445566'
        }]
      }],
      page: 1,
      pages: 1,
      total: 1
    };
  };

  const result = await telegramManager.listChats({ page: 1, limit: 20 });

  assert.equal(Object.hasOwn(filter, 'authorized'), false);
  assert.equal(result.items[0].chatId, '445566');
  assert.equal(result.items[0].channels[0].authorized, false);
});
