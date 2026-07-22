const crypto = require('node:crypto');
const settingsManager = require('./settings.manager');
const contactsManager = require('./contacts.manager');
const logsManager = require('./logs.manager');
const adminNotificationsManager = require('./admin-notifications.manager');
const { timingSafeEqual } = require('../services/crypto.service');
const { env } = require('../config/env');
const { emit } = require('../services/socket.service');
const ApiError = require('../utils/api-error');
const { buildOfficialTemplateMessage, buildCustomTemplateMessage, listTemplatePresets } = require('../utils/whatsapp-cloud-templates');
const { normalizeWhatsappE164 } = require('../utils/normalizers');

async function sendConfiguration() {
  const [accessToken, phoneNumberId, version] = await Promise.all([
    settingsManager.getValue('WHATSAPP_CLOUD_ACCESS_TOKEN'),
    settingsManager.getValue('WHATSAPP_CLOUD_PHONE_NUMBER_ID'),
    settingsManager.getValue('WHATSAPP_CLOUD_API_VERSION')
  ]);
  if (!accessToken || !phoneNumberId) {
    throw new ApiError(503, 'Envio do WhatsApp Cloud nao configurado', {
      missing: [!accessToken && 'accessToken', !phoneNumberId && 'phoneNumberId'].filter(Boolean)
    }, 'CHANNEL_NOT_CONFIGURED');
  }
  return { accessToken, phoneNumberId, version: version || env.whatsappCloudApiVersion };
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
  const sendConfigured = Boolean(accessToken && phoneNumberId);
  const webhookVerificationConfigured = Boolean(verifyToken);
  const webhookSignatureConfigured = Boolean(appSecret);
  return {
    configured: sendConfigured,
    sendConfigured,
    webhookVerificationConfigured,
    webhookSignatureConfigured,
    webhookConfigured: webhookVerificationConfigured && webhookSignatureConfigured,
    apiVersion: version || env.whatsappCloudApiVersion
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

async function upsertCloudContact(source, value, fallback = {}, options = {}) {
  const address = cloudIdentity(source, fallback);
  if (!address) return null;
  const profile = cloudProfile(source);
  const logicalId = cloudLogicalId(source, fallback);
  const [existingChannelContact, logicalContact] = await Promise.all([
    contactsManager.findByChannelAddress('whatsapp_cloud', address),
    logicalId
      ? contactsManager.findByChannelAddress('whatsapp_web', logicalId + '@lid')
      : null
  ]);
  const existing = existingChannelContact
    || logicalContact
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
    shareWhatsappConsent: permissionGranted,
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
        ? ' foi cadastrado e autorizou WhatsApp Web e Cloud ao enviar o comando de permissão.'
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

async function webhook(payload, rawBody, signature) {
  await verifySignature(rawBody, signature);
  let receivedMessages = 0;
  let receivedStatuses = 0;
  let createdContacts = 0;
  let updatedContacts = 0;
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const message of value.messages || []) {
        receivedMessages += 1;
        const messageAddress = message?.id ? cloudIdentity(message) : null;
        const matchedProviderContact = matchingCloudContact(value.contacts || [], message) || {};
        const address = messageAddress;
        if (!address) continue;
        const permissionGranted = await settingsManager.isWhatsappPermissionCommand(message.text?.body);
        const permissionCommand = permissionGranted ? String(message.text?.body || '').trim() : null;
        const result = await upsertCloudContact(
          { ...matchedProviderContact, ...message },
          { ...value, businessAccountId: entry.id || null },
          matchedProviderContact,
          { permissionGranted, permissionCommand }
        );
        if (!result) continue;
        if (result.permissionRequired) {
          emit('whatsapp_cloud:permission_required', {
            contactId: result.contact.id,
            providerMessageId: message.id || null,
            at: new Date().toISOString()
          });
        }
        const { contact } = result;
        if (result.created) createdContacts += 1;
        else updatedContacts += 1;
        await logsManager.create({
          channel: 'whatsapp_cloud',
          action: permissionGranted ? 'contact.permission_granted' : 'message.received',
          message: permissionGranted
            ? 'Permissao de notificacao para WhatsApp Web e Cloud recebida pelo WhatsApp Cloud'
            : 'Mensagem WhatsApp Cloud recebida',
          context: {
            contactId: contact.id,
            providerMessageId: message.id,
            type: message.type,
            ...(permissionGranted ? {
              permissionChannels: ['whatsapp_web', 'whatsapp_cloud'],
              permissionCommand,
              permissionReceivedVia: 'whatsapp_cloud'
            } : {})
          }
        });
        const timestampMs = Number(message.timestamp) * 1000;
        emit('whatsapp_cloud:message', {
          contactId: contact.id,
          providerMessageId: message.id || null,
          from: address,
          type: message.type || 'unknown',
          text: message.text?.body ? String(message.text.body).slice(0, 2000) : null,
          sentAt: Number.isFinite(timestampMs) && timestampMs > 0 ? new Date(timestampMs).toISOString() : new Date().toISOString()
        });
      }
      for (const receipt of value.statuses || []) {
        receivedStatuses += 1;
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
      }
    }
  }
  const summary = { receivedMessages, receivedStatuses, createdContacts, updatedContacts, at: new Date().toISOString() };
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

async function send(input) {
  const destinationCount = [input.contactId, input.groupId, input.destination].filter(Boolean).length;
  if (destinationCount !== 1) {
    throw new ApiError(422, 'Informe exatamente um destino', null, 'INVALID_DESTINATION_SELECTION');
  }
  if (input.groupId) throw new ApiError(422, 'Envio direto do WhatsApp Cloud nao aceita groupId', null, 'GROUP_DESTINATION_UNSUPPORTED');

  let destination;
  if (input.contactId) {
    destination = (await contactsManager.getDestination(input.contactId, 'whatsapp_cloud')).address;
  } else {
    destination = input.destination;
  }
  if (destination && !input.contactId && !input.allowUnconsented) {
    const known = await contactsManager.findByChannelAddress('whatsapp_cloud', destination);
    if (!known) throw new ApiError(403, 'Destino WhatsApp nao cadastrado/autorizado', null, 'UNKNOWN_DESTINATION');
    destination = (await contactsManager.getDestination(known.id, 'whatsapp_cloud')).address;
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
  const config = await sendConfiguration();
  const response = await fetch('https://graph.facebook.com/' + config.version + '/' + config.phoneNumberId + '/messages', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + config.accessToken, 'content-type': 'application/json' },
    body: JSON.stringify({ ...message, messaging_product: 'whatsapp', recipient_type: 'individual', to: destination }),
    signal: AbortSignal.timeout(20_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      502,
      body.error?.message || 'Falha na API do WhatsApp',
      { ...(body.error || {}), providerHttpStatus: response.status },
      'WHATSAPP_CLOUD_ERROR'
    );
  }
  const messageId = body.messages?.[0]?.id;
  if (input.useCase !== 'profile_auth') {
    await logsManager.create({ channel: 'whatsapp_cloud', action: 'message.sent', message: 'Mensagem WhatsApp Cloud enviada', context: { contactId: input.contactId, providerMessageId: messageId } });
  }
  return { providerMessageId: messageId, raw: body };
}

module.exports = {
  status,
  templatePresets,
  verifyChallenge,
  webhook,
  send,
  normalizeMetaDestination,
  cloudIdentity,
  cloudLogicalId,
  cloudProfile,
  upsertCloudContact,
  matchingCloudContact,
  sameProviderUser
};
