const settingsManager = require('./settings.manager');
const contactsManager = require('./contacts.manager');
const groupsManager = require('./groups.manager');
const invitesManager = require('./invites.manager');
const logsManager = require('./logs.manager');
const conversationsManager = require('./conversations.manager');
const adminNotificationsManager = require('./admin-notifications.manager');
const socketService = require('../services/socket.service');
const { encrypt, decrypt, timingSafeEqual } = require('../services/crypto.service');
const { getRedis } = require('../services/redis.service');
const { downloadTelegramMedia } = require('../services/safe-media.service');
const chatProfileFlow = require('../services/chat-profile-flow.service');
const {
  telegramDefinitionFromTemplate,
  telegramTemplateBody,
  menuNode,
  renderMenuText,
  buildMenuKeyboard,
  parseCallbackData
} = require('../utils/telegram-templates');
const { env } = require('../config/env');
const { telegramTemplateDefinition } = require('../dtos/templates.dto');
const { normalizeWhatsappE164 } = require('../utils/normalizers');
const crypto = require('node:crypto');
const ApiError = require('../utils/api-error');

const localUpdates = new Set();
let nextSendSlot = 0;
let botIdentityCache = { fingerprint: null, expiresAt: 0, value: null };
let botIdentityProbe = null;
const profilePhotoCache = new Map();
const profilePhotoPending = new Map();
const localMenuSessions = new Map();
const localMediaFileIds = new Map();

const BOT_IDENTITY_TTL_MS = 5 * 60 * 1000;
const BOT_IDENTITY_FAILURE_TTL_MS = 30 * 1000;
const TELEGRAM_ALLOWED_UPDATES = Object.freeze(['message', 'channel_post', 'my_chat_member', 'callback_query']);
const ONBOARDING_PHONE_CALLBACK = 'notify:onboarding:phone:v1';
const ONBOARDING_PROFILE_CALLBACK = 'notify:onboarding:profile:v1';
const ONBOARDING_HELP_CALLBACK = 'notify:onboarding:help:v1';
const PUBLIC_PROFILE_URL_TTL_MS = 5 * 60 * 1000;
let webhookRefreshPromise = null;
let publicProfileUrlCache = { expiresAt: 0, value: null };

async function throttleSend() {
  const now = Date.now();
  const slot = Math.max(now, nextSendSlot);
  nextSendSlot = slot + 36;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

async function token() {
  const value = await settingsManager.getValue('TELEGRAM_BOT_TOKEN');
  if (!value) throw new ApiError(503, 'Telegram nao configurado', null, 'CHANNEL_NOT_CONFIGURED');
  return value;
}

function multipartPayload(payload, attachment) {
  const form = new FormData();
  for (const [key, value] of Object.entries(payload || {})) {
    if (value === undefined || value === null) continue;
    form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  form.append(attachment.field, new Blob([attachment.buffer], { type: attachment.mimeType }), attachment.filename);
  return form;
}

async function call(method, payload = {}, retry = 0, botToken, attachment) {
  if (['sendMessage', 'sendPhoto', 'sendVideo'].includes(method)) await throttleSend();
  const credential = botToken || await token();
  const requestBody = attachment ? multipartPayload(payload, attachment) : JSON.stringify(payload);
  const response = await fetch('https://api.telegram.org/bot' + credential + '/' + method, {
    method: 'POST',
    headers: attachment ? undefined : { 'content-type': 'application/json' },
    body: requestBody,
    signal: AbortSignal.timeout(
      ['getMe', 'getUserProfilePhotos', 'getFile'].includes(method) ? 5_000
        : ['sendPhoto', 'sendVideo'].includes(method) ? 60_000
          : 20_000
    )
  });
  const responseBody = await response.json().catch(() => ({}));
  if (responseBody.error_code === 429 && responseBody.parameters?.retry_after && retry < 1) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(30, responseBody.parameters.retry_after) * 1000));
    return call(method, payload, retry + 1, credential, attachment);
  }
  if (!response.ok || !responseBody.ok) {
    const providerCode = Number(responseBody.error_code || response.status) || null;
    const providerDescription = String(responseBody.description || '').replace(/[\r\n\t]+/g, ' ').replace(/bot\d+:[A-Za-z0-9_-]+/gi, 'bot[redacted]').slice(0, 500);
    let message;
    if ([401, 404].includes(providerCode)) message = 'Token do bot Telegram invalido ou revogado';
    else if (method === 'setWebhook') message = 'Telegram rejeitou o webhook' + (providerDescription ? ': ' + providerDescription : '');
    else message = providerDescription || 'Falha na API do Telegram';
    const error = new ApiError(502, message, {
      providerErrorCode: providerCode,
      retryAfter: responseBody.parameters?.retry_after
    }, 'TELEGRAM_ERROR');
    error.expose = true;
    throw error;
  }
  return responseBody.result;
}

function normalizeBotIdentity(value = {}) {
  const firstName = value.first_name ? String(value.first_name).slice(0, 128) : null;
  const username = value.username ? String(value.username).replace(/^@/, '').slice(0, 64) : null;
  return {
    id: value.id === undefined || value.id === null ? null : String(value.id),
    username,
    firstName,
    displayName: firstName || (username ? '@' + username : 'Bot do Telegram')
  };
}

function clearIdentityCache() {
  botIdentityCache = { fingerprint: null, expiresAt: 0, value: null };
  botIdentityProbe = null;
  publicProfileUrlCache = { expiresAt: 0, value: null };
}

async function probeBotIdentity(options = {}) {
  const credential = await token();
  const fingerprint = crypto.createHash('sha256').update(credential).digest('hex');
  const now = Date.now();
  if (!options.force && botIdentityCache.fingerprint === fingerprint && botIdentityCache.expiresAt > now) {
    return botIdentityCache.value;
  }
  if (botIdentityProbe?.fingerprint === fingerprint) return botIdentityProbe.promise;

  const currentProbe = {
    fingerprint,
    promise: (async () => {
      try {
        const me = await call('getMe', {}, 0, credential);
        return { reachable: true, bot: normalizeBotIdentity(me) };
      } catch (error) {
        return {
          reachable: false,
          error: error instanceof ApiError ? error.message : 'Nao foi possivel consultar a identidade do bot Telegram'
        };
      }
    })()
  };
  botIdentityProbe = currentProbe;
  try {
    const value = await currentProbe.promise;
    if (botIdentityProbe === currentProbe) {
      botIdentityCache = {
        fingerprint,
        expiresAt: Date.now() + (value.reachable ? BOT_IDENTITY_TTL_MS : BOT_IDENTITY_FAILURE_TTL_MS),
        value
      };
    }
    return value;
  } finally {
    if (botIdentityProbe === currentProbe) botIdentityProbe = null;
  }
}

