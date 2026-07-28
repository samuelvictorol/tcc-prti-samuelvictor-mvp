const crypto = require('node:crypto');
const settingsManager = require('./settings.manager');
const contactsManager = require('./contacts.manager');
const conversationsManager = require('./conversations.manager');
const invitesManager = require('./invites.manager');
const logsManager = require('./logs.manager');
const adminNotificationsManager = require('./admin-notifications.manager');
const webhookEventsManager = require('./whatsapp-cloud-webhook-events.manager');
const ConversationBackup = require('../models/conversation-backup.model');
const backupStorage = require('../services/conversation-backup-storage.service');
const { decrypt, timingSafeEqual } = require('../services/crypto.service');
const { env } = require('../config/env');
const { emit } = require('../services/socket.service');
const ApiError = require('../utils/api-error');
const { buildOfficialTemplateMessage, buildCustomTemplateMessage, listTemplatePresets } = require('../utils/whatsapp-cloud-templates');
const { normalizeWhatsappE164 } = require('../utils/normalizers');
const { parsePagination, pageResult } = require('../utils/pagination');

const CLOUD_MESSAGE_TYPES_WITH_MEDIA = new Set(['audio', 'document', 'image', 'sticker', 'video']);
const DEFAULT_CLOUD_MESSAGE_LABELS = Object.freeze({
  audio: '[Audio]',
  contacts: '[Contato]',
  document: '[Documento]',
  image: '[Imagem]',
  interactive: '[Interacao]',
  location: '[Localizacao]',
  reaction: '[Reacao]',
  sticker: '[Sticker]',
  video: '[Video]'
});
const BACKUP_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

function unwrapCredential(value) {
  let normalized = String(value || '').trim();
  if (normalized.length >= 2) {
    const first = normalized[0];
    const last = normalized.at(-1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      normalized = normalized.slice(1, -1).trim();
    }
  }
  return normalized;
}

function normalizeAccessToken(value) {
  return unwrapCredential(value).replace(/^Bearer\s+/i, '').trim();
}

function trustedPhoneNumberId(value) {
  const normalized = unwrapCredential(value);
  return /^\d{5,30}$/.test(normalized) ? normalized : null;
}

function exposedChannelError(statusCode, message, details, code) {
  const error = new ApiError(statusCode, message, details, code);
  error.expose = true;
  return error;
}

async function sendConfiguration() {
  const [accessToken, phoneNumberId, version] = await Promise.all([
    settingsManager.getValue('WHATSAPP_CLOUD_ACCESS_TOKEN'),
    settingsManager.getValue('WHATSAPP_CLOUD_PHONE_NUMBER_ID'),
    settingsManager.getValue('WHATSAPP_CLOUD_API_VERSION')
  ]);
  const normalizedAccessToken = normalizeAccessToken(accessToken);
  const rawPhoneNumberId = unwrapCredential(phoneNumberId);
  const normalizedPhoneNumberId = trustedPhoneNumberId(rawPhoneNumberId);
  const normalizedVersion = unwrapCredential(version || env.whatsappCloudApiVersion);
  if (!normalizedAccessToken || !rawPhoneNumberId) {
    throw exposedChannelError(503, 'Envio do WhatsApp Cloud nao configurado', {
      missing: [
        !normalizedAccessToken && 'accessToken',
        !rawPhoneNumberId && 'phoneNumberId'
      ].filter(Boolean)
    }, 'CHANNEL_NOT_CONFIGURED');
  }
  if (!normalizedPhoneNumberId) {
    throw exposedChannelError(
      503,
      'Phone Number ID invalido; informe somente o identificador numerico fornecido pela Meta',
      null,
      'WHATSAPP_CLOUD_PHONE_NUMBER_ID_INVALID'
    );
  }
  if (!/^v\d+\.\d+$/.test(normalizedVersion)) {
    throw exposedChannelError(
      503,
      'Versao da API do WhatsApp Cloud invalida; use o formato v25.0',
      { apiVersion: normalizedVersion },
      'WHATSAPP_CLOUD_VERSION_INVALID'
    );
  }
  return {
    accessToken: normalizedAccessToken,
    phoneNumberId: normalizedPhoneNumberId,
    version: normalizedVersion
  };
}

async function challengeConfiguration() {
  const verifyToken = await settingsManager.getValue('WHATSAPP_CLOUD_VERIFY_TOKEN');
  if (!verifyToken) {
    throw new ApiError(503, 'Token de verificacao do webhook nao configurado', null, 'WHATSAPP_WEBHOOK_VERIFY_NOT_CONFIGURED');
  }
  return { verifyToken };
}

async function signatureConfiguration() {
  const appSecret = await settingsManager.getValue('WHATSAPP_CLOUD_APP_SECRET');
  if (!appSecret) {
    throw new ApiError(503, 'App Secret do webhook nao configurado', null, 'WHATSAPP_WEBHOOK_SIGNATURE_NOT_CONFIGURED');
  }
  return { appSecret };
}

