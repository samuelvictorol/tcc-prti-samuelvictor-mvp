const webService = require('../services/whatsapp-web.service');
const settingsManager = require('./settings.manager');
const contactsManager = require('./contacts.manager');
const invitesManager = require('./invites.manager');
const logsManager = require('./logs.manager');
const conversationsManager = require('./conversations.manager');
const adminNotificationsManager = require('./admin-notifications.manager');
const { env } = require('../config/env');
const socketService = require('../services/socket.service');
const ApiError = require('../utils/api-error');
const { normalizeWhatsappE164, whatsappLidDigits } = require('../utils/normalizers');

async function notifyNewContact(contact, context = {}) {
  await logsManager.create({
    channel: 'whatsapp_web',
    action: 'contact.auto_created',
    message: 'Contato criado automaticamente pelo WhatsApp Web',
    context: { contactId: contact.id, ...context }
  }).catch(() => undefined);
  await adminNotificationsManager.create({
    kind: 'contact_auto_created',
    channel: 'whatsapp_web',
    title: 'Novo contato recebido',
    message: (contact.displayName || 'Um novo contato') + ' foi cadastrado automaticamente pelo WhatsApp Web.',
    contactId: contact.id,
    context
  }).catch(async (error) => {
    await logsManager.create({ level: 'warn', channel: 'whatsapp_web', action: 'admin_notification.failed', message: 'Contato criado, mas o aviso administrativo falhou', context: { error: error.message } }).catch(() => undefined);
  });
}

async function sessionMaxAgeDays() {
  const configured = await settingsManager.getValue('WHATSAPP_WEB_SESSION_MAX_AGE_DAYS');
  return Math.max(1, Number(configured || env.whatsappWebSessionMaxAgeDays));
}

async function authenticatedAt() {
  const value = await settingsManager.getValue('WHATSAPP_WEB_AUTHENTICATED_AT');
  return value ? new Date(value) : null;
}

async function clearAuthenticatedAt() {
  const Setting = require('../models/setting.model');
  await Setting.deleteOne({ key: 'WHATSAPP_WEB_AUTHENTICATED_AT' });
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

function lifecycleHandlers({ explicit = true } = {}) {
  return {
    onAuthenticated: async () => {
      await settingsManager.setValue('WHATSAPP_WEB_AUTHENTICATED_AT', new Date().toISOString(), null, { internal: true });
      await logsManager.create({ channel: 'whatsapp_web', action: 'authenticated', message: 'WhatsApp Web autenticado' });
    },
    onReady: () => logsManager.create({ channel: 'whatsapp_web', action: 'ready', message: 'WhatsApp Web pronto' }),
    onAuthFailure: async (message) => {
      await clearAuthenticatedAt();
      if (explicit) await logsManager.create({ level: 'error', channel: 'whatsapp_web', action: 'auth_failure', message: 'Falha de autenticacao WhatsApp Web', context: { reason: message } });
    },
    onDisconnected: async (reason) => {
      await clearAuthenticatedAt();
      if (explicit) await logsManager.create({ level: 'warn', channel: 'whatsapp_web', action: 'disconnected', message: 'WhatsApp Web desconectado', context: { reason } });
    },
    onError: (error) => explicit
      ? logsManager.create({ level: 'error', channel: 'whatsapp_web', action: 'error', message: 'Nao foi possivel iniciar o WhatsApp Web', context: { error: error.message } })
      : undefined,
    onMessage: processIncoming
  };
}

async function initialize(options = {}) {
  const explicit = options.explicit !== false;
  await ensureNotExpired().catch((error) => {
    if (error.code !== 'WHATSAPP_WEB_SESSION_EXPIRED') throw error;
  });
  const result = await webService.initialize(lifecycleHandlers({ explicit }), { explicit });
  return result;
}

async function resume() {
  if (!await authenticatedAt()) return status();
  try {
    await ensureNotExpired();
  } catch (error) {
    if (error.code === 'WHATSAPP_WEB_SESSION_EXPIRED') return status();
    throw error;
  }
  return initialize({ explicit: false });
}

async function regenerate() {
  await clearAuthenticatedAt();
  const result = await webService.regenerate(lifecycleHandlers({ explicit: true }));
  return result;
}

function serializedId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value._serialized || value.$1 || null;
}

function incomingChatId(message) {
  return serializedId(message?.from)
    || serializedId(message?.id?.remote)
    || serializedId(message?.chatId);
}

function providerMessageId(message) {
  return serializedId(message?.id) || serializedId(message?.providerMessageId);
}

