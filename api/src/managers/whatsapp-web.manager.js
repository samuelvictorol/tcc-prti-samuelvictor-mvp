const webService = require('../services/whatsapp-web.service');
const settingsManager = require('./settings.manager');
const contactsManager = require('./contacts.manager');
const groupsManager = require('./groups.manager');
const logsManager = require('./logs.manager');
const { env } = require('../config/env');
const { emit } = require('../services/socket.service');
const ApiError = require('../utils/api-error');

let initialized = false;

async function sessionMaxAgeDays() {
  const configured = await settingsManager.getValue('WHATSAPP_WEB_SESSION_MAX_AGE_DAYS');
  return Math.max(1, Number(configured || env.whatsappWebSessionMaxAgeDays));
}

async function authenticatedAt() {
  const value = await settingsManager.getValue('WHATSAPP_WEB_AUTHENTICATED_AT');
  return value ? new Date(value) : null;
}

async function expiry() {
  const started = await authenticatedAt();
  if (!started || Number.isNaN(started.getTime())) return null;
  return new Date(started.getTime() + await sessionMaxAgeDays() * 86_400_000);
}

async function ensureNotExpired() {
  const expiresAt = await expiry();
  if (expiresAt && expiresAt <= new Date()) {
    await logout();
    throw new ApiError(401, 'Sessao WhatsApp Web expirou e requer novo QR Code', null, 'WHATSAPP_WEB_SESSION_EXPIRED');
  }
  return expiresAt;
}

async function initialize() {
  await ensureNotExpired().catch((error) => {
    if (error.code !== 'WHATSAPP_WEB_SESSION_EXPIRED') throw error;
  });
  const result = await webService.initialize({
    onAuthenticated: async () => {
      await settingsManager.setValue('WHATSAPP_WEB_AUTHENTICATED_AT', new Date().toISOString(), null, { internal: true });
      await logsManager.create({ channel: 'whatsapp_web', action: 'authenticated', message: 'WhatsApp Web autenticado' });
    },
    onReady: () => logsManager.create({ channel: 'whatsapp_web', action: 'ready', message: 'WhatsApp Web pronto' }),
    onAuthFailure: (message) => logsManager.create({ level: 'error', channel: 'whatsapp_web', action: 'auth_failure', message: 'Falha de autenticacao WhatsApp Web', context: { reason: message } }),
    onDisconnected: (reason) => logsManager.create({ level: 'warn', channel: 'whatsapp_web', action: 'disconnected', message: 'WhatsApp Web desconectado', context: { reason } }),
    onError: (error) => logsManager.create({ level: 'error', channel: 'whatsapp_web', action: 'error', message: 'Erro WhatsApp Web', context: { error: error.message } }),
    onMessage: processIncoming
  });
  initialized = true;
  return result;
}

async function processIncoming(message) {
  if (message.fromMe || message.from === 'status@broadcast') return;
  const chat = await message.getChat();
  const contactData = await message.getContact();
  let entityId;
  if (chat.isGroup) {
    const group = await groupsManager.upsertExternal({ name: chat.name || chat.id._serialized, source: 'whatsapp_web', externalId: chat.id._serialized });
    entityId = group.id;
    if (contactData?.id?._serialized) {
      const contact = await contactsManager.upsertFromChannel({
        channel: 'whatsapp_web', address: contactData.id._serialized,
        displayName: contactData.pushname || contactData.name || contactData.number,
        source: 'whatsapp_web_group', metadata: { groupChatId: chat.id._serialized },
        authorize: false, consentStatus: 'unknown'
      });
      await groupsManager.addContacts(group.id, [contact.id]);
    }
  } else {
    const contact = await contactsManager.upsertFromChannel({
      channel: 'whatsapp_web', address: message.from,
      displayName: contactData.pushname || contactData.name || contactData.number || message.from,
      source: 'whatsapp_web_message'
    });
    entityId = contact.id;
  }
  emit('whatsapp_web:message', {
    id: message.id?._serialized,
    chatId: chat.id._serialized,
    entityId,
    isGroup: chat.isGroup,
    fromMe: false,
    body: String(message.body || '').slice(0, 2000),
    type: message.type,
    timestamp: message.timestamp
  });
  await logsManager.create({ channel: 'whatsapp_web', action: 'message.received', message: 'Mensagem WhatsApp Web recebida', context: { messageId: message.id?._serialized, isGroup: chat.isGroup } });
}

async function status() {
  const state = webService.snapshot();
  const expiresAt = await expiry();
  return { configured: true, initialized: initialized || state.initialized, ready: state.ready, state: state.state, qrCode: state.qrCode, expiresAt };
}

async function chats(limit) {
  await ensureNotExpired();
  return webService.listChats(limit);
}