async function status() {
  const [accessToken, phoneNumberId, verifyToken, appSecret, version] = await Promise.all([
    settingsManager.getValue('WHATSAPP_CLOUD_ACCESS_TOKEN'),
    settingsManager.getValue('WHATSAPP_CLOUD_PHONE_NUMBER_ID'),
    settingsManager.getValue('WHATSAPP_CLOUD_VERIFY_TOKEN'),
    settingsManager.getValue('WHATSAPP_CLOUD_APP_SECRET'),
    settingsManager.getValue('WHATSAPP_CLOUD_API_VERSION')
  ]);
  const normalizedVersion = unwrapCredential(version || env.whatsappCloudApiVersion);
  const sendConfigured = Boolean(
    normalizeAccessToken(accessToken)
    && trustedPhoneNumberId(phoneNumberId)
    && /^v\d+\.\d+$/.test(normalizedVersion)
  );
  const webhookVerificationConfigured = Boolean(verifyToken);
  const webhookSignatureConfigured = Boolean(appSecret);
  return {
    configured: sendConfigured,
    sendConfigured,
    webhookVerificationConfigured,
    webhookSignatureConfigured,
    webhookConfigured: webhookVerificationConfigured && webhookSignatureConfigured,
    apiVersion: normalizedVersion
  };
}

async function verifyChallenge(mode, token, challenge) {
  const config = await challengeConfiguration();
  if (mode !== 'subscribe' || !timingSafeEqual(token, config.verifyToken)) throw new ApiError(403, 'Token de verificacao invalido');
  return challenge;
}

async function verifySignature(rawBody, signature) {
  const config = await signatureConfiguration();
  if (!signature?.startsWith('sha256=')) throw new ApiError(401, 'Assinatura Meta ausente');
  const expected = 'sha256=' + crypto.createHmac('sha256', config.appSecret).update(rawBody || Buffer.alloc(0)).digest('hex');
  if (!timingSafeEqual(signature, expected)) throw new ApiError(401, 'Assinatura Meta invalida');
}

function cloudIdentity(source = {}, fallback = {}) {
  const raw = source.wa_id ?? source.from ?? fallback.wa_id ?? fallback.from;
  return normalizeWhatsappE164(raw);
}

function cloudLogicalId(source = {}, fallback = {}) {
  const raw = source.from_logical_id ?? source.logical_id
    ?? fallback.from_logical_id ?? fallback.logical_id;
  const digits = String(raw || '').replace(/\D/g, '');
  return /^\d{8,}$/.test(digits) ? digits : null;
}

function cloudProfile(source = {}) {
  const profile = source.profile || {};
  const avatarCandidate = profile.picture_url || profile.profile_pic_url || profile.avatar_url || profile.picture || profile.photo
    || source.picture_url || source.profile_pic_url || source.avatar_url || source.picture || source.photo;
  return {
    displayName: profile.name || source.name || source.display_name || null,
    avatarUrl: typeof avatarCandidate === 'string' && /^https:\/\//i.test(avatarCandidate) ? avatarCandidate : null
  };
}

function sameCloudIdentity(left, right) {
  if (!left || !right) return false;
  const leftAliases = contactsManager.mergePhoneIdentity('whatsapp_cloud', left)?.aliases || [left];
  const rightAliases = new Set(contactsManager.mergePhoneIdentity('whatsapp_cloud', right)?.aliases || [right]);
  return leftAliases.some((alias) => rightAliases.has(alias));
}

function sameProviderUser(left = {}, right = {}) {
  const leftIds = new Set([
    left.user_id,
    left.from_user_id,
    left.logical_id,
    left.from_logical_id
  ].map((value) => String(value || '').trim()).filter(Boolean));
  return [right.user_id, right.from_user_id, right.logical_id, right.from_logical_id]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .some((value) => leftIds.has(value));
}

function matchingCloudContact(contacts = [], message = {}) {
  const messageAddress = cloudIdentity(message);
  return contacts.find((contact) => (
    sameCloudIdentity(cloudIdentity(contact), messageAddress)
    || sameProviderUser(contact, message)
  )) || null;
}

function cloudMessageBody(message = {}) {
  const type = String(message.type || 'unknown');
  const candidates = [
    message.text?.body,
    message.button?.text,
    message.button?.payload,
    message.interactive?.button_reply?.title,
    message.interactive?.list_reply?.title,
    message.image?.caption,
    message.video?.caption,
    message.document?.caption,
    message.document?.filename,
    message.reaction?.emoji,
    message.location?.name,
    message.location?.address,
    message.errors?.[0]?.title
  ];
  const body = candidates.find((value) => typeof value === 'string' && value.trim());
  return String(body || DEFAULT_CLOUD_MESSAGE_LABELS[type] || `[${type}]`).slice(0, conversationsManager.MAX_BODY_LENGTH);
}

function cloudMessageSentAt(message = {}) {
  const timestampMs = Number(message.timestamp) * 1000;
  return Number.isFinite(timestampMs) && timestampMs > 0 ? new Date(timestampMs) : new Date();
}

function cloudConversationMetadata(message, value, businessAccountId, providerContact = {}) {
  return {
    provider: 'meta_whatsapp_cloud',
    businessAccountId: businessAccountId || null,
    phoneNumberId: value.metadata?.phone_number_id || null,
    displayPhoneNumber: value.metadata?.display_phone_number || null,
    waId: providerContact.wa_id || null,
    userId: providerContact.user_id || message.from_user_id || null,
    fromUserId: message.from_user_id || null,
    logicalId: providerContact.logical_id || null,
    fromLogicalId: message.from_logical_id || null,
    context: message.context || null,
    media: CLOUD_MESSAGE_TYPES_WITH_MEDIA.has(message.type)
      ? message[message.type] || null
      : null,
    interactive: message.interactive || null
  };
}