function verifiedContactPhone(message, contactData, chatId, contactAddress) {
  const blockedIdentifiers = [chatId, contactAddress]
    .map(whatsappLidDigits)
    .filter(Boolean);
  const serializedContactId = serializedId(contactData?.id);
  const structuredContactId = contactData?.id?.user && contactData?.id?.server
    ? `${contactData.id.user}@${contactData.id.server}`
    : null;
  return [
    serializedContactId,
    structuredContactId,
    contactAddress,
    message?.phone,
    contactData?.number
  ].map((candidate) => normalizeWhatsappE164(candidate, { blockedIdentifiers }))
    .find(Boolean) || null;
}

function isGroupChat(chatId, message) {
  return Boolean(message?.isGroup || message?.author || /@g\.us$/i.test(String(chatId || '')));
}

async function contactFromMessage(message, chatId) {
  if (message?.contactData) return message.contactData;
  if (typeof message?.getContact === 'function') {
    try {
      const contact = await message.getContact();
      if (contact) return contact;
    } catch (_error) {
      // Dados de perfil sao enriquecimento best effort e nao bloqueiam o comando de permissao.
    }
  }
  const fallbackPhone = message?.phone || (/@(c\.us|s\.whatsapp\.net)$/i.test(chatId)
    ? String(chatId).replace(/@.+$/, '')
    : null);
  return {
    id: { _serialized: chatId },
    number: fallbackPhone,
    pushname: message?.displayName || message?.rawData?.notifyName || fallbackPhone || chatId
  };
}