async function claimUpdate(updateId) {
  if (updateId === undefined || updateId === null) return { duplicate: false, release: async () => undefined };
  const key = 'telegram:update:' + updateId;
  const redis = getRedis();
  if (redis) {
    const lockValue = crypto.randomUUID();
    const acquired = await redis.set(key, lockValue, { NX: true, EX: 86_400 });
    return {
      duplicate: acquired !== 'OK',
      release: async () => {
        if (await redis.get(key) === lockValue) await redis.del(key);
      }
    };
  }
  if (localUpdates.has(key)) return { duplicate: true, release: async () => undefined };
  localUpdates.add(key);
  if (localUpdates.size > 10_000) localUpdates.delete(localUpdates.values().next().value);
  return { duplicate: false, release: async () => localUpdates.delete(key) };
}

async function status(options = {}) {
  const configured = await settingsManager.channelConfigured('telegram');
  if (!configured) {
    clearIdentityCache();
    return { configured: false };
  }
  if (!options.probe) {
    const cached = botIdentityCache.expiresAt > Date.now() ? botIdentityCache.value : null;
    return { configured: true, ...(cached || {}) };
  }
  try {
    return { configured: true, ...await probeBotIdentity(options) };
  } catch (error) {
    return { configured: true, reachable: false, error: error.message };
  }
}

async function refreshWebhookRegistration() {
  if (webhookRefreshPromise) return webhookRefreshPromise;
  webhookRefreshPromise = (async () => {
    try {
      if (!await settingsManager.channelConfigured('telegram')) return { refreshed: false, reason: 'not_configured' };
      let webhookUrl;
      try {
        webhookUrl = automaticWebhookUrl();
      } catch (_error) {
        const info = await call('getWebhookInfo');
        if (!info?.url) return { refreshed: false, reason: 'public_url_missing' };
        webhookUrl = normalizeWebhookUrl(info.url);
      }
      const registration = await registerWebhook(webhookUrl);
      await logsManager.create({
        channel: 'telegram',
        action: 'webhook.refreshed',
        message: 'Webhook Telegram atualizado com os tipos de evento atuais',
        context: { allowedUpdates: TELEGRAM_ALLOWED_UPDATES }
      }).catch(() => undefined);
      return { refreshed: registration.registered, url: registration.url };
    } catch (error) {
      await logsManager.create({
        level: 'warn',
        channel: 'telegram',
        action: 'webhook.refresh_failed',
        message: 'Nao foi possivel atualizar o webhook Telegram automaticamente',
        context: { error: error.message }
      }).catch(() => undefined);
      return { refreshed: false, reason: 'refresh_failed' };
    }
  })().finally(() => { webhookRefreshPromise = null; });
  return webhookRefreshPromise;
}

function displayName(user = {}, fallback) {
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || fallback;
}

function messageType(message = {}) {
  return ['text', 'photo', 'video', 'audio', 'voice', 'document', 'sticker', 'animation', 'location', 'contact', 'poll']
    .find((type) => message[type] !== undefined) || 'unknown';
}