async function upsertCloudContact(source, value, fallback = {}, options = {}) {
  const address = cloudIdentity(source, fallback);
  if (!address) return null;
  const profile = cloudProfile(source);
  const existingChannelContact = await contactsManager.findByChannelAddress('whatsapp_cloud', address);
  const existing = existingChannelContact
    || await contactsManager.findByChannelOrPhone('whatsapp_cloud', address, address);
  const existingIdentity = existing?.channels?.find((item) => item.channel === 'whatsapp_cloud');
  const alreadyGranted = Boolean(existingIdentity?.authorized && existingIdentity?.consentStatus === 'granted');
  const permissionGranted = options.permissionGranted === true;
  const contact = await contactsManager.upsertFromChannel({
    channel: 'whatsapp_cloud',
    address,
    phone: address,
    matchedContactId: existing?.id,
    displayName: profile.displayName || address,
    avatarUrl: profile.avatarUrl,
    source: permissionGranted ? 'whatsapp_cloud_permission_command' : 'whatsapp_cloud_webhook',
    authorize: permissionGranted,
    consentStatus: permissionGranted ? 'granted' : undefined,
    consentSource: permissionGranted ? 'automatic_permission_command' : undefined,
    consentCommand: permissionGranted ? options.permissionCommand : undefined,
    consentEvidence: permissionGranted ? { providerMessageId: source.id || fallback.id || null, address } : undefined,
    metadata: {
      waId: source.wa_id || fallback.wa_id || null,
      userId: source.user_id || fallback.user_id || null,
      fromUserId: source.from_user_id || fallback.from_user_id || null,
      countryCode: source.country_code || fallback.country_code || null,
      phoneNumberId: value.metadata?.phone_number_id || null,
      displayPhoneNumber: value.metadata?.display_phone_number || null,
      businessAccountId: value.businessAccountId || null,
      chatId: address,
      logicalId: source.logical_id || fallback.logical_id || null,
      fromLogicalId: source.from_logical_id || fallback.from_logical_id || null,
      messageType: source.type || fallback.type || null,
      autoRegisteredVia: 'whatsapp_cloud',
      ...(permissionGranted ? {
        permissionCommandReceived: true,
        permissionCommandReceivedVia: 'whatsapp_cloud',
        sharedWhatsappConsent: true
      } : {})
    }
  });
  const created = contact.upsertState?.created ?? !existing;
  const identityAdded = contact.upsertState?.identityAdded ?? !existing;
  const authorizedAfterUpsert = contact.channels?.some((identity) => (
    identity.channel === 'whatsapp_cloud'
    && identity.authorized
    && identity.consentStatus === 'granted'
  ));
  if (created) {
    const context = {
      contactId: contact.id,
      channel: 'whatsapp_cloud',
      source: permissionGranted ? 'permission_command' : 'inbound_message',
      permissionGranted
    };
    await logsManager.create({
      channel: 'whatsapp_cloud',
      action: 'contact.auto_created',
      message: 'Contato criado automaticamente pelo WhatsApp Cloud',
      context
    });
    await adminNotificationsManager.create({
      kind: 'contact_auto_created',
      channel: 'whatsapp_cloud',
      title: 'Novo contato no WhatsApp Cloud',
      message: (contact.displayName || 'Contato') + (permissionGranted
        ? ' foi cadastrado e autorizou notificacoes pelo WhatsApp Cloud.'
        : ' foi cadastrado pelo webhook e aguarda permissão para notificações.'),
      contactId: contact.id,
      context
    }).catch(() => undefined);
  }
  emit('contact:auto_upserted', {
    channel: 'whatsapp_cloud',
    contactId: contact.id,
    created,
    identityAdded,
    displayName: contact.displayName,
    at: new Date().toISOString()
  });
  return {
    contact,
    created,
    identityAdded,
    address,
    permissionGranted,
    permissionRequired: !permissionGranted && !alreadyGranted && !authorizedAfterUpsert
  };
}