async function processIncoming(message) {
  if (!webService.snapshot().ready) {
    return { ignored: true, reason: 'session_not_ready' };
  }
  const chatId = incomingChatId(message);
  if (message?.fromMe || chatId === 'status@broadcast') return;
  if (!chatId) return { ignored: true, reason: 'invalid_chat_id' };
  if (isGroupChat(chatId, message)) return;
  const contactData = await contactFromMessage(message, chatId);
  const contactAddress = serializedId(contactData?.id) || chatId;
  const phone = verifiedContactPhone(message, contactData, chatId, contactAddress);
  const inboundText = String(message.body || '');
  const strictPermissionGranted = await settingsManager.isWhatsappPermissionCommand(inboundText);
  const markerCandidate = inboundText.normalize('NFKC').trim().split(/\s+/).at(-1);
  const hasValidAttributionMarker = !strictPermissionGranted
    && Boolean(invitesManager.parseAttributionMarker(markerCandidate));
  const configuredPermissionCommand = hasValidAttributionMarker
    ? await settingsManager.getWhatsappPermissionCommand()
    : null;
  const invitationInvocation = hasValidAttributionMarker
    ? await invitesManager.resolveWhatsappInviteInvocation(inboundText, configuredPermissionCommand)
    : null;
  const permissionGranted = Boolean(invitationInvocation) || strictPermissionGranted;
  const receivedPermissionCommand = permissionGranted
    ? invitationInvocation?.command || String(message.body || '').trim()
    : null;
  const existingChannelContact = await contactsManager.findByChannelAddress('whatsapp_web', chatId);
  const existingContact = existingChannelContact
    || await contactsManager.findByChannelOrPhone('whatsapp_web', chatId, phone);
  const webIdentities = existingContact?.channels?.filter((item) => item.channel === 'whatsapp_web') || [];
  const existingIdentity = webIdentities.find((item) => item.address === chatId) || webIdentities[0];
  const alreadyGranted = webIdentities.some((identity) => (
    identity.authorized && identity.consentStatus === 'granted'
  ));
  const pendingGrant = existingContact?.pendingWhatsappConsents?.some((pending) => (
    pending.channel === 'whatsapp_web' && (pending.status || 'granted') === 'granted'
  ));
  let contactAvatarUrl = message?.contactAvatarUrl || null;
  if (!contactAvatarUrl && !message?.skipProfileLookup) {
    contactAvatarUrl = await webService.getProfilePicUrl(contactAddress).catch(() => null);
  }
  if (!contactAvatarUrl && !message?.skipProfileLookup && contactAddress !== chatId) {
    contactAvatarUrl = await webService.getProfilePicUrl(chatId).catch(() => null);
  }
  const displayName = contactData.pushname || contactData.name || contactData.number
    || message?.displayName || message?.rawData?.notifyName || chatId;
  // Uma conversa Web e uma inbox temporaria antes do opt-in. Ela pode existir
  // sem Contact; somente o comando ou um contato que ja existe autoriza o
  // enriquecimento/cadastro da identidade no gerenciador de contatos.
  const contact = permissionGranted || existingContact
    ? await contactsManager.upsertFromChannel({
      channel: 'whatsapp_web', address: chatId,
      displayName,
      phone,
      avatarUrl: contactAvatarUrl,
      source: permissionGranted ? 'whatsapp_web_permission_command' : 'whatsapp_web_message',
      // Um novo alias da mesma identidade WhatsApp herda o grant ja auditado do
      // provedor. Um grant pendente continua sem status explicito para ser
      // consumido pelo contacts.manager com sua proveniencia original.
      authorize: permissionGranted || (alreadyGranted && !pendingGrant),
      consentStatus: permissionGranted || (alreadyGranted && !pendingGrant) ? 'granted' : undefined,
      consentSource: permissionGranted
        ? 'automatic_permission_command'
        : alreadyGranted ? existingIdentity?.consentSource : undefined,
      consentCommand: permissionGranted ? receivedPermissionCommand : existingIdentity?.consentCommand,
      consentEvidence: permissionGranted ? { providerMessageId: providerMessageId(message), chatId } : undefined,
      shareWhatsappConsent: permissionGranted,
      refreshProfile: permissionGranted,
      metadata: {
        autoRegisteredVia: 'whatsapp_web',
        ...(permissionGranted ? {
          permissionCommandReceived: true,
          permissionCommandReceivedVia: 'whatsapp_web',
          sharedWhatsappConsent: true
        } : {}),
        chatId,
        messageFrom: chatId,
        contactId: contactAddress,
        serializedId: contactAddress,
        contactUser: contactData?.id?.user || null,
        contactNumber: phone
      }
    })
    : null;
  const authorizedAfterUpsert = contact?.channels?.some((identity) => (
    identity.channel === 'whatsapp_web'
    && identity.authorized
    && identity.consentStatus === 'granted'
  ));
  const invitationAttribution = invitationInvocation && contact
    ? await invitesManager.attributeContactFromMarker(
      contact.id,
      invitationInvocation.attributionMarker,
      'whatsapp_web'
    )
    : null;
  if (permissionGranted) {
    await conversationsManager.attachContact('whatsapp_web', chatId, contact.id, {
      displayName,
      avatarUrl: contactAvatarUrl
    });
  }
  if (permissionGranted && contact && (contact.upsertState?.created ?? !existingContact)) {
    await notifyNewContact(contact, {
      source: permissionGranted ? 'permission_command' : 'inbound_message',
      permissionGranted
    });
  }
  const stored = await conversationsManager.recordInbound({
    channel: 'whatsapp_web',
    externalId: chatId,
    contactId: contact?.id,
    displayName,
    avatarUrl: contactAvatarUrl,
    isGroup: false,
    providerMessageId: providerMessageId(message),
    body: invitationInvocation ? receivedPermissionCommand : message.body || '',
    type: message.type,
    hasMedia: message.hasMedia,
    sentAt: Number.isFinite(Number(message.timestamp)) && Number(message.timestamp) > 0
      ? Number(message.timestamp) * 1000
      : new Date()
  });
  if (!stored.duplicate && !stored.discardedByRemoval && stored.message) {
    if (!permissionGranted && !alreadyGranted && !authorizedAfterUpsert) {
      socketService.emit('whatsapp_web:permission_required', {
        contactId: contact?.id || null,
        chatId,
        providerMessageId: providerMessageId(message),
        at: new Date().toISOString()
      });
    }
    socketService.emit('whatsapp_web:message', {
      id: providerMessageId(message),
      chatId,
      entityId: contact?.id || null,
      isGroup: false,
      fromMe: false,
      body: invitationInvocation
        ? receivedPermissionCommand
        : String(message.body || '').slice(0, 2000),
      inviteAttributed: Boolean(invitationAttribution),
      type: message.type,
      timestamp: message.timestamp,
      conversationId: stored.conversation.id
    });
    await logsManager.create({
      channel: 'whatsapp_web',
      action: permissionGranted
        ? 'contact.permission_granted'
        : authorizedAfterUpsert || alreadyGranted ? 'message.received' : 'message.received_pending_permission',
      message: permissionGranted
        ? 'Permissao de notificacao para WhatsApp Web e Cloud recebida pelo WhatsApp Web'
        : authorizedAfterUpsert || alreadyGranted
          ? 'Mensagem WhatsApp Web recebida'
          : 'Mensagem WhatsApp Web armazenada aguardando permissao',
      context: {
        contactId: contact?.id || null,
        messageId: providerMessageId(message),
        isGroup: false,
        source: contact?.channels?.find((item) => item.channel === 'whatsapp_web')?.source || 'pending_whatsapp_web_inbox',
        ...(permissionGranted ? {
          permissionChannels: ['whatsapp_web', 'whatsapp_cloud'],
          permissionCommand: receivedPermissionCommand,
          permissionReceivedVia: 'whatsapp_web'
        } : {})
      }
    });
  }
  return {
    ignored: false,
    contact,
    permissionGranted,
    pendingRegistration: !contact,
    permissionRequired: !permissionGranted && !alreadyGranted && !authorizedAfterUpsert,
    duplicate: Boolean(stored.duplicate)
  };
}