function telegramStartPayload(command) {
  const normalized = String(command || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || 'notify-me';
}

function normalizeTelegramCommand(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR');
}

async function telegramPermissionInvocation(text) {
  const normalized = normalizeTelegramCommand(text);
  if (!normalized) return { matched: false, command: null, source: null };
  const [notifyCommand, verifyCommand] = await Promise.all([
    settingsManager.getWhatsappPermissionCommand(),
    settingsManager.getTelegramPermissionCommand()
  ]);
  if (await settingsManager.isWhatsappPermissionCommand(text)) {
    return { matched: true, command: notifyCommand, source: 'configured_notify_command' };
  }
  if (await settingsManager.isTelegramPermissionCommand(text)) {
    return { matched: true, command: verifyCommand, source: 'configured_verify_command' };
  }

  const inviteInvocation = await invitesManager.resolveTelegramInviteInvocation(text);
  if (inviteInvocation) {
    return {
      matched: true,
      command: notifyCommand,
      source: inviteInvocation.source,
      inviteAttributionMarker: inviteInvocation.attributionMarker
    };
  }

  const startMatch = normalized.match(/^\/start(?:@[a-z0-9_]{3,32})?\s+([a-z0-9_-]{1,64})$/i);
  if (!startMatch) return { matched: false, command: notifyCommand, source: null };
  const payload = startMatch[1].toLocaleLowerCase('pt-BR');
  if (payload === telegramStartPayload(notifyCommand).toLocaleLowerCase('pt-BR')) {
    return { matched: true, command: notifyCommand, source: 'configured_notify_deep_link' };
  }
  if (payload === telegramStartPayload(verifyCommand).toLocaleLowerCase('pt-BR')) {
    return { matched: true, command: verifyCommand, source: 'configured_verify_deep_link' };
  }
  return { matched: false, command: notifyCommand, source: null };
}

function profileUrlFromPublicBase(value) {
  try {
    const base = new URL(String(value || ''));
    const hostname = base.hostname.toLowerCase();
    const localHostname = hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname.endsWith('.local')
      || hostname === '127.0.0.1'
      || hostname === '0.0.0.0'
      || hostname === '::1'
      || hostname === '[::1]';
    if (base.protocol !== 'https:' || !hostname || localHostname || base.username || base.password) return null;
    const url = new URL('/meu-perfil', base.origin);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function cachePublicProfileUrlFromWebhook(webhookUrl) {
  const value = profileUrlFromPublicBase(webhookUrl);
  publicProfileUrlCache = {
    expiresAt: Date.now() + PUBLIC_PROFILE_URL_TTL_MS,
    value
  };
  return value;
}

async function publicProfileUrl() {
  const configured = profileUrlFromPublicBase(env.publicAppUrl);
  if (configured) return configured;
  if (publicProfileUrlCache.expiresAt > Date.now()) return publicProfileUrlCache.value;
  try {
    const info = await call('getWebhookInfo');
    return cachePublicProfileUrlFromWebhook(info?.url);
  } catch (_error) {
    publicProfileUrlCache = { expiresAt: Date.now() + 30_000, value: null };
    return null;
  }
}

async function sendOnboardingMenu(chatId, command) {
  const profileUrl = await publicProfileUrl();
  if (!profileUrl) {
    await logsManager.create({
      level: 'warn',
      channel: 'telegram',
      action: 'onboarding.profile_url_unavailable',
      message: 'Menu Telegram enviado sem link direto porque a URL publica do perfil nao esta disponivel',
      context: { chatHashAvailable: true }
    }).catch(() => undefined);
  }
  const result = await call('sendMessage', {
    chat_id: String(chatId),
    text: [
      'Permissão de notificações ativada.',
      '',
      '1. Vincule seu telefone para unir Telegram e WhatsApp no mesmo cadastro.',
      '2. Acesse Meu perfil para consultar seus dados e notificações.',
      '3. Use Ajuda para entender estas opções.',
      '',
      `Comando atual: ${String(command || '/notify-me').slice(0, 80)}`
    ].join('\n'),
    reply_markup: {
      inline_keyboard: [
        [{ text: '1. Vincular meu telefone', callback_data: ONBOARDING_PHONE_CALLBACK }],
        [{
          text: '2. Acessar Meu perfil',
          ...(profileUrl ? { url: profileUrl } : { callback_data: ONBOARDING_PROFILE_CALLBACK })
        }],
        [{ text: '3. Ajuda', callback_data: ONBOARDING_HELP_CALLBACK }]
      ]
    }
  });
  await logsManager.create({
    channel: 'telegram',
    action: 'onboarding.menu_sent',
    message: 'Menu de onboarding Telegram enviado com sucesso',
    context: {
      chatHashAvailable: true,
      messageId: result?.message_id || null,
      profileLinkAvailable: Boolean(profileUrl)
    }
  }).catch(() => undefined);
  return result;
}

async function sendEmailCapturePrompt(chatId, contactId) {
  await chatProfileFlow.beginEmailCapture(contactId, 'telegram');
  try {
    const result = await call('sendMessage', {
      chat_id: String(chatId),
      text: chatProfileFlow.emailCapturePrompt()
    });
    await logsManager.create({
      channel: 'telegram',
      action: 'chat_profile.email_prompt_sent',
      message: 'Pedido opcional de email enviado apos a autorizacao no Telegram',
      context: { contactId, messageId: result?.message_id || null }
    }).catch(() => undefined);
    return result;
  } catch (error) {
    await chatProfileFlow.clearEmailCapture(contactId, 'telegram');
    throw error;
  }
}

function verifiedTelegramContactPhone(message = {}) {
  if (!message.contact) return { provided: false, verified: false, phone: null, reason: null };
  const senderId = message.from?.id === undefined || message.from?.id === null
    ? null
    : String(message.from.id);
  const contactUserId = message.contact.user_id === undefined || message.contact.user_id === null
    ? null
    : String(message.contact.user_id);
  if (!senderId || !contactUserId || senderId !== contactUserId) {
    return { provided: true, verified: false, phone: null, reason: 'CONTACT_OWNER_MISMATCH' };
  }
  const phone = normalizeWhatsappE164(message.contact.phone_number);
  if (!phone) return { provided: true, verified: false, phone: null, reason: 'INVALID_PHONE' };
  return { provided: true, verified: true, phone, reason: null };
}

async function offerOptionalPhoneShare(chatId) {
  return call('sendMessage', {
    chat_id: String(chatId),
    text: 'Se quiser unir este Telegram ao seu cadastro existente, compartilhe seu próprio telefone pelo botão abaixo. Isso é opcional.',
    reply_markup: {
      keyboard: [[{
        text: 'Compartilhar meu telefone (opcional)',
        request_contact: true
      }]],
      resize_keyboard: true,
      one_time_keyboard: true,
      input_field_placeholder: 'Compartilhamento opcional'
    }
  });
}

async function acknowledgePhoneShare(chatId) {
  return call('sendMessage', {
    chat_id: String(chatId),
    text: 'Telefone confirmado e cadastro atualizado com segurança.',
    reply_markup: { remove_keyboard: true }
  });
}

async function rejectPhoneShare(chatId) {
  return call('sendMessage', {
    chat_id: String(chatId),
    text: 'Não foi possível validar esse telefone. Use a opção "Vincular meu telefone" e compartilhe somente o seu próprio número pelo botão oficial do Telegram.',
    reply_markup: { remove_keyboard: true }
  });
}

function optionalAvatarUrl(...candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(String(candidate));
      if (['http:', 'https:'].includes(url.protocol)) return url.toString().slice(0, 2048);
    } catch (_error) { /* avatar opcional */ }
  }
  return null;
}

async function fetchTelegramProfileAvatarUncached(userId) {
  const key = String(userId || '');
  if (!key) return null;
  const cached = profilePhotoCache.get(key);
  if (cached?.expiresAt > Date.now()) return cached.value;
  const credential = await token();
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(credential)) return null;
  const photos = await call('getUserProfilePhotos', { user_id: key, offset: 0, limit: 1 }, 0, credential);
  const sizes = photos?.photos?.[0] || [];
  const smallest = sizes.reduce((selected, photo) => {
    if (!selected) return photo;
    return Number(photo.file_size || photo.width * photo.height || Number.MAX_SAFE_INTEGER)
      < Number(selected.file_size || selected.width * selected.height || Number.MAX_SAFE_INTEGER)
      ? photo
      : selected;
  }, null);
  if (!smallest?.file_id) {
    profilePhotoCache.set(key, { value: null, expiresAt: Date.now() + 60 * 60 * 1000 });
    return null;
  }
  const file = await call('getFile', { file_id: smallest.file_id }, 0, credential);
  if (!file?.file_path) return null;
  const safePath = String(file.file_path).split('/').map(encodeURIComponent).join('/');
  const response = await fetch('https://api.telegram.org/file/bot' + credential + '/' + safePath, {
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) return null;
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > 24_000) return null;
  const contentType = String(response.headers.get('content-type') || 'image/jpeg').toLowerCase();
  if (!contentType.startsWith('image/')) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 24_000) return null;
  const dataUrl = 'data:' + contentType.split(';')[0] + ';base64,' + bytes.toString('base64');
  if (profilePhotoCache.size >= 500) profilePhotoCache.delete(profilePhotoCache.keys().next().value);
  profilePhotoCache.set(key, { value: dataUrl, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
  return dataUrl;
}

async function fetchTelegramProfileAvatar(userId) {
  const key = String(userId || '');
  if (!key) return null;
  if (profilePhotoPending.has(key)) return profilePhotoPending.get(key);
  const pending = fetchTelegramProfileAvatarUncached(key).finally(() => profilePhotoPending.delete(key));
  profilePhotoPending.set(key, pending);
  return pending;
}

function scheduleTelegramAvatarHydration(user = {}, context = {}) {
  if (!user.id || context.avatarUrl) return;
  const task = setImmediate(async () => {
    try {
      const avatarUrl = await fetchTelegramProfileAvatar(user.id);
      if (!avatarUrl) return;
      if (context.contactId) await contactsManager.updateChannelAvatar(context.contactId, 'telegram', avatarUrl);
      if (context.externalId) {
        await conversationsManager.upsertConversation({
          channel: 'telegram',
          externalId: context.externalId,
          contactId: context.contactId,
          groupId: context.groupId,
          displayName: context.displayName,
          avatarUrl,
          isGroup: Boolean(context.isGroup)
        });
      }
    } catch (error) {
      await logsManager.create({
        level: 'warn',
        channel: 'telegram',
        action: 'contact.avatar_hydration_failed',
        message: 'Contato salvo, mas a foto do Telegram nao pode ser atualizada',
        context: { contactId: context.contactId, error: error.message }
      }).catch(() => undefined);
    }
  });
  task.unref?.();
}

async function notifyNewContact(contact, channel, context = {}) {
  await logsManager.create({
    channel,
    action: 'contact.auto_created',
    message: 'Contato criado automaticamente pelo Telegram',
    context: { contactId: contact.id, ...context }
  }).catch(() => undefined);
  await adminNotificationsManager.create({
    kind: 'contact_auto_created',
    channel,
    title: 'Novo contato recebido',
    message: (contact.displayName || 'Um novo contato') + ' foi cadastrado automaticamente pelo ' + (channel === 'telegram' ? 'Telegram' : 'WhatsApp Cloud') + '.',
    contactId: contact.id,
    context
  }).catch(async (error) => {
    await logsManager.create({ level: 'warn', channel, action: 'admin_notification.failed', message: 'Contato criado, mas o aviso administrativo falhou', context: { error: error.message } }).catch(() => undefined);
  });
}

function realtimeMessage(update, message, context = {}) {
  const sender = message.from || message.sender_chat || {};
  const providerDate = new Date(Number(message.date) * 1000);
  const sentAt = Number.isFinite(Number(message.date)) && Number.isFinite(providerDate.getTime())
    ? providerDate.toISOString()
    : new Date().toISOString();
  return {
    updateId: update.update_id,
    messageId: message.message_id === undefined ? null : String(message.message_id),
    chat: {
      id: String(message.chat.id),
      type: message.chat.type,
      title: message.chat.title || message.chat.first_name || null
    },
    from: {
      id: sender.id === undefined ? null : String(sender.id),
      username: sender.username || null,
      displayName: displayName(sender, null)
    },
    contactId: context.contactId ? String(context.contactId) : null,
    groupId: context.groupId ? String(context.groupId) : null,
    type: messageType(message),
    text: message.text || message.caption || (message.contact ? '[Contato compartilhado]' : null),
    sentAt
  };
}

function publishMessage(update, message, context) {
  const event = realtimeMessage(update, message, context);
  const at = new Date().toISOString();
  socketService.emit('telegram:message', event);
  socketService.emit('telegram:chats', { updateId: update.update_id, chatId: event.chat.id, at });
  socketService.emit('telegram:webhook', {
    updateId: update.update_id,
    kind: 'message',
    chatType: event.chat.type,
    contactId: event.contactId,
    groupId: event.groupId,
    at
  });
}

async function verifyWebhookSecret(provided) {
  const expected = await settingsManager.getValue('TELEGRAM_WEBHOOK_SECRET');
  if (!expected) throw new ApiError(503, 'TELEGRAM_WEBHOOK_SECRET nao configurado', null, 'WEBHOOK_SECRET_NOT_CONFIGURED');
  if (!timingSafeEqual(provided, expected)) throw new ApiError(401, 'Assinatura do webhook Telegram invalida');
  return true;
}

function trimLocalCache(cache, max = 1000) {
  while (cache.size > max) cache.delete(cache.keys().next().value);
}

async function storeMenuSession(definition, chatId, contactId) {
  const tokenValue = crypto.randomBytes(12).toString('base64url');
  const session = {
    definition,
    chatId: String(chatId),
    contactId: contactId ? String(contactId) : null,
    expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000
  };
  const redis = getRedis();
  if (redis) await redis.set('telegram:menu:' + tokenValue, encrypt(session), { EX: 90 * 24 * 60 * 60 });
  else {
    localMenuSessions.set(tokenValue, session);
    trimLocalCache(localMenuSessions);
  }
  return tokenValue;
}

async function getMenuSession(tokenValue) {
  const redis = getRedis();
  if (redis) {
    const key = 'telegram:menu:' + tokenValue;
    const raw = await redis.get(key);
    if (!raw) return null;
    try {
      const session = decrypt(raw, { json: true });
      if (session && typeof session === 'object' && session.expiresAt > Date.now()) return session;
    } catch (_error) { /* sessao adulterada ou incompatível */ }
    await redis.del(key).catch(() => undefined);
    return null;
  }
  const session = localMenuSessions.get(tokenValue);
  if (!session || session.expiresAt <= Date.now()) {
    localMenuSessions.delete(tokenValue);
    return null;
  }
  return session;
}

async function answerMenuCallback(queryId, text, showAlert = false) {
  return call('answerCallbackQuery', {
    callback_query_id: queryId,
    ...(text ? { text: String(text).slice(0, 200), show_alert: showAlert } : {})
  });
}

async function handleOnboardingCallback(update, query) {
  const action = query.data === ONBOARDING_PHONE_CALLBACK
    ? 'phone'
    : query.data === ONBOARDING_PROFILE_CALLBACK
      ? 'profile'
      : query.data === ONBOARDING_HELP_CALLBACK ? 'help' : null;
  if (!action) return null;

  const chat = query.message?.chat;
  const chatId = chat?.id === undefined || chat?.id === null ? null : String(chat.id);
  const senderId = query.from?.id === undefined || query.from?.id === null ? null : String(query.from.id);
  if (!chatId || chat?.type !== 'private' || !senderId || senderId !== chatId) {
    await answerMenuCallback(query.id, 'Abra este menu na conversa privada com o bot.', true);
    return { received: true, updateId: update.update_id, callback: 'onboarding_forbidden' };
  }

  if (action === 'phone') {
    await answerMenuCallback(query.id, 'Use o botão abaixo para compartilhar seu próprio telefone.');
    await offerOptionalPhoneShare(chatId);
    await logsManager.create({
      channel: 'telegram',
      action: 'onboarding.phone_requested',
      message: 'Usuario abriu o compartilhamento seguro de telefone no onboarding Telegram',
      context: { chatHashAvailable: true, updateId: update.update_id }
    }).catch(() => undefined);
    return { received: true, updateId: update.update_id, callback: 'onboarding_phone' };
  }

  if (action === 'profile') {
    const profileUrl = await publicProfileUrl();
    if (!profileUrl) {
      await answerMenuCallback(query.id, 'A URL publica do Meu perfil ainda nao esta disponivel. Tente novamente apos configurar o acesso HTTPS.', true);
      return { received: true, updateId: update.update_id, callback: 'onboarding_profile_unavailable' };
    }
    await answerMenuCallback(query.id, 'Link do Meu perfil atualizado.');
    await call('sendMessage', {
      chat_id: chatId,
      text: 'Acesse seu Meu perfil pelo botao abaixo.',
      reply_markup: { inline_keyboard: [[{ text: 'Abrir Meu perfil', url: profileUrl }]] }
    });
    return { received: true, updateId: update.update_id, callback: 'onboarding_profile' };
  }

  await answerMenuCallback(query.id, 'Ajuda aberta.');
  await call('sendMessage', {
    chat_id: chatId,
    text: [
      'Ajuda do Notify App',
      '',
      '1. Vincular meu telefone: abre o botão oficial do Telegram para você compartilhar o seu próprio número. O sistema valida a titularidade e, quando encontra o mesmo telefone no WhatsApp, une os canais em um único contato.',
      '',
      '2. Acessar Meu perfil: abre a página segura onde você pode entrar, revisar seus dados, permissões e histórico de notificações.',
      '',
      'O compartilhamento do telefone é opcional e nunca é aceito quando pertence a outra pessoa.'
    ].join('\n')
  });
  await logsManager.create({
    channel: 'telegram',
    action: 'onboarding.help_opened',
    message: 'Usuario consultou a ajuda do onboarding Telegram',
    context: { chatHashAvailable: true, updateId: update.update_id }
  }).catch(() => undefined);
  return { received: true, updateId: update.update_id, callback: 'onboarding_help' };
}

async function handleMenuCallback(update, query) {
  const parsed = parseCallbackData(query.data);
  if (!parsed) {
    await answerMenuCallback(query.id, 'Este botao nao pertence a um menu valido.', true);
    return { received: true, updateId: update.update_id, callback: 'invalid' };
  }
  const session = await getMenuSession(parsed.token);
  const callbackChatId = query.message?.chat?.id === undefined ? null : String(query.message.chat.id);
  if (!session || !callbackChatId || callbackChatId !== String(session.chatId)) {
    await answerMenuCallback(query.id, 'Este menu expirou. Solicite uma nova mensagem.', true);
    return { received: true, updateId: update.update_id, callback: 'expired' };
  }
  const node = menuNode(session.definition, parsed.nodeId);
  if (!node) {
    await answerMenuCallback(query.id, 'Esta opcao nao esta mais disponivel.', true);
    return { received: true, updateId: update.update_id, callback: 'missing_node' };
  }
  await answerMenuCallback(query.id);
  const payload = {
    chat_id: callbackChatId,
    message_id: query.message.message_id,
    text: renderMenuText(node),
    reply_markup: buildMenuKeyboard(session.definition, node.id, parsed.token)
  };
  try {
    await call('editMessageText', payload);
  } catch (error) {
    if (!/message is not modified/i.test(error.message || '')) throw error;
  }
  await logsManager.create({
    channel: 'telegram',
    action: 'menu.navigate',
    message: 'Usuario navegou em um menu Telegram',
    context: { contactId: session.contactId, nodeId: node.id, updateId: update.update_id }
  }).catch(() => undefined);
  socketService.emit('telegram:webhook', {
    updateId: update.update_id,
    kind: 'menu_callback',
    contactId: session.contactId,
    chatId: callbackChatId,
    at: new Date().toISOString()
  });
  return { received: true, updateId: update.update_id, callback: 'navigated' };
}

function mediaCacheKey(kind, mediaUrl, credential) {
  return crypto.createHash('sha256').update(`${credential}\n${kind}\n${mediaUrl}`).digest('hex');
}

async function cachedMediaFileId(key) {
  const redis = getRedis();
  if (redis) return redis.get('telegram:media:' + key);
  return localMediaFileIds.get(key) || null;
}

async function storeMediaFileId(key, fileId) {
  if (!fileId) return;
  const redis = getRedis();
  if (redis) await redis.set('telegram:media:' + key, fileId, { EX: 30 * 24 * 60 * 60 });
  else {
    localMediaFileIds.set(key, fileId);
    trimLocalCache(localMediaFileIds, 500);
  }
}

async function clearMediaFileId(key) {
  const redis = getRedis();
  if (redis) await redis.del('telegram:media:' + key);
  else localMediaFileIds.delete(key);
}

function telegramResultFileId(kind, result) {
  if (kind === 'video') return result.video?.file_id || null;
  const photos = result.photo || [];
  return photos.length ? photos[photos.length - 1].file_id : null;
}

async function sendMediaMessage({ kind, destination, mediaUrl, caption }) {
  const credential = await token();
  const cacheKey = mediaCacheKey(kind, mediaUrl, credential);
  const field = kind === 'photo' ? 'photo' : 'video';
  const method = kind === 'photo' ? 'sendPhoto' : 'sendVideo';
  const basePayload = { chat_id: destination, ...(caption ? { caption } : {}) };
  const cached = await cachedMediaFileId(cacheKey);
  if (cached) {
    try { return await call(method, { ...basePayload, [field]: cached }, 0, credential); } catch (error) {
      if (error.details?.providerErrorCode !== 400) throw error;
      await clearMediaFileId(cacheKey);
    }
  }
  const media = await downloadTelegramMedia(mediaUrl, kind);
  const result = await call(method, basePayload, 0, credential, {
    field,
    buffer: media.buffer,
    mimeType: media.mimeType,
    filename: media.filename
  });
  await storeMediaFileId(cacheKey, telegramResultFileId(kind, result));
  return result;
}

async function webhook(update, providedSecret) {
  await verifyWebhookSecret(providedSecret);
  const claim = await claimUpdate(update.update_id);
  if (claim.duplicate) return { received: true, duplicate: true, updateId: update.update_id };
  try {
  if (update.callback_query) {
    const onboarding = await handleOnboardingCallback(update, update.callback_query);
    if (onboarding) return onboarding;
    return await handleMenuCallback(update, update.callback_query);
  }
  const message = update.message || update.channel_post;
  const membership = update.my_chat_member;
  if (message?.chat) {
    const chat = message.chat;
    if (chat.type === 'private') {
      const stopped = /^\/stop(?:@\w+)?(?:\s|$)/i.test(message.text || '');
      const started = /^\/start(?:@\w+)?(?:\s|$)/i.test(message.text || '');
      const writeAccessAllowed = Boolean(message.write_access_allowed);
      const permissionInvocation = stopped
        ? { matched: false, command: null, source: null }
        : await telegramPermissionInvocation(message.text || '');
      const existing = await contactsManager.findByChannelAddress('telegram', String(chat.id));
      // Iniciar o bot, compartilhar permissao de escrita ou simplesmente mandar
      // uma mensagem comprova a identidade/conversa, mas nao constitui opt-in
      // para notificacoes. Somente o comando configurado (ou uma alteracao
      // administrativa feita pelo fluxo de consentimento) concede o canal.
      const explicitAuthorization = permissionInvocation.matched;
      const authorize = !stopped && explicitAuthorization;
      const sharedContact = verifiedTelegramContactPhone(message);
      const avatarUser = message.from || chat;
      const avatarUrl = optionalAvatarUrl(message.from?.photo_url, chat.photo_url);
      const contact = await contactsManager.upsertFromChannel({
        channel: 'telegram',
        address: String(chat.id),
        displayName: displayName(message.from || chat, String(chat.id)),
        phone: sharedContact.phone,
        phoneVerified: sharedContact.verified,
        avatarUrl,
        source: writeAccessAllowed ? 'telegram_write_access_allowed' : 'telegram_webhook',
        authorize,
        consentStatus: stopped
          ? 'revoked'
          : explicitAuthorization
            ? 'granted'
            : undefined,
        ...(permissionInvocation.matched ? {
          consentSource: 'automatic_permission_command',
          consentCommand: permissionInvocation.command,
          consentEvidence: {
            provider: 'telegram',
            commandSource: permissionInvocation.source,
            updateId: update.update_id
          }
        } : {}),
        metadata: {
          chatId: String(chat.id),
          userId: message.from?.id === undefined ? String(chat.id) : String(message.from.id),
          username: message.from?.username || chat.username,
          languageCode: message.from?.language_code,
          ...(sharedContact.verified ? {
            phoneSharedByOwner: true,
            phoneVerificationSource: 'telegram_contact_request',
            contactUserId: String(message.contact.user_id)
          } : {}),
          ...(permissionInvocation.matched ? {
            permissionCommandReceived: true,
            permissionCommandReceivedVia: 'telegram',
            permissionCommandSource: permissionInvocation.source
          } : {}),
          autoRegisteredVia: 'telegram'
        }
      });
      const invitationAttribution = permissionInvocation.inviteAttributionMarker
        ? await invitesManager.attributeContactFromMarker(
          contact.id,
          permissionInvocation.inviteAttributionMarker,
          'telegram'
        )
        : null;
      if (!existing && contact.upsertState?.created !== false) {
        await notifyNewContact(contact, 'telegram', { source: 'private_message' });
      }
      if (contact.upsertState?.merged) {
        await logsManager.create({
          channel: 'telegram',
          action: 'contact.identity_merged',
          message: 'Identidade Telegram vinculada ao contato existente por telefone compartilhado pelo proprio usuario',
          context: {
            contactId: contact.id,
            mergedSourceContactId: contact.upsertState.mergedSourceContactId,
            updateId: update.update_id
          }
        }).catch(() => undefined);
      }
      if (sharedContact.provided && !sharedContact.verified) {
        await logsManager.create({
          level: 'warn',
          channel: 'telegram',
          action: 'contact.phone_share_rejected',
          message: 'Telefone compartilhado no Telegram foi ignorado porque nao pertence com seguranca ao remetente',
          context: { contactId: contact.id, reason: sharedContact.reason, updateId: update.update_id }
        }).catch(() => undefined);
      }
      if (message.from?.username || chat.username) {
        await contactsManager.update(contact.id, { telegramUsername: message.from?.username || chat.username });
      }
      await conversationsManager.recordInbound({
        channel: 'telegram',
        externalId: String(chat.id),
        contactId: contact.id,
        displayName: displayName(message.from || chat, String(chat.id)),
        avatarUrl,
        isGroup: false,
        providerMessageId: message.message_id,
        body: permissionInvocation.inviteAttributionMarker
          ? permissionInvocation.command
          : message.text || message.caption || (message.contact ? '[Contato compartilhado]' : ''),
        type: messageType(message),
        hasMedia: Boolean(message.photo || message.video || message.audio || message.voice || message.document || message.sticker || message.animation),
        sentAt: Number(message.date) * 1000,
        metadata: {
          chatId: String(chat.id),
          userId: message.from?.id === undefined ? String(chat.id) : String(message.from.id),
          username: message.from?.username || chat.username || null
        }
      });
      scheduleTelegramAvatarHydration(avatarUser, {
        avatarUrl,
        contactId: contact.id,
        externalId: String(chat.id),
        displayName: displayName(avatarUser, String(chat.id)),
        isGroup: false
      });
      await logsManager.create({ channel: 'telegram', action: 'message.received', message: 'Mensagem recebida em chat privado', context: { contactId: contact.id, updateId: update.update_id } });
      publishMessage(
        update,
        permissionInvocation.inviteAttributionMarker
          ? { ...message, text: permissionInvocation.command }
          : message,
        { contactId: contact.id, inviteAttributed: Boolean(invitationAttribution) }
      );
      let chatProfileHandled = false;
      if (message.text) {
        try {
          const chatResult = await chatProfileFlow.handleInbound({
            contactId: contact.id,
            channel: 'telegram',
            text: message.text,
            profileUrl: await publicProfileUrl()
          });
          chatProfileHandled = chatResult.handled;
          if (chatResult.handled) {
            await call('sendMessage', {
              chat_id: String(chat.id),
              text: chatResult.text
            });
            await logsManager.create({
              channel: 'telegram',
              action: `chat_profile.${chatResult.kind}`,
              message: 'Comando de perfil processado na conversa do Telegram',
              context: { contactId: contact.id, kind: chatResult.kind }
            }).catch(() => undefined);
          }
        } catch (error) {
          await logsManager.create({
            level: 'warn',
            channel: 'telegram',
            action: 'chat_profile.processing_failed',
            message: 'Nao foi possivel processar a atualizacao de perfil recebida pelo Telegram',
            context: { contactId: contact.id, errorCode: error.code || 'CHAT_PROFILE_FAILED' }
          }).catch(() => undefined);
        }
      }
      if (chatProfileHandled) {
        // O comando de perfil ja recebeu uma resposta dedicada.
      } else if (sharedContact.provided && !sharedContact.verified) {
        await rejectPhoneShare(chat.id).catch(async (error) => {
          await logsManager.create({
            level: 'warn', channel: 'telegram', action: 'contact.phone_rejection_notice_failed',
            message: 'Telefone invalido foi rejeitado, mas o Telegram nao exibiu a orientacao',
            context: { contactId: contact.id, error: error.message }
          }).catch(() => undefined);
        });
      } else if (sharedContact.verified) {
        await acknowledgePhoneShare(chat.id).catch(async (error) => {
          await logsManager.create({
            level: 'warn', channel: 'telegram', action: 'contact.phone_ack_failed',
            message: 'Telefone foi vinculado, mas o Telegram nao exibiu a confirmacao',
            context: { contactId: contact.id, error: error.message }
          }).catch(() => undefined);
        });
      } else if (permissionInvocation.matched) {
        await sendOnboardingMenu(chat.id, permissionInvocation.command).catch(async (error) => {
          await logsManager.create({
            level: 'warn', channel: 'telegram', action: 'onboarding.menu_send_failed',
            message: 'Contato autorizado, mas o bot nao conseguiu exibir o menu de onboarding',
            context: { contactId: contact.id, phase: 'onboarding_menu', error: error.message }
          }).catch(() => undefined);
        });
        await sendEmailCapturePrompt(chat.id, contact.id).catch(async (error) => {
          await logsManager.create({
            level: 'warn',
            channel: 'telegram',
            action: 'chat_profile.email_prompt_failed',
            message: 'Permissao recebida, mas o pedido opcional de email nao foi entregue',
            context: { contactId: contact.id, errorCode: error.code || 'CHAT_PROFILE_PROMPT_FAILED' }
          }).catch(() => undefined);
        });
      } else if ((started || writeAccessAllowed) && !contact.phone) {
        await offerOptionalPhoneShare(chat.id).catch(async (error) => {
          await logsManager.create({
            level: 'warn', channel: 'telegram', action: 'contact.phone_request_failed',
            message: 'Contato autorizado, mas o bot nao conseguiu oferecer o compartilhamento opcional de telefone',
            context: { contactId: contact.id, error: error.message }
          }).catch(() => undefined);
        });
      }
    } else {
      const group = await groupsManager.findByExternalId('telegram', String(chat.id));
      let contact;
      if (group && message.from && !message.from.is_bot) {
        const existingContact = await contactsManager.findByChannelAddress('telegram', String(message.from.id));
        const avatarUrl = optionalAvatarUrl(message.from.photo_url);
        contact = await contactsManager.upsertFromChannel({
          channel: 'telegram', address: String(message.from.id), displayName: displayName(message.from, String(message.from.id)),
          avatarUrl,
          source: 'telegram_group', metadata: {
            chatId: String(message.from.id),
            userId: String(message.from.id),
            username: message.from.username,
            groupChatId: String(chat.id),
            autoRegisteredVia: 'telegram'
          },
          authorize: false, consentStatus: 'unknown'
        });
        if (!existingContact) await notifyNewContact(contact, 'telegram', { source: 'group_message', groupId: group.id });
        await groupsManager.addContacts(group.id, [contact.id]);
        scheduleTelegramAvatarHydration(message.from, { avatarUrl, contactId: contact.id });
      }
      await conversationsManager.recordInbound({
        channel: 'telegram',
        externalId: String(chat.id),
        contactId: contact?.id,
        groupId: group?.id,
        displayName: chat.title || chat.first_name || String(chat.id),
        avatarUrl: optionalAvatarUrl(chat.photo_url),
        isGroup: true,
        providerMessageId: message.message_id,
        body: message.text || message.caption || '',
        type: messageType(message),
        hasMedia: Boolean(message.photo || message.video || message.audio || message.voice || message.document || message.sticker || message.animation),
        sentAt: Number(message.date) * 1000,
        metadata: {
          senderId: message.from?.id === undefined ? null : String(message.from.id),
          senderUsername: message.from?.username || null,
          senderDisplayName: displayName(message.from || message.sender_chat || {}, null)
        }
      });
      await logsManager.create({ channel: 'telegram', action: 'group.seen', message: 'Mensagem observada em grupo Telegram cadastrado', context: { groupId: group?.id, updateId: update.update_id } });
      publishMessage(update, message, { contactId: contact?.id, groupId: group?.id });
    }
  } else if (membership?.chat && ['group', 'supergroup', 'channel'].includes(membership.chat.type)) {
    const membershipStatus = membership.new_chat_member?.status;
    if (['kicked', 'left'].includes(membershipStatus)) {
      await groupsManager.setExternalActive('telegram', String(membership.chat.id), false);
    } else {
      await groupsManager.upsertExternal({ name: membership.chat.title || String(membership.chat.id), source: 'telegram', externalId: String(membership.chat.id) });
    }
  } else if (membership?.chat?.type === 'private' && ['kicked', 'left'].includes(membership.new_chat_member?.status)) {
    await contactsManager.setConsentByAddress('telegram', String(membership.chat.id), 'revoked');
  }
  return { received: true, updateId: update.update_id };
  } catch (error) {
    await claim.release();
    throw error;
  }
}

async function send(input) {
  if (input.contactId && input.groupId) throw new ApiError(422, 'Informe contato ou grupo Telegram, nao ambos');
  let contactId = input.contactId;
  let destination;
  if (contactId) {
    destination = (await contactsManager.getDestination(contactId, 'telegram')).address;
  } else if (input.groupId) {
    const group = await groupsManager.getById(input.groupId);
    if (group.source !== 'telegram' || !group.active || group.notificationDisabled) throw new ApiError(409, 'Grupo Telegram indisponivel');
    destination = group.externalId;
  } else {
    destination = input.destination;
  }
  if (destination && !contactId && !input.groupId && !input.allowUnconsented) {
    const knownContact = await contactsManager.findByChannelAddress('telegram', destination);
    if (knownContact) {
      contactId = knownContact.id;
      destination = (await contactsManager.getDestination(contactId, 'telegram')).address;
    } else {
      const knownGroup = await groupsManager.findByExternalId('telegram', destination);
      if (!knownGroup) throw new ApiError(403, 'Destino Telegram nao cadastrado/autorizado', null, 'UNKNOWN_DESTINATION');
      destination = knownGroup.externalId;
    }
  }
  if (!destination) throw new ApiError(422, 'Destino Telegram obrigatorio');
  const rawDefinition = input.telegram || input.payload?.telegram;
  const parsedDefinition = rawDefinition ? telegramTemplateDefinition.safeParse(rawDefinition) : null;
  if (parsedDefinition && !parsedDefinition.success) {
    throw new ApiError(422, 'Definicao do template Telegram invalida', {
      fields: parsedDefinition.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
    }, 'TELEGRAM_TEMPLATE_INVALID');
  }
  const definition = parsedDefinition?.data;
  const safeOptions = Object.fromEntries(Object.entries(input.payload || {}).filter(([key]) => (
    ['disable_notification', 'protect_content', 'message_thread_id'].includes(key)
  )));
  let payload;
  let deliveryType = definition?.kind || 'text';
  let historyBody = '';
  let result;
  try {
    if (!definition || definition.kind === 'text') {
      const text = String(definition?.text || input.text || input.body || '');
      if (!text) throw new ApiError(422, 'Texto Telegram obrigatorio');
      if (text.length > 4096) throw new ApiError(422, 'Texto Telegram excede 4096 caracteres');
      payload = {
        chat_id: destination,
        text,
        ...(definition?.disableLinkPreview ? { link_preview_options: { is_disabled: true } } : {}),
        ...safeOptions
      };
      historyBody = text;
      result = await call('sendMessage', payload);
    } else if (['photo', 'video'].includes(definition.kind)) {
      const caption = String(definition.caption || '');
      if (caption.length > 1024) throw new ApiError(422, 'Legenda Telegram excede 1024 caracteres');
      historyBody = caption || (definition.kind === 'photo' ? '[Imagem]' : '[Video]');
      result = await sendMediaMessage({
        kind: definition.kind,
        destination,
        mediaUrl: definition.mediaUrl,
        caption
      });
    } else if (definition.kind === 'menu') {
      const root = menuNode(definition, definition.rootNodeId);
      if (!root) throw new ApiError(422, 'Pagina inicial do menu Telegram nao encontrada', null, 'TELEGRAM_MENU_INVALID');
      const text = renderMenuText(root);
      if (!text || text.length > 4096) throw new ApiError(422, 'Conteudo da pagina inicial do menu Telegram invalido');
      const menuToken = await storeMenuSession(definition, destination, contactId);
      payload = {
        chat_id: destination,
        text,
        reply_markup: buildMenuKeyboard(definition, root.id, menuToken),
        ...safeOptions
      };
      historyBody = text;
      result = await call('sendMessage', payload);
    } else {
      throw new ApiError(422, 'Tipo de template Telegram invalido', null, 'TELEGRAM_TEMPLATE_INVALID');
    }
  } catch (error) {
    if (error.details?.providerErrorCode === 403) await contactsManager.setConsentByAddress('telegram', destination, 'revoked');
    throw error;
  }
  if (input.useCase !== 'profile_auth') {
    await logsManager.create({
      channel: 'telegram',
      action: 'message.sent',
      message: 'Mensagem Telegram enviada',
      context: {
        contactId,
        notificationId: input.notificationId,
        deliveryId: input.deliveryId,
        chatHashAvailable: true,
        messageId: result.message_id
      }
    }).catch(() => undefined);
    try {
      await conversationsManager.recordOutbound({
        channel: 'telegram',
        externalId: String(result.chat.id),
        contactId,
        groupId: input.groupId,
        displayName: result.chat.title || [result.chat.first_name, result.chat.last_name].filter(Boolean).join(' ') || String(result.chat.id),
        isGroup: ['group', 'supergroup', 'channel'].includes(result.chat.type),
        providerMessageId: result.message_id,
        body: historyBody,
        type: deliveryType,
        hasMedia: ['photo', 'video'].includes(deliveryType),
        sentAt: Number(result.date) * 1000
      });
    } catch (error) {
      await logsManager.create({ level: 'warn', channel: 'telegram', action: 'conversation.store_failed', message: 'Mensagem enviada, mas o historico local nao foi atualizado', context: { error: error.message } }).catch(() => undefined);
    }
  }
  if (input.useCase === 'profile_auth') return { delivered: true };
  return { providerMessageId: String(result.message_id), chatId: String(result.chat.id), raw: result };
}

async function listChats(query = {}) {
  const result = await contactsManager.list({ ...query, channel: 'telegram', active: true });
  return {
    ...result,
    items: result.items.map((contact) => {
      const identity = contact.channels.find((item) => item.channel === 'telegram');
      return { ...contact, chatId: identity?.deliveryAddress || null };
    })
  };
}

async function sync() {
  let page = 1;
  let contactsSynced = 0;
  let contactPage;
  do {
    contactPage = await contactsManager.list({ channel: 'telegram', active: true, page, limit: 100 });
    for (const contact of contactPage.items) {
      const identity = contact.channels.find((item) => item.channel === 'telegram');
      if (!identity?.deliveryAddress) continue;
      await conversationsManager.upsertConversation({
        channel: 'telegram', externalId: identity.deliveryAddress, contactId: contact.id,
        displayName: contact.displayName, avatarUrl: contact.avatarUrl, isGroup: false
      });
      contactsSynced += 1;
    }
    page += 1;
  } while (page <= contactPage.pages);

  page = 1;
  let groupsSynced = 0;
  let groupPage;
  do {
    groupPage = await groupsManager.list({ source: 'telegram', page, limit: 100 });
    for (const group of groupPage.items) {
      if (!group.externalId) continue;
      await conversationsManager.upsertConversation({
        channel: 'telegram', externalId: group.externalId, groupId: group.id,
        displayName: group.name, avatarUrl: group.imageUrl, isGroup: true
      });
      groupsSynced += 1;
    }
    page += 1;
  } while (page <= groupPage.pages);

  return { chats: contactsSynced, groups: groupsSynced, note: 'A Bot API sincroniza interacoes ja conhecidas por updates/webhook e nao enumera membros arbitrariamente.' };
}

async function listGroups(query = {}) {
  return groupsManager.list({ ...query, source: 'telegram' });
}

async function createGroup(input) {
  return groupsManager.create({ ...input, source: 'telegram', externalId: input.chatId, contactIds: input.contactIds || [] }, { providerManaged: true });
}

async function updateGroup(id, input) {
  const current = await groupsManager.getById(id);
  if (current.source !== 'telegram') throw new ApiError(409, 'Grupo nao pertence ao Telegram');
  const values = { ...input };
  if (input.chatId !== undefined) values.externalId = input.chatId;
  delete values.chatId;
  values.source = 'telegram';
  return groupsManager.update(id, values, { providerManaged: true });
}

async function removeGroup(id) {
  const current = await groupsManager.getById(id);
  if (current.source !== 'telegram') throw new ApiError(409, 'Grupo nao pertence ao Telegram');
  return groupsManager.remove(id);
}

async function sendFromContract(input) {
  let content = { text: input.message };
  if (input.mode === 'template') {
    const templatesManager = require('./templates.manager');
    const template = await templatesManager.getById(input.templateId);
    if (template.channel !== 'telegram') throw new ApiError(422, 'Template nao pertence ao Telegram');
    if (template.active === false) throw new ApiError(422, 'Template Telegram inativo');
    const definition = telegramDefinitionFromTemplate(template);
    content = {
      text: telegramTemplateBody(definition),
      payload: { telegram: definition }
    };
  }
  return send({ contactId: input.contactId, groupId: input.groupId, ...content });
}

function normalizeWebhookUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new ApiError(422, 'O webhook do Telegram deve usar HTTPS', null, 'HTTPS_WEBHOOK_REQUIRED');
  if (!url.pathname || url.pathname === '/') {
    url.pathname = env.apiPrefix.replace(/\/$/, '') + '/webhooks/telegram';
  }
  url.hash = '';
  return url.toString();
}

