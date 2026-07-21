const settingsManager = require('./settings.manager');
const contactsManager = require('./contacts.manager');
const groupsManager = require('./groups.manager');
const logsManager = require('./logs.manager');
const socketService = require('../services/socket.service');
const { timingSafeEqual } = require('../services/crypto.service');
const { getRedis } = require('../services/redis.service');
const { env } = require('../config/env');
const crypto = require('node:crypto');
const ApiError = require('../utils/api-error');

const localUpdates = new Set();
let nextSendSlot = 0;
let botIdentityCache = { fingerprint: null, expiresAt: 0, value: null };
let botIdentityProbe = null;

const BOT_IDENTITY_TTL_MS = 5 * 60 * 1000;
const BOT_IDENTITY_FAILURE_TTL_MS = 30 * 1000;

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

async function call(method, payload = {}, retry = 0, botToken) {
  if (method === 'sendMessage') await throttleSend();
  const credential = botToken || await token();
  const response = await fetch('https://api.telegram.org/bot' + credential + '/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(method === 'getMe' ? 5_000 : 20_000)
  });
  const body = await response.json().catch(() => ({}));
  if (body.error_code === 429 && body.parameters?.retry_after && retry < 1) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(30, body.parameters.retry_after) * 1000));
    return call(method, payload, retry + 1, credential);
  }
  if (!response.ok || !body.ok) {
    const providerCode = Number(body.error_code || response.status) || null;
    const providerDescription = String(body.description || '').replace(/[\r\n\t]+/g, ' ').replace(/bot\d+:[A-Za-z0-9_-]+/gi, 'bot[redacted]').slice(0, 500);
    let message;
    if ([401, 404].includes(providerCode)) message = 'Token do bot Telegram invalido ou revogado';
    else if (method === 'setWebhook') message = 'Telegram rejeitou o webhook' + (providerDescription ? ': ' + providerDescription : '');
    else message = providerDescription || 'Falha na API do Telegram';
    const error = new ApiError(502, message, {
      providerErrorCode: providerCode,
      retryAfter: body.parameters?.retry_after
    }, 'TELEGRAM_ERROR');
    error.expose = true;
    throw error;
  }
  return body.result;
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

function displayName(user = {}, fallback) {
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || fallback;
}