async function status() {
  const state = webService.snapshot();
  const expiresAt = await expiry();
  return { configured: true, ...state, expiresAt };
}

function providerHistoryDisabled() {
  throw new ApiError(
    410,
    'Importacao e sincronizacao de chats do WhatsApp Web foram desativadas; use apenas conversas registradas por eventos em tempo real',
    null,
    'WHATSAPP_WEB_HISTORY_DISABLED'
  );
}

async function chats() {
  return providerHistoryDisabled();
}

async function assertKnownChat(chatId) {
  if (/@g\.us$/i.test(String(chatId || ''))) {
    throw new ApiError(422, 'WhatsApp Web permite resposta somente em chat individual', null, 'WHATSAPP_WEB_DIRECT_ONLY');
  }
  const contact = await contactsManager.findByChannelAddress('whatsapp_web', chatId);
  if (contact) return { type: 'contact', value: contact };
  throw new ApiError(
    403,
    'O remetente ainda nao se registrou com o comando de permissao',
    null,
    'UNKNOWN_CHAT_CONTACT'
  );
}

async function assertAuthorizedChat(chatId) {
  const known = await assertKnownChat(chatId);
  const identity = known.value.channels?.find((item) => (
    item.channel === 'whatsapp_web'
    && item.address === chatId
    && item.authorized
    && item.consentStatus === 'granted'
  ));
  if (!identity) {
    throw new ApiError(
      409,
      'O contato ainda nao autorizou respostas pelo WhatsApp Web',
      null,
      'CHANNEL_NOT_AUTHORIZED'
    );
  }
  return known;
}

async function messages() {
  return providerHistoryDisabled();
}

async function syncChats() {
  return providerHistoryDisabled();
}

async function send(input) {
  if (input.groupId) {
    throw new ApiError(422, 'WhatsApp Web permite resposta somente em chat individual', null, 'WHATSAPP_WEB_DIRECT_ONLY');
  }
  await ensureNotExpired();
  const currentStatus = await status();
  if (!currentStatus.ready) {
    throw new ApiError(503, 'Sessao do WhatsApp Web nao autenticada', null, 'WHATSAPP_WEB_NOT_READY');
  }
  let destination = input.destination;
  let destinationContact;
  if (!destination && input.contactId) {
    const resolved = await contactsManager.getDestination(input.contactId, 'whatsapp_web');
    destination = resolved.address;
    destinationContact = resolved.contact;
  }
  if (destination) {
    const knownChat = await assertAuthorizedChat(destination);
    destinationContact = knownChat.value;
  }
  const text = input.text || input.body;
  if (!destination || !text) throw new ApiError(422, 'Destino e texto obrigatorios');
  const result = await webService.sendMessage(destination, text, input.payload || {});
  await logsManager.create({ channel: 'whatsapp_web', action: 'message.sent', message: 'Mensagem WhatsApp Web enviada', context: { contactId: input.contactId || destinationContact?.id, providerMessageId: result.providerMessageId } });
  try {
    await conversationsManager.recordOutbound({
      channel: 'whatsapp_web',
      externalId: result.chatId,
      contactId: input.contactId || destinationContact?.id,
      displayName: destinationContact?.displayName,
      avatarUrl: destinationContact?.avatarUrl,
      isGroup: false,
      providerMessageId: result.providerMessageId,
      body: text,
      type: 'chat',
      sentAt: new Date()
    });
  } catch (error) {
    await logsManager.create({ level: 'warn', channel: 'whatsapp_web', action: 'conversation.store_failed', message: 'Mensagem enviada, mas o historico local nao foi atualizado', context: { error: error.message } }).catch(() => undefined);
  }
  return result;
}

async function logout() {
  const before = webService.snapshot();
  const result = await webService.logout();
  await clearAuthenticatedAt();
  if (before.ready || before.state === 'authenticated') {
    await logsManager.create({ channel: 'whatsapp_web', action: 'logout', message: 'Sessao WhatsApp Web encerrada' });
  }
  return result;
}

async function shutdown() {
  return webService.destroy();
}

module.exports = {
  initialize,
  resume,
  regenerate,
  status,
  chats,
  messages,
  syncChats,
  send,
  logout,
  shutdown,
  processIncoming,
  verifiedContactPhone
};
