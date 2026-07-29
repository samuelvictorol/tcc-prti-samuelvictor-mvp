const nodemailer = require('nodemailer');
const settingsManager = require('./settings.manager');
const contactsManager = require('./contacts.manager');
const logsManager = require('./logs.manager');
const { searchHash } = require('../services/crypto.service');
const ApiError = require('../utils/api-error');

let cached;
let cachedSignature;

async function configuration() {
  const [user, pass, from, fromName] = await Promise.all([
    settingsManager.getValue('GMAIL_USER'),
    settingsManager.getValue('GMAIL_APP_PASSWORD'),
    settingsManager.getValue('GMAIL_FROM'),
    settingsManager.getValue('GMAIL_FROM_NAME')
  ]);
  if (!user || !pass || !from) throw new ApiError(503, 'Gmail nao configurado', null, 'CHANNEL_NOT_CONFIGURED');
  return { user, pass, from: fromName ? fromName + ' <' + from + '>' : from };
}

async function transport() {
  const config = await configuration();
  const signature = searchHash(config.user + ':' + config.pass);
  if (!cached || cachedSignature !== signature) {
    cached = nodemailer.createTransport({ service: 'gmail', auth: { user: config.user, pass: config.pass } });
    cachedSignature = signature;
  }
  return { transporter: cached, config };
}

async function status(options = {}) {
  const configured = await settingsManager.channelConfigured('email');
  if (!configured || !options.probe) return { configured };
  try {
    const { transporter } = await transport();
    await transporter.verify();
    return { configured: true, reachable: true };
  } catch (error) {
    return { configured: true, reachable: false, error: error.message };
  }
}

async function send(input) {
  const destinationCount = [input.contactId, input.groupId, input.destination].filter(Boolean).length;
  if (destinationCount !== 1) {
    throw new ApiError(422, 'Informe exatamente um destino', null, 'INVALID_DESTINATION_SELECTION');
  }
  if (input.groupId) throw new ApiError(422, 'Envio direto do Gmail nao aceita groupId', null, 'GROUP_DESTINATION_UNSUPPORTED');

  let destination;
  if (input.contactId) {
    destination = (await contactsManager.getDestination(input.contactId, 'email')).address;
  } else {
    destination = input.destination;
  }
  if (destination && !input.contactId && !input.allowUnconsented) {
    const known = await contactsManager.findByChannelAddress('email', destination);
    if (!known) throw new ApiError(403, 'Email nao cadastrado/autorizado', null, 'UNKNOWN_DESTINATION');
    destination = (await contactsManager.getDestination(known.id, 'email')).address;
  }
  if (!destination) throw new ApiError(422, 'Email de destino obrigatorio');
  const { transporter, config } = await transport();
  const info = await transporter.sendMail({
    from: config.from,
    to: destination,
    subject: input.subject || 'Notificacao',
    text: input.text || undefined,
    html: input.html || undefined
  });
  if (!['profile_auth', 'chat_email_verification'].includes(input.useCase)) {
    await logsManager.create({
      channel: 'email',
      action: 'message.sent',
      message: 'Email enviado',
      context: {
        contactId: input.contactId,
        notificationId: input.notificationId,
        deliveryId: input.deliveryId,
        messageId: info.messageId
      }
    }).catch(() => undefined);
  }
  return { providerMessageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
}

module.exports = { status, send };
