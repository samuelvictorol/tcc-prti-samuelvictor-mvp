const crypto = require('node:crypto');
const settingsManager = require('./settings.manager');
const contactsManager = require('./contacts.manager');
const logsManager = require('./logs.manager');
const { timingSafeEqual } = require('../services/crypto.service');
const { env } = require('../config/env');
const { emit } = require('../services/socket.service');
const ApiError = require('../utils/api-error');
const { buildOfficialTemplateMessage, listTemplatePresets } = require('../utils/whatsapp-cloud-templates');

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

async function webhook(payload, rawBody, signature) {
  await verifySignature(rawBody, signature);
  let receivedMessages = 0;
  let receivedStatuses = 0;
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const message of value.messages || []) {
        receivedMessages += 1;
        const profile = (value.contacts || []).find((item) => item.wa_id === message.from)?.profile;
        const contact = await contactsManager.upsertFromChannel({
          channel: 'whatsapp_cloud', address: message.from, displayName: profile?.name || message.from,
          source: 'whatsapp_cloud_webhook', metadata: { messageType: message.type, phoneNumberId: value.metadata?.phone_number_id }
        });
        await logsManager.create({ channel: 'whatsapp_cloud', action: 'message.received', message: 'Mensagem WhatsApp Cloud recebida', context: { contactId: contact.id, providerMessageId: message.id, type: message.type } });
      }
      for (const receipt of value.statuses || []) {
        receivedStatuses += 1;
        await logsManager.create({ channel: 'whatsapp_cloud', action: 'message.status', message: 'Status de mensagem WhatsApp atualizado', context: { providerMessageId: receipt.id, status: receipt.status } });
      }
    }
  }
  emit('whatsapp_cloud:webhook', { receivedMessages, receivedStatuses, at: new Date().toISOString() });
  return { received: true };
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
  const config = await sendConfiguration();
  let destination = input.destination;
  if (!destination && input.contactId) destination = (await contactsManager.getDestination(input.contactId, 'whatsapp_cloud')).address;
  if (destination && !input.contactId && !input.allowUnconsented) {
    const known = await contactsManager.findByChannelAddress('whatsapp_cloud', destination);
    if (!known) throw new ApiError(403, 'Destino WhatsApp nao cadastrado/autorizado', null, 'UNKNOWN_DESTINATION');
    destination = (await contactsManager.getDestination(known.id, 'whatsapp_cloud')).address;
  }
  if (!destination) throw new ApiError(422, 'Destino WhatsApp obrigatorio');
  destination = normalizeMetaDestination(destination);
  let message;
  if (input.officialTemplate) {
    message = buildOfficialTemplateMessage(input.officialTemplate);
  } else if (input.templateName) {
    const template = { name: input.templateName, language: { code: input.languageCode || 'pt_BR' } };
    if (input.components?.length) template.components = input.components;
    message = {
      type: 'template',
      template
    };
  } else if (input.payload) {
    message = input.payload;
  } else {
    if (!input.text) throw new ApiError(422, 'Texto ou template obrigatorio');
    message = { type: 'text', text: { body: input.text, preview_url: false } };
  }
  const response = await fetch('https://graph.facebook.com/' + config.version + '/' + config.phoneNumberId + '/messages', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + config.accessToken, 'content-type': 'application/json' },
    body: JSON.stringify({ ...message, messaging_product: 'whatsapp', recipient_type: 'individual', to: destination }),
    signal: AbortSignal.timeout(20_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(502, body.error?.message || 'Falha na API do WhatsApp', body.error, 'WHATSAPP_CLOUD_ERROR');
  const messageId = body.messages?.[0]?.id;
  await logsManager.create({ channel: 'whatsapp_cloud', action: 'message.sent', message: 'Mensagem WhatsApp Cloud enviada', context: { contactId: input.contactId, providerMessageId: messageId } });
  return { providerMessageId: messageId, raw: body };
}

module.exports = { status, templatePresets, verifyChallenge, webhook, send, normalizeMetaDestination };