function automaticWebhookUrl() {
  let publicUrl;
  try {
    publicUrl = new URL(String(env.publicAppUrl || ''));
  } catch (_error) {
    throw new ApiError(409, 'Configure PUBLIC_APP_URL com o dominio HTTPS publico para ativar o webhook automatico do Telegram', null, 'PUBLIC_APP_URL_REQUIRED');
  }
  const hostname = publicUrl.hostname.toLowerCase();
  const localHost = hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '0.0.0.0'
    || hostname === '::1'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local');
  if (publicUrl.protocol !== 'https:' || localHost || publicUrl.username || publicUrl.password) {
    throw new ApiError(409, 'Configure PUBLIC_APP_URL com o dominio HTTPS publico para ativar o webhook automatico do Telegram', null, 'PUBLIC_APP_URL_REQUIRED');
  }
  publicUrl.pathname = env.apiPrefix.replace(/\/$/, '') + '/webhooks/telegram';
  publicUrl.search = '';
  publicUrl.hash = '';
  return normalizeWebhookUrl(publicUrl.toString());
}

async function registerWebhook(url, actorId) {
  const webhookUrl = normalizeWebhookUrl(url);
  let secret = await settingsManager.getValue('TELEGRAM_WEBHOOK_SECRET');
  let webhookSecretGenerated = false;
  if (!secret) {
    secret = crypto.randomBytes(32).toString('base64url');
    await settingsManager.setValue('TELEGRAM_WEBHOOK_SECRET', secret, actorId);
    webhookSecretGenerated = true;
  }
  const result = await call('setWebhook', { url: webhookUrl, secret_token: secret, allowed_updates: TELEGRAM_ALLOWED_UPDATES });
  cachePublicProfileUrlFromWebhook(webhookUrl);
  return { registered: Boolean(result), url: webhookUrl, webhookSecretGenerated };
}

module.exports = {
  status,
  clearIdentityCache,
  webhook,
  send,
  sendFromContract,
  registerWebhook,
  refreshWebhookRegistration,
  normalizeWebhookUrl,
  automaticWebhookUrl,
  listChats,
  sync,
  listGroups,
  createGroup,
  updateGroup,
  removeGroup,
  fetchTelegramProfileAvatar
};