async function processCloudInboundMessage(message, value, businessAccountId) {
  const resultSummary = { receivedMessages: 1, createdContacts: 0, updatedContacts: 0 };
  const messageAddress = message?.id ? cloudIdentity(message) : null;
  const matchedProviderContact = matchingCloudContact(value.contacts || [], message) || {};
  const address = messageAddress;
  if (!address) return resultSummary;
  const inboundText = String(message.text?.body || '');
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
  const permissionCommand = permissionGranted
    ? invitationInvocation?.command || String(message.text?.body || '').trim()
    : null;
  const result = await upsertCloudContact(
    { ...matchedProviderContact, ...message },
    { ...value, businessAccountId: businessAccountId || null },
    matchedProviderContact,
    { permissionGranted, permissionCommand }
  );
  if (!result) return resultSummary;
  const invitationAttribution = invitationInvocation
    ? await invitesManager.attributeContactFromMarker(
      result.contact.id,
      invitationInvocation.attributionMarker,
      'whatsapp_cloud'
    )
    : null;
  if (result.permissionRequired) {
    emit('whatsapp_cloud:permission_required', {
      contactId: result.contact.id,
      providerMessageId: message.id || null,
      at: new Date().toISOString()
    });
  }
  const { contact } = result;
  const sentAt = cloudMessageSentAt(message);
  await conversationsManager.recordInbound({
    channel: 'whatsapp_cloud',
    externalId: address,
    contactId: contact.id,
    displayName: cloudProfile({ ...matchedProviderContact, ...message }).displayName || contact.displayName || address,
    avatarUrl: cloudProfile({ ...matchedProviderContact, ...message }).avatarUrl || contact.avatarUrl || null,
    providerMessageId: message.id || null,
    body: cloudMessageBody(message),
    type: message.type || 'unknown',
    hasMedia: CLOUD_MESSAGE_TYPES_WITH_MEDIA.has(message.type),
    sentAt,
    metadata: cloudConversationMetadata(message, value, businessAccountId, matchedProviderContact)
  });
  if (result.created) resultSummary.createdContacts += 1;
  else resultSummary.updatedContacts += 1;
  await logsManager.create({
    channel: 'whatsapp_cloud',
    action: permissionGranted ? 'contact.permission_granted' : 'message.received',
    message: permissionGranted
      ? 'Permissao de notificacao recebida pelo WhatsApp Cloud'
      : 'Mensagem WhatsApp Cloud recebida',
    context: {
      contactId: contact.id,
      providerMessageId: message.id,
      type: message.type,
      ...(permissionGranted ? {
        permissionChannels: ['whatsapp_cloud'],
        permissionCommand,
        permissionReceivedVia: 'whatsapp_cloud'
      } : {})
    }
  });
  emit('whatsapp_cloud:message', {
    contactId: contact.id,
    providerMessageId: message.id || null,
    from: address,
    type: message.type || 'unknown',
    text: message.text?.body ? String(message.text.body).slice(0, 2000) : null,
    ...(invitationInvocation ? {
      text: permissionCommand,
      inviteAttributed: Boolean(invitationAttribution)
    } : {}),
    sentAt: sentAt.toISOString()
  });
  return resultSummary;
}

async function processCloudReceipt(receipt) {
  const notificationsManager = require('./notifications.manager');
  const storedReceipt = await notificationsManager.storeCloudReceipt(receipt);
  let reconciliation;
  try {
    reconciliation = await notificationsManager.reconcileCloudReceipt({
      ...receipt,
      revisionToken: storedReceipt?.revisionToken
    });
  } catch (error) {
    if (error.code !== 'WHATSAPP_CLOUD_RECEIPT_PROCESSING') throw error;
    reconciliation = { matched: false, deferred: true, providerStatus: receipt.status };
  }
  if (reconciliation.matched) {
    await notificationsManager.markCloudReceiptProcessed(receipt.id, storedReceipt?.revisionToken);
  }
  await logsManager.create({
    level: receipt.status === 'failed' ? 'error' : 'info',
    channel: 'whatsapp_cloud',
    action: receipt.status === 'failed' ? 'notification.provider_failed' : 'message.status',
    message: receipt.status === 'failed'
      ? 'A Meta informou falha na entrega da mensagem'
      : 'Status de mensagem WhatsApp atualizado',
    context: {
      providerMessageId: receipt.id,
      status: receipt.status,
      notificationId: reconciliation.notificationId || null,
      deliveryStatus: reconciliation.deliveryStatus || null,
      deferred: Boolean(reconciliation.deferred),
      retryScheduled: Boolean(reconciliation.retryScheduled),
      errors: reconciliation.errors || []
    }
  });
  return { receivedStatuses: 1 };
}

async function processCloudWebhookDescriptor(descriptor) {
  const value = descriptor.value || {};
  const summary = {
    receivedMessages: 0,
    receivedStatuses: 0,
    createdContacts: 0,
    updatedContacts: 0
  };
  for (const message of Array.isArray(value.messages) ? value.messages : []) {
    const result = await processCloudInboundMessage(message, value, descriptor.businessAccountId);
    for (const key of Object.keys(result)) summary[key] += result[key];
  }
  for (const receipt of Array.isArray(value.statuses) ? value.statuses : []) {
    const result = await processCloudReceipt(receipt);
    for (const key of Object.keys(result)) summary[key] += result[key];
  }
  return summary;
}

async function webhook(payload, rawBody, signature) {
  await verifySignature(rawBody, signature);
  const persisted = await webhookEventsManager.persistPayload(payload, rawBody);
  const summary = {
    receivedMessages: 0,
    receivedStatuses: 0,
    createdContacts: 0,
    updatedContacts: 0,
    receivedEvents: persisted.events.length,
    persistedEvents: persisted.createdCount,
    duplicateEvents: persisted.duplicateCount,
    claimedEvents: 0,
    at: new Date().toISOString()
  };

  for (const workItem of persisted.workItems || []) {
    const claim = await webhookEventsManager.claimEvent(workItem.eventId);
    if (!claim) continue;
    summary.claimedEvents += 1;
    try {
      const result = await processCloudWebhookDescriptor(workItem.descriptor);
      const finalized = await webhookEventsManager.markProcessed(claim);
      if (!finalized) {
        throw new ApiError(
          503,
          'Lease do webhook expirou durante o processamento',
          null,
          'WHATSAPP_CLOUD_WEBHOOK_LEASE_LOST'
        );
      }
      for (const key of Object.keys(result)) summary[key] += result[key];
    } catch (error) {
      await webhookEventsManager.markFailed(claim, error).catch(() => undefined);
      throw error;
    }
  }

  summary.duplicateDelivery = summary.claimedEvents === 0;
  emit('whatsapp_cloud:webhook', summary);
  return { received: true, ...summary };
}