function messageType(message = {}) {
  return ['text', 'photo', 'video', 'audio', 'voice', 'document', 'sticker', 'animation', 'location', 'contact', 'poll']
    .find((type) => message[type] !== undefined) || 'unknown';
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
    text: message.text || message.caption || null,
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

async function webhook(update, providedSecret) {
  await verifyWebhookSecret(providedSecret);
  const claim = await claimUpdate(update.update_id);
  if (claim.duplicate) return { received: true, duplicate: true, updateId: update.update_id };
  try {
  const message = update.message || update.channel_post;
  const membership = update.my_chat_member;
  if (message?.chat) {
    const chat = message.chat;
    if (chat.type === 'private') {
      const stopped = /^\/stop(?:@\w+)?(?:\s|$)/i.test(message.text || '');
      const started = /^\/start(?:@\w+)?(?:\s|$)/i.test(message.text || '');
      const writeAccessAllowed = Boolean(message.write_access_allowed);
      const existing = await contactsManager.findByChannelAddress('telegram', String(chat.id));
      const wasBlocked = existing?.channels.some((identity) => identity.channel === 'telegram' && ['revoked', 'denied'].includes(identity.consentStatus));
      const explicitAuthorization = started || writeAccessAllowed;
      const authorize = !stopped && (!wasBlocked || explicitAuthorization);
      const contact = await contactsManager.upsertFromChannel({
        channel: 'telegram',
        address: String(chat.id),
        displayName: displayName(message.from || chat, String(chat.id)),
        source: writeAccessAllowed ? 'telegram_write_access_allowed' : 'telegram_webhook',
        authorize,
        consentStatus: stopped || wasBlocked && !explicitAuthorization ? 'revoked' : 'granted',
        metadata: { username: message.from?.username || chat.username, languageCode: message.from?.language_code }
      });
      if (message.from?.username || chat.username) {
        await contactsManager.update(contact.id, { telegramUsername: message.from?.username || chat.username });
      }
      if (stopped) await contactsManager.setChannelConsent(contact.id, 'telegram', 'revoked');
      await logsManager.create({ channel: 'telegram', action: 'message.received', message: 'Mensagem recebida em chat privado', context: { contactId: contact.id, updateId: update.update_id } });
      publishMessage(update, message, { contactId: contact.id });
    } else {
      const group = await groupsManager.findByExternalId('telegram', String(chat.id));
      let contact;
      if (group && message.from && !message.from.is_bot) {
        contact = await contactsManager.upsertFromChannel({
          channel: 'telegram', address: String(message.from.id), displayName: displayName(message.from, String(message.from.id)),
          source: 'telegram_group', metadata: { username: message.from.username, groupChatId: String(chat.id) },
          authorize: false, consentStatus: 'unknown'
        });
        await groupsManager.addContacts(group.id, [contact.id]);
      }
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
  let destination = input.destination;
  let contactId = input.contactId;
  if (!destination && contactId) destination = (await contactsManager.getDestination(contactId, 'telegram')).address;
  if (!destination && input.groupId) {
    const group = await groupsManager.getById(input.groupId);
    if (group.source !== 'telegram' || !group.active || group.notificationDisabled) throw new ApiError(409, 'Grupo Telegram indisponivel');
    destination = group.externalId;
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
  const allowedPayloadKeys = ['text', 'parse_mode', 'entities', 'link_preview_options', 'disable_notification', 'protect_content', 'reply_parameters', 'reply_markup', 'message_thread_id'];
  const sourcePayload = { text: input.text, parse_mode: input.parseMode, ...(input.payload || {}) };
  sourcePayload.text ||= input.text || input.body;
  const payload = Object.fromEntries(Object.entries(sourcePayload).filter(([key]) => allowedPayloadKeys.includes(key)));
  payload.chat_id = destination;
  if (!payload.text) throw new ApiError(422, 'Texto Telegram obrigatorio');
  if (String(payload.text).length > 4096) throw new ApiError(422, 'Texto Telegram excede 4096 caracteres');
  let result;
  try {
    result = await call('sendMessage', payload);
  } catch (error) {
    if (error.details?.providerErrorCode === 403) await contactsManager.setConsentByAddress('telegram', destination, 'revoked');
    throw error;
  }
  await logsManager.create({ channel: 'telegram', action: 'message.sent', message: 'Mensagem Telegram enviada', context: { contactId, chatHashAvailable: true, messageId: result.message_id } });
  return { providerMessageId: String(result.message_id), chatId: String(result.chat.id), raw: result };
}

async function listChats(query = {}) {
  const result = await contactsManager.list({ ...query, channel: 'telegram', authorized: true, active: true });
  return {
    ...result,
    items: result.items.map((contact) => ({
      ...contact,
      chatId: contact.channels.find((identity) => identity.channel === 'telegram' && identity.authorized)?.address
    }))
  };
}

async function sync() {
  const [chats, groups] = await Promise.all([
    contactsManager.list({ channel: 'telegram', page: 1, limit: 1 }),
    groupsManager.list({ source: 'telegram', page: 1, limit: 1 })
  ]);
  return { chats: chats.total, groups: groups.total, note: 'A Bot API sincroniza por updates/webhook e nao enumera membros arbitrariamente.' };
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
    content = {
      text: template.body,
      payload: template.payload ? { ...template.payload, text: template.payload.text || template.body } : undefined
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

async function registerWebhook(url, actorId) {
  const webhookUrl = normalizeWebhookUrl(url);
  let secret = await settingsManager.getValue('TELEGRAM_WEBHOOK_SECRET');
  let webhookSecretGenerated = false;
  if (!secret) {
    secret = crypto.randomBytes(32).toString('base64url');
    await settingsManager.setValue('TELEGRAM_WEBHOOK_SECRET', secret, actorId);
    webhookSecretGenerated = true;
  }
  const result = await call('setWebhook', { url: webhookUrl, secret_token: secret, allowed_updates: ['message', 'my_chat_member'] });
  return { registered: Boolean(result), url: webhookUrl, webhookSecretGenerated };
}

module.exports = { status, clearIdentityCache, webhook, send, sendFromContract, registerWebhook, normalizeWebhookUrl, listChats, sync, listGroups, createGroup, updateGroup, removeGroup };