async function assertKnownChat(chatId) {
  const contact = await contactsManager.findByChannelAddress('whatsapp_web', chatId);
  if (contact) return { type: 'contact', value: contact };
  const group = await groupsManager.findByExternalId('whatsapp_web', chatId);
  if (group) return { type: 'group', value: group };
  const chat = await webService.getChatSummary(chatId);
  if (!chat || chat.id !== chatId) throw new ApiError(403, 'Chat nao pertence a sessao autenticada', null, 'UNKNOWN_CHAT');
  if (chat.isGroup) {
    return { type: 'group', value: await groupsManager.upsertExternal({ name: chat.name, source: 'whatsapp_web', externalId: chat.id, imageUrl: chat.imageUrl }) };
  }
  return {
    type: 'contact',
    value: await contactsManager.upsertFromChannel({
      channel: 'whatsapp_web', address: chat.id, displayName: chat.name || chat.phone,
      avatarUrl: chat.imageUrl, source: 'whatsapp_web_chat_open', authorize: false, consentStatus: 'unknown'
    })
  };
}

async function messages(chatId, limit) {
  await ensureNotExpired();
  await assertKnownChat(chatId);
  return webService.getMessages(chatId, limit);
}

async function createGroupFromChats(input) {
  const contactIds = [];
  for (const chatId of [...new Set(input.chatIds)]) {
    let contact = await contactsManager.findByChannelAddress('whatsapp_web', chatId);
    if (!contact) {
      const chat = await webService.getChatSummary(chatId);
      if (chat.isGroup) throw new ApiError(422, 'Selecione apenas chats individuais para o grupo de contatos');
      contact = await contactsManager.upsertFromChannel({
        channel: 'whatsapp_web', address: chat.id, displayName: chat.name || chat.phone,
        avatarUrl: chat.imageUrl, source: 'whatsapp_web_group_builder', authorize: false, consentStatus: 'unknown'
      });
    }
    contactIds.push(contact.id);
  }
  return groupsManager.create({ name: input.name, description: input.description, source: 'whatsapp_web', contactIds }, { providerManaged: true });
}

async function listGroups(query = {}) {
  return groupsManager.list({ ...query, source: 'whatsapp_web' });
}

async function syncChats() {
  const list = await chats(200);
  let contacts = 0;
  let groups = 0;
  for (const chat of list) {
    if (chat.isGroup) {
      await groupsManager.upsertExternal({ name: chat.name, source: 'whatsapp_web', externalId: chat.id, imageUrl: chat.imageUrl });
      groups += 1;
    } else {
      await contactsManager.upsertFromChannel({
        channel: 'whatsapp_web', address: chat.id, displayName: chat.name || chat.phone,
        avatarUrl: chat.imageUrl, source: 'whatsapp_web_sync', authorize: false, consentStatus: 'unknown'
      });
      contacts += 1;
    }
  }
  return { contacts, groups };
}

async function send(input) {
  await ensureNotExpired();
  const currentStatus = await status();
  if (!currentStatus.ready) {
    throw new ApiError(503, 'Sessao do WhatsApp Web nao autenticada', null, 'WHATSAPP_WEB_NOT_READY');
  }
  let destination = input.destination;
  if (!destination && input.contactId) destination = (await contactsManager.getDestination(input.contactId, 'whatsapp_web')).address;
  if (!destination && input.groupId) {
    const group = await groupsManager.getById(input.groupId);
    if (group.source !== 'whatsapp_web' || !group.active || group.notificationDisabled) throw new ApiError(409, 'Grupo WhatsApp Web indisponivel');
    destination = group.externalId;
  }
  if (destination && !input.contactId && !input.groupId && !input.allowUnconsented) {
    const knownContact = await contactsManager.findByChannelAddress('whatsapp_web', destination);
    if (knownContact) destination = (await contactsManager.getDestination(knownContact.id, 'whatsapp_web')).address;
    else {
      const knownGroup = await groupsManager.findByExternalId('whatsapp_web', destination);
      if (!knownGroup) throw new ApiError(403, 'Destino WhatsApp Web nao cadastrado/autorizado', null, 'UNKNOWN_DESTINATION');
      destination = knownGroup.externalId;
    }
  }
  const text = input.text || input.body;
  if (!destination || !text) throw new ApiError(422, 'Destino e texto obrigatorios');
  const result = await webService.sendMessage(destination, text, input.payload || {});
  await logsManager.create({ channel: 'whatsapp_web', action: 'message.sent', message: 'Mensagem WhatsApp Web enviada', context: { contactId: input.contactId, providerMessageId: result.providerMessageId } });
  return result;
}

async function logout() {
  const result = await webService.logout();
  const Setting = require('../models/setting.model');
  await Setting.deleteOne({ key: 'WHATSAPP_WEB_AUTHENTICATED_AT' });
  initialized = false;
  await logsManager.create({ channel: 'whatsapp_web', action: 'logout', message: 'Sessao WhatsApp Web encerrada' });
  return result;
}

module.exports = { initialize, status, chats, messages, createGroupFromChats, listGroups, syncChats, send, logout };