function templatePresets() {
  return listTemplatePresets();
}

function normalizeMetaDestination(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(digits)) {
    throw new ApiError(422, 'Numero WhatsApp invalido; informe pais, DDD e numero', null, 'WHATSAPP_DESTINATION_INVALID');
  }
  return digits;
}

function contactPhoneNumberId(contact) {
  const identity = contact?.channels?.find((item) => item.channel === 'whatsapp_cloud');
  return trustedPhoneNumberId(identity?.metadata?.phoneNumberId);
}

function sanitizeProviderMessage(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [credencial protegida]')
    .replace(/\bEAA[A-Za-z0-9_-]{20,}\b/g, '[credencial protegida]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 500);
}

function providerFailure(error = {}, providerHttpStatus) {
  const providerCode = Number(error.code) || null;
  const providerSubcode = Number(error.error_subcode) || null;
  let message;
  if (providerCode === 190) {
    message = 'Access token da Meta invalido, expirado ou vinculado a um app indisponivel. Gere um token do app atual e salve novamente nas configuracoes.';
  } else if (providerCode === 100 && providerSubcode === 33) {
    message = 'Phone Number ID nao encontrado ou sem acesso pelo token salvo. Confira o numero registrado e gere o token na mesma conta WhatsApp Business.';
  } else if ([10, 200].includes(providerCode)) {
    message = 'O token da Meta nao possui permissao para enviar mensagens por este numero. Confira whatsapp_business_messaging e a conta WhatsApp Business vinculada.';
  } else if (providerCode === 131030) {
    message = 'O destinatario nao esta autorizado para este numero de teste da Meta.';
  } else if (providerCode === 131047) {
    message = 'A janela de atendimento da Meta esta fechada; envie um template oficial aprovado.';
  } else if (providerCode === 132001) {
    message = 'O template ou idioma informado nao existe ou nao esta aprovado na conta WhatsApp Business configurada.';
  } else if ([131008, 131009, 132000, 132012].includes(providerCode)) {
    message = 'Os parametros enviados nao correspondem ao template aprovado na Meta.';
  } else {
    message = sanitizeProviderMessage(error.message) || 'Falha na API do WhatsApp Cloud';
  }
  return exposedChannelError(
    502,
    message,
    {
      providerHttpStatus,
      providerCode,
      providerSubcode,
      providerErrorCode: providerCode,
      providerErrorSubcode: providerSubcode,
      providerType: sanitizeProviderMessage(error.type) || null,
      providerMessage: sanitizeProviderMessage(error.message) || null,
      providerTraceId: sanitizeProviderMessage(error.fbtrace_id) || null
    },
    'WHATSAPP_CLOUD_ERROR'
  );
}

async function postCloudMessage(destination, message, options = {}) {
  const config = await sendConfiguration();
  const phoneNumberId = trustedPhoneNumberId(options.phoneNumberId) || config.phoneNumberId;
  const response = await fetch('https://graph.facebook.com/' + config.version + '/' + encodeURIComponent(phoneNumberId) + '/messages', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + config.accessToken, 'content-type': 'application/json' },
    body: JSON.stringify({
      ...message,
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizeMetaDestination(destination)
    }),
    signal: AbortSignal.timeout(20_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw providerFailure(body.error || {}, response.status);
  }
  return {
    providerMessageId: body.messages?.[0]?.id || null,
    raw: body,
    phoneNumberId
  };
}

function cloudContactConsent(contact) {
  const identity = contact?.channels?.find((item) => item.channel === 'whatsapp_cloud') || null;
  const authorized = Boolean(
    contact
    && contact.active !== false
    && !contact.notificationDisabled
    && identity?.authorized
    && identity?.consentStatus === 'granted'
  );
  return {
    authorized,
    status: identity?.consentStatus || 'unknown',
    source: identity?.consentSource || identity?.source || null,
    command: identity?.consentCommand || null,
    changedAt: identity?.consentChangedAt || identity?.consentedAt || null
  };
}

function cloudContactSummary(contact) {
  if (!contact) return null;
  const identity = contact.channels?.find((item) => item.channel === 'whatsapp_cloud') || null;
  return {
    id: contact.id,
    displayName: contact.displayName,
    avatarUrl: contact.avatarUrl,
    phone: contact.phone || identity?.deliveryAddress || identity?.address || null,
    provider: {
      address: identity?.address || null,
      deliveryAddress: identity?.deliveryAddress || null,
      waId: identity?.metadata?.waId || null,
      userId: identity?.metadata?.userId || identity?.metadata?.fromUserId || null,
      logicalId: identity?.metadata?.logicalId || identity?.metadata?.fromLogicalId || null,
      phoneNumberId: identity?.metadata?.phoneNumberId || null,
      businessAccountId: identity?.metadata?.businessAccountId || null
    }
  };
}

function enrichCloudConversation(conversation, contact) {
  return {
    ...conversation,
    contact: cloudContactSummary(contact),
    consent: cloudContactConsent(contact),
    canReply: Boolean(conversation.serviceWindow?.open)
  };
}

async function cloudConversationWithContact(id) {
  const conversation = await conversationsManager.getById(id);
  if (conversation.channel !== 'whatsapp_cloud') {
    throw new ApiError(
      422,
      'A conversa nao pertence ao WhatsApp Cloud',
      null,
      'WHATSAPP_CLOUD_CONVERSATION_REQUIRED'
    );
  }
  const contact = conversation.contactId
    ? await contactsManager.getById(conversation.contactId).catch((error) => {
      if (error.status === 404) return null;
      throw error;
    })
    : null;
  return enrichCloudConversation(conversation, contact);
}

async function listConversations(query = {}) {
  const result = await conversationsManager.list({ ...query, channel: 'whatsapp_cloud' });
  const contacts = await contactsManager.getManyByIds(result.items.map((item) => item.contactId).filter(Boolean));
  const byId = new Map(contacts.map((contact) => [String(contact.id), contact]));
  return {
    ...result,
    items: result.items.map((conversation) => (
      enrichCloudConversation(conversation, byId.get(String(conversation.contactId)) || null)
    ))
  };
}

async function getConversation(id) {
  return cloudConversationWithContact(id);
}

async function listConversationMessages(id, query = {}) {
  await cloudConversationWithContact(id);
  return conversationsManager.listMessages(id, query);
}

async function markConversationRead(id) {
  await cloudConversationWithContact(id);
  await conversationsManager.markRead(id);
  return cloudConversationWithContact(id);
}

async function clearConversation(id) {
  await cloudConversationWithContact(id);
  return conversationsManager.clearHistory(id);
}

async function exportConversations() {
  const conversations = [];
  let page = 1;
  let pages = 1;
  do {
    const batch = await listConversations({ page, limit: 100 });
    pages = batch.pages || 1;
    for (const conversation of batch.items) {
      const messages = [];
      let messagePage = 1;
      let messagePages = 1;
      do {
        const messageBatch = await conversationsManager.listMessages(
          conversation.id,
          { page: messagePage, limit: 100 }
        );
        messagePages = messageBatch.pages || 1;
        messages.push(...messageBatch.items);
        messagePage += 1;
      } while (messagePage <= messagePages);
      conversations.push({ ...conversation, messages });
    }
    page += 1;
  } while (page <= pages);
  return {
    format: 'notify-flow.whatsapp-cloud-conversations',
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'local_webhook_history',
    historyImportedFromMeta: false,
    retentionDays: conversationsManager.WHATSAPP_CLOUD_RETENTION_DAYS,
    conversations
  };
}

function backupPeriod(now = new Date()) {
  const timestamp = now.getTime();
  const periodNumber = Math.floor(timestamp / BACKUP_PERIOD_MS);
  return {
    key: String(periodNumber),
    startedAt: new Date(periodNumber * BACKUP_PERIOD_MS),
    endsAt: new Date((periodNumber + 1) * BACKUP_PERIOD_MS)
  };
}

function backupSummary(backup) {
  if (!backup) return null;
  return {
    id: String(backup._id),
    trigger: backup.trigger,
    periodKey: backup.periodKey,
    periodStartedAt: backup.periodStartedAt,
    periodEndsAt: backup.periodEndsAt,
    generatedAt: backup.generatedAt,
    conversationCount: backup.conversationCount,
    messageCount: backup.messageCount,
    filename: backup.filename || null,
    contentType: backup.contentType || 'application/json',
    storageBytes: backup.storageBytes || null,
    plaintextBytes: backup.plaintextBytes || null,
    expiresAt: backup.expiresAt || null,
    downloadable: Boolean(backup.gridFsFileId || backup.payloadEncrypted)
  };
}

function backupExpiresAt(now = new Date()) {
  return new Date(
    now.getTime() + env.conversationBackupRetentionDays * 24 * 60 * 60 * 1000
  );
}

async function pruneExpiredBackups(now = new Date()) {
  const expired = await ConversationBackup.find({ expiresAt: { $lte: now } })
    .select('gridFsFileId')
    .lean();
  let removed = 0;
  for (const backup of expired) {
    if (backup.gridFsFileId) await backupStorage.remove(backup.gridFsFileId);
    const result = await ConversationBackup.deleteOne({ _id: backup._id, expiresAt: { $lte: now } });
    removed += Number(result.deletedCount || 0);
  }
  return { removed };
}

async function createStoredBackup(trigger = 'manual', now = new Date()) {
  await pruneExpiredBackups(now);
  const exported = await exportConversations();
  const period = backupPeriod(now);
  const messageCount = exported.conversations.reduce(
    (total, conversation) => total + conversation.messages.length,
    0
  );
  const filename = `notify-flow-whatsapp-cloud-${trigger}-${now.toISOString().replace(/[:.]/g, '-')}.enc`;
  const storedFile = await backupStorage.upload(exported, { filename });
  try {
    const backup = await ConversationBackup.create({
      channel: 'whatsapp_cloud',
      trigger,
      periodKey: period.key,
      periodStartedAt: period.startedAt,
      periodEndsAt: period.endsAt,
      generatedAt: new Date(exported.generatedAt),
      conversationCount: exported.conversations.length,
      messageCount,
      gridFsFileId: storedFile.fileId,
      filename: storedFile.filename,
      contentType: storedFile.contentType,
      storageBytes: storedFile.storageBytes,
      plaintextBytes: storedFile.plaintextBytes,
      checksumSha256: storedFile.checksumSha256,
      expiresAt: backupExpiresAt(now)
    });
    return {
      created: true,
      ...backupSummary(backup),
      export: { ...exported, backupId: String(backup._id), trigger }
    };
  } catch (error) {
    await backupStorage.remove(storedFile.fileId).catch(() => undefined);
    if (error.code !== 11000 || trigger !== 'automatic') throw error;
    const existing = await ConversationBackup.findOne({
      channel: 'whatsapp_cloud',
      trigger: 'automatic',
      periodKey: period.key
    }).lean();
    return { created: false, ...backupSummary(existing), export: null };
  }
}

async function createAutomaticBackupIfDue(now = new Date()) {
  await pruneExpiredBackups(now);
  const latest = await ConversationBackup.findOne({
    channel: 'whatsapp_cloud',
    trigger: 'automatic'
  }).sort({ generatedAt: -1 }).lean();
  if (latest && now.getTime() - new Date(latest.generatedAt).getTime() < BACKUP_PERIOD_MS) {
    return { created: false, reason: 'not_due', ...backupSummary(latest) };
  }
  const created = await createStoredBackup('automatic', now);
  return { ...created, export: undefined };
}

async function listStoredBackups(query = {}, now = new Date()) {
  await pruneExpiredBackups(now);
  const { page, limit, skip } = parsePagination(query);
  const filter = {
    channel: 'whatsapp_cloud',
    $or: [
      { expiresAt: { $gt: now } },
      { expiresAt: { $exists: false } }
    ]
  };
  const [items, total] = await Promise.all([
    ConversationBackup.find(filter)
      .select('+payloadEncrypted')
      .sort({ generatedAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ConversationBackup.countDocuments(filter)
  ]);
  return pageResult(items.map(backupSummary), total, page, limit);
}

async function getStoredBackupExport(id, now = new Date()) {
  await pruneExpiredBackups(now);
  const backup = await ConversationBackup.findById(id).select('+payloadEncrypted').lean();
  if (!backup) {
    throw new ApiError(404, 'Backup nao encontrado', null, 'CONVERSATION_BACKUP_NOT_FOUND');
  }
  if (backup.expiresAt && new Date(backup.expiresAt) <= now) {
    throw new ApiError(410, 'Backup expirado', null, 'CONVERSATION_BACKUP_EXPIRED');
  }
  let exported;
  if (backup.gridFsFileId) {
    exported = await backupStorage.download(backup.gridFsFileId, backup.checksumSha256);
  } else if (backup.payloadEncrypted) {
    exported = decrypt(backup.payloadEncrypted, { json: true });
  } else {
    throw new ApiError(
      500,
      'Arquivo do backup indisponivel',
      null,
      'CONVERSATION_BACKUP_FILE_MISSING'
    );
  }
  return {
    backup: backupSummary(backup),
    export: { ...exported, backupId: String(backup._id), trigger: backup.trigger }
  };
}

async function sendConversationText(id, text, options = {}) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText || normalizedText.length > 4096) {
    throw new ApiError(
      422,
      'A mensagem deve ter entre 1 e 4096 caracteres',
      null,
      'WHATSAPP_CLOUD_TEXT_INVALID'
    );
  }
  const openConversation = await conversationsManager.requireOpenCloudServiceWindow(id);
  const destination = normalizeMetaDestination(openConversation.externalId);
  const contactId = openConversation.conversation.contact
    ? String(openConversation.conversation.contact._id || openConversation.conversation.contact)
    : null;
  const resolvedContact = contactId
    ? await contactsManager.getById(contactId).catch((error) => {
      if (error.statusCode === 404 || error.status === 404) return null;
      throw error;
    })
    : null;
  const sent = await postCloudMessage(destination, {
    type: 'text',
    text: { body: normalizedText, preview_url: false }
  }, { phoneNumberId: contactPhoneNumberId(resolvedContact) });
  const recorded = await conversationsManager.recordOutbound({
    channel: 'whatsapp_cloud',
    externalId: destination,
    contactId: contactId || undefined,
    providerMessageId: sent.providerMessageId,
    body: normalizedText,
    type: 'text',
    sentAt: new Date(),
    metadata: {
      provider: 'meta_whatsapp_cloud',
      phoneNumberId: sent.phoneNumberId,
      useCase: options.useCase || 'customer_service'
    }
  });
  await logsManager.create({
    channel: 'whatsapp_cloud',
    action: options.useCase === 'consent_request' ? 'consent.request_sent' : 'chat.message_sent',
    message: options.useCase === 'consent_request'
      ? 'Solicitacao de permissao enviada no chat WhatsApp Cloud'
      : 'Resposta enviada no chat WhatsApp Cloud',
    context: {
      contactId,
      conversationId: String(openConversation.conversation._id),
      providerMessageId: sent.providerMessageId,
      serviceWindowExpiresAt: openConversation.serviceWindow.expiresAt
    }
  });
  return {
    providerMessageId: sent.providerMessageId,
    conversation: await cloudConversationWithContact(id),
    message: recorded.message
  };
}

async function sendConsentRequest(id) {
  const conversation = await cloudConversationWithContact(id);
  if (conversation.consent.authorized) {
    throw new ApiError(
      409,
      'O contato ja autorizou notificacoes pelo WhatsApp Cloud',
      null,
      'WHATSAPP_CONSENT_ALREADY_GRANTED'
    );
  }
  const [template, command] = await Promise.all([
    settingsManager.getWhatsappConsentRequestText(),
    settingsManager.getWhatsappPermissionCommand()
  ]);
  const text = String(template).replaceAll('{command}', command);
  return sendConversationText(id, text, { useCase: 'consent_request' });
}

async function send(input) {
  const destinationCount = [input.contactId, input.groupId, input.destination].filter(Boolean).length;
  if (destinationCount !== 1) {
    throw new ApiError(422, 'Informe exatamente um destino', null, 'INVALID_DESTINATION_SELECTION');
  }
  if (input.groupId) throw new ApiError(422, 'Envio direto do WhatsApp Cloud nao aceita groupId', null, 'GROUP_DESTINATION_UNSUPPORTED');

  let destination;
  let resolvedContact = null;
  if (input.contactId) {
    const resolvedDestination = await contactsManager.getDestination(input.contactId, 'whatsapp_cloud');
    destination = resolvedDestination.address;
    resolvedContact = resolvedDestination.contact;
  } else {
    destination = input.destination;
  }
  if (destination && !input.contactId && !input.allowUnconsented) {
    const known = await contactsManager.findByChannelAddress('whatsapp_cloud', destination);
    if (!known) throw new ApiError(403, 'Destino WhatsApp nao cadastrado/autorizado', null, 'UNKNOWN_DESTINATION');
    destination = (await contactsManager.getDestination(known.id, 'whatsapp_cloud')).address;
    resolvedContact = known;
  }
  if (!destination) throw new ApiError(422, 'Destino WhatsApp obrigatorio');
  destination = normalizeMetaDestination(destination);
  let message;
  if (input.customTemplate) {
    message = buildCustomTemplateMessage(input.customTemplate);
  } else if (input.officialTemplate) {
    message = buildOfficialTemplateMessage(input.officialTemplate);
  } else if (input.templateName) {
    const template = { name: input.templateName, language: { code: input.languageCode || 'pt_BR' } };
    if (input.components?.length) template.components = input.components;
    message = {
      type: 'template',
      template
    };
  } else {
    throw new ApiError(
      422,
      'WhatsApp Cloud aceita apenas template oficial',
      null,
      'WHATSAPP_CLOUD_TEMPLATE_ONLY'
    );
  }
  if (!resolvedContact && input.useCase !== 'profile_auth') {
    resolvedContact = await contactsManager.findByChannelAddress('whatsapp_cloud', destination);
  }
  const sent = await postCloudMessage(destination, message, {
    phoneNumberId: contactPhoneNumberId(resolvedContact)
  });
  const messageId = sent.providerMessageId;
  if (input.useCase !== 'profile_auth') {
    const template = message.template || {};
    const templateName = String(template.name || input.templateName || 'template_oficial');
    try {
      await conversationsManager.recordOutbound({
        channel: 'whatsapp_cloud',
        externalId: destination,
        contactId: resolvedContact?.id || input.contactId || undefined,
        displayName: resolvedContact?.displayName || destination,
        avatarUrl: resolvedContact?.avatarUrl || null,
        providerMessageId: messageId,
        body: `[Template: ${templateName}]`,
        type: 'template',
        sentAt: new Date(),
        metadata: {
          provider: 'meta_whatsapp_cloud',
          phoneNumberId: sent.phoneNumberId,
          useCase: input.useCase || 'notification',
          template: {
            name: templateName,
            languageCode: template.language?.code || input.languageCode || null,
            components: template.components || []
          }
        }
      });
    } catch (error) {
      await logsManager.create({
        level: 'error',
        channel: 'whatsapp_cloud',
        action: 'chat.template_history_failed',
        message: 'Template enviado pela Meta, mas o espelho local do chat falhou',
        context: {
          contactId: resolvedContact?.id || input.contactId || null,
          providerMessageId: messageId,
          templateName,
          error: String(error.message || error).slice(0, 500)
        }
      }).catch(() => undefined);
    }
    await logsManager.create({ channel: 'whatsapp_cloud', action: 'message.sent', message: 'Mensagem WhatsApp Cloud enviada', context: { contactId: input.contactId, providerMessageId: messageId } });
  }
  return { providerMessageId: messageId, raw: sent.raw };
}

module.exports = {
  status,
  templatePresets,
  verifyChallenge,
  webhook,
  send,
  listConversations,
  getConversation,
  listConversationMessages,
  markConversationRead,
  clearConversation,
  exportConversations,
  createStoredBackup,
  createAutomaticBackupIfDue,
  listStoredBackups,
  getStoredBackupExport,
  pruneExpiredBackups,
  sendConversationText,
  sendConsentRequest,
  normalizeMetaDestination,
  cloudMessageBody,
  cloudMessageSentAt,
  cloudContactConsent,
  cloudIdentity,
  cloudLogicalId,
  cloudProfile,
  upsertCloudContact,
  matchingCloudContact,
  sameProviderUser
};
