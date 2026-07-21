const Notification = require('../models/notification.model');
const { NOTIFICATION_STATUS, DELIVERY_STATUS } = require('../enums/notification');
const { DELIVERY_CHANNELS } = require('../enums/channels');
const contactsManager = require('./contacts.manager');
const groupsManager = require('./groups.manager');
const templatesManager = require('./templates.manager');
const logsManager = require('./logs.manager');
const telegramManager = require('./telegram.manager');
const gmailManager = require('./gmail.manager');
const whatsappCloudManager = require('./whatsapp-cloud.manager');
const whatsappWebManager = require('./whatsapp-web.manager');
const { enqueueNotification } = require('../services/queue.service');
const { parsePagination, pageResult } = require('../utils/pagination');
const ApiError = require('../utils/api-error');
const { officialTemplateInputForPreset } = require('../utils/whatsapp-cloud-templates');

const channelManagers = {
  telegram: telegramManager,
  email: gmailManager,
  whatsapp_cloud: whatsappCloudManager,
  whatsapp_web: whatsappWebManager
};

const CHANNEL_SKIP_CODES = new Set([
  'CHANNEL_NOT_CONFIGURED',
  'CHANNEL_NOT_READY',
  'CHANNEL_STATUS_UNAVAILABLE',
  'WHATSAPP_WEB_NOT_READY',
  'WHATSAPP_WEB_SESSION_EXPIRED'
]);

async function channelAvailability(channel) {
  const manager = channelManagers[channel];
  if (!manager?.status) {
    return { available: false, errorCode: 'CHANNEL_ADAPTER_MISSING', errorMessage: 'Adaptador de canal ausente' };
  }
  try {
    const state = await manager.status();
    if (!state?.configured) {
      return { available: false, errorCode: 'CHANNEL_NOT_CONFIGURED', errorMessage: 'Canal nao configurado' };
    }
    if (channel === 'whatsapp_web' && !state.ready) {
      return { available: false, errorCode: 'CHANNEL_NOT_READY', errorMessage: 'Sessao do WhatsApp Web nao esta pronta' };
    }
    return { available: true };
  } catch (error) {
    return {
      available: false,
      errorCode: 'CHANNEL_STATUS_UNAVAILABLE',
      errorMessage: String(error.message || 'Nao foi possivel verificar o canal').slice(0, 1000)
    };
  }
}

function interpolate(value, contact, variables = {}) {
  if (typeof value === 'string') {
    return value.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key) => {
      const allowed = {
        displayName: contact.displayName,
        email: contact.email,
        phone: contact.phone,
        telegramUsername: contact.telegramUsername,
        ...variables
      };
      return allowed[key] === undefined || allowed[key] === null ? '' : String(allowed[key]);
    });
  }
  if (Array.isArray(value)) return value.map((item) => interpolate(item, contact, variables));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, interpolate(child, contact, variables)]));
  return value;
}

async function recipients(contactIds, groupIds) {
  const fromGroups = await groupsManager.expandContactIds(groupIds);
  return [...new Set([...(contactIds || []).map(String), ...fromGroups])];
}

async function buildDeliveries(contactIds, channel, template) {
  const deliveries = [];
  const selectedChannels = channel === 'global' ? DELIVERY_CHANNELS : [channel];
  const availability = new Map(await Promise.all(selectedChannels.map(async (selectedChannel) => [
    selectedChannel,
    await channelAvailability(selectedChannel)
  ])));
  for (const contactId of contactIds) {
    let contact;
    try {
      contact = await contactsManager.getById(contactId);
    } catch (error) {
      if (error.statusCode !== 404) throw error;
      for (const selectedChannel of selectedChannels) {
        deliveries.push({
          contact: contactId,
          channel: selectedChannel,
          status: DELIVERY_STATUS.SKIPPED,
          errorCode: 'CONTACT_NOT_FOUND',
          errorMessage: 'Contato nao encontrado'
        });
      }
      continue;
    }
    for (const selectedChannel of selectedChannels) {
      let skip;
      if (!contact.active || contact.notificationDisabled) {
        skip = { errorCode: 'CONTACT_DISABLED', errorMessage: 'Contato desativado para notificacoes' };
      } else if (!availability.get(selectedChannel).available) {
        skip = availability.get(selectedChannel);
      }
      const identity = contact.channels.find((item) => item.channel === selectedChannel && item.authorized && item.consentStatus === 'granted');
      if (!skip && !identity) {
        skip = { errorCode: 'CHANNEL_NOT_AUTHORIZED', errorMessage: 'Contato nao autorizou este canal' };
      } else if (!skip && channel === 'global' && template?.variants && !template.variants[selectedChannel]) {
        skip = { errorCode: 'TEMPLATE_VARIANT_MISSING', errorMessage: 'Template nao possui variante para este canal' };
      }
      deliveries.push({
        contact: contactId,
        channel: selectedChannel,
        status: skip ? DELIVERY_STATUS.SKIPPED : DELIVERY_STATUS.QUEUED,
        errorCode: skip?.errorCode,
        errorMessage: skip?.errorMessage
      });
    }
  }
  return deliveries;
}

async function create(input, actorId) {
  let template = null;
  if (input.templateId) {
    template = await templatesManager.getById(input.templateId);
    if (input.kind === 'global' && template.channel !== 'global') throw new ApiError(422, 'Notificacao global exige template global');
    if (input.kind !== 'global' && template.channel !== input.channel) throw new ApiError(422, 'Canal do template difere da notificacao');
  }
  if (input.kind === 'global' && input.channel !== 'global') throw new ApiError(422, 'Notificacao global exige channel=global');
  const contactIds = await recipients(input.contactIds, input.groupIds);
  if (!contactIds.length) throw new ApiError(422, 'Nenhum contato encontrado nos destinatarios');
  const deliveries = await buildDeliveries(contactIds, input.channel, template);
  const queuedCount = deliveries.filter((delivery) => delivery.status === DELIVERY_STATUS.QUEUED).length;
  const skippedCount = deliveries.filter((delivery) => delivery.status === DELIVERY_STATUS.SKIPPED).length;
  try {
    const notification = await Notification.create({
      kind: input.kind,
      channel: input.channel,
      template: input.templateId,
      content: input.content,
      recipientContacts: input.contactIds,
      recipientGroups: input.groupIds,
      deliveries,
      status: queuedCount ? NOTIFICATION_STATUS.QUEUED : NOTIFICATION_STATUS.FAILED,
      idempotencyKey: input.idempotencyKey,
      requestedBy: actorId,
      completedAt: queuedCount ? undefined : new Date(),
      summary: { queued: queuedCount, sent: 0, failed: 0, skipped: skippedCount }
    });
    if (queuedCount) {
      try {
        await enqueueNotification({ notificationId: String(notification._id) });
      } catch (enqueueError) {
        notification.status = NOTIFICATION_STATUS.FAILED;
        await notification.save();
        await logsManager.create({ level: 'error', channel: input.channel, action: 'notification.enqueue_failed', message: 'Falha ao enfileirar notificacao', context: { notificationId: String(notification._id), error: enqueueError.message }, actor: actorId }).catch(() => undefined);
        throw new ApiError(503, 'Falha ao enfileirar; notificacao preservada para retry', { notificationId: String(notification._id), recoverable: true }, 'QUEUE_UNAVAILABLE');
      }
    }
    await logsManager.create({
      channel: input.channel,
      action: queuedCount ? 'notification.queued' : 'notification.skipped',
      message: queuedCount ? 'Notificacao enfileirada' : 'Notificacao sem canais elegiveis',
      context: { notificationId: String(notification._id), queued: queuedCount, skipped: skippedCount },
      actor: actorId
    });
    return { ...notification.toObject(), queuedCount };
  } catch (error) {
    if (error.code === 11000 && input.idempotencyKey) {
      const existing = await Notification.findOne({ idempotencyKey: input.idempotencyKey }).lean();
      return { ...existing, queuedCount: existing.summary?.queued || 0, idempotentReplay: true };
    }
    throw error;
  }
}

function templateContent(template, channel) {
  const content = template.channel === 'global' ? { ...(template.variants?.[channel] || {}) } : {
    subject: template.subject,
    text: template.body,
    body: template.body,
    html: template.html,
    payload: template.payload,
    templateName: template.externalTemplateName,
    languageCode: template.languageCode
  };
  content.text ||= content.body || content.payload?.text;
  content.body ||= content.text;
  content.components ||= content.payload?.components;
  if (channel === 'whatsapp_cloud' && template.whatsappCloudPreset) {
    content.officialTemplate = officialTemplateInputForPreset(template.whatsappCloudPreset);
  }
  return content;
}

async function dispatchDelivery(notification, delivery, template) {
  const contact = await contactsManager.getById(delivery.contact);
  const base = template ? templateContent(template, delivery.channel) : notification.content || {};
  const content = interpolate(base, contact, notification.content?.variables || {});
  const manager = channelManagers[delivery.channel];
  if (!manager) throw new ApiError(500, 'Adaptador de canal ausente: ' + delivery.channel);
  return manager.send({ contactId: String(delivery.contact), ...content });
}

function permanentDeliveryError(error) {
  if (['CONTACT_DISABLED', 'CHANNEL_NOT_AUTHORIZED', 'UNKNOWN_DESTINATION'].includes(error.code) || CHANNEL_SKIP_CODES.has(error.code)) return true;
  if ([400, 401, 403, 404, 409, 422].includes(error.statusCode)) return true;
  const providerStatus = error.details?.providerErrorCode || error.details?.error_code || error.responseCode;
  return providerStatus >= 400 && providerStatus < 500 && ![421, 429].includes(providerStatus);
}

async function dispatchWithRetry(notification, delivery, template) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    delivery.attempts += 1;
    try {
      return await dispatchDelivery(notification, delivery, template);
    } catch (error) {
      lastError = error;
      if (permanentDeliveryError(error) || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
    }
  }
  throw lastError;
}

async function processJob({ notificationId }) {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, status: NOTIFICATION_STATUS.QUEUED },
    { $set: { status: NOTIFICATION_STATUS.PROCESSING, startedAt: new Date() } },
    { new: true }
  );
  if (!notification) return { ignored: true };
  try {
  let template = null;
  if (notification.template) template = await templatesManager.getById(notification.template);
  const currentlyEligibleRecipients = new Set(await recipients(notification.recipientContacts.map(String), notification.recipientGroups.map(String)));
  const availability = new Map();
  for (const delivery of notification.deliveries) {
    if (delivery.status !== DELIVERY_STATUS.QUEUED) continue;
    if (!currentlyEligibleRecipients.has(String(delivery.contact))) {
      delivery.status = DELIVERY_STATUS.SKIPPED;
      delivery.errorCode = 'RECIPIENT_SCOPE_CHANGED';
      delivery.errorMessage = 'Contato saiu do grupo ou grupo foi removido antes do envio';
      await notification.save();
      continue;
    }
    if (!availability.has(delivery.channel)) availability.set(delivery.channel, await channelAvailability(delivery.channel));
    const currentAvailability = availability.get(delivery.channel);
    if (!currentAvailability.available) {
      delivery.status = DELIVERY_STATUS.SKIPPED;
      delivery.errorCode = currentAvailability.errorCode;
      delivery.errorMessage = currentAvailability.errorMessage;
      await notification.save();
      continue;
    }
    delivery.status = DELIVERY_STATUS.PROCESSING;
    try {
      const result = await dispatchWithRetry(notification, delivery, template);
      delivery.status = DELIVERY_STATUS.SENT;
      delivery.providerMessageId = result.providerMessageId;
      delivery.sentAt = new Date();
      delivery.errorCode = undefined;
      delivery.errorMessage = undefined;
    } catch (error) {
      const skipped = ['CONTACT_DISABLED', 'CHANNEL_NOT_AUTHORIZED'].includes(error.code) || CHANNEL_SKIP_CODES.has(error.code) || error.statusCode === 404;
      delivery.status = skipped ? DELIVERY_STATUS.SKIPPED : DELIVERY_STATUS.FAILED;
      delivery.errorCode = error.code || 'DELIVERY_ERROR';
      delivery.errorMessage = String(error.message).slice(0, 1000);
    }
    await notification.save();
  }
  const counts = notification.deliveries.reduce((result, delivery) => {
    result[delivery.status] = (result[delivery.status] || 0) + 1;
    return result;
  }, {});
  notification.summary = { queued: counts.queued || 0, sent: counts.sent || 0, failed: counts.failed || 0, skipped: counts.skipped || 0 };
  notification.completedAt = new Date();
  if (counts.sent && counts.failed) notification.status = NOTIFICATION_STATUS.PARTIAL;
  else if (counts.sent) notification.status = NOTIFICATION_STATUS.SENT;
  else notification.status = NOTIFICATION_STATUS.FAILED;
  await notification.save();
  await logsManager.create({ channel: notification.channel, action: 'notification.completed', message: 'Processamento de notificacao concluido', context: { notificationId, summary: notification.summary } });
  return notification.toObject();
  } catch (error) {
    for (const delivery of notification.deliveries) {
      if (delivery.status === DELIVERY_STATUS.PROCESSING) delivery.status = DELIVERY_STATUS.QUEUED;
    }
    notification.status = NOTIFICATION_STATUS.QUEUED;
    notification.startedAt = undefined;
    await notification.save().catch(() => undefined);
    await logsManager.create({ level: 'error', channel: notification.channel, action: 'notification.processing_recovered', message: 'Processamento interrompido; notificacao retornou para fila', context: { notificationId, error: error.message } }).catch(() => undefined);
    throw error;
  }
}

async function recoverStale(maxAgeMs = 10 * 60 * 1000) {
  const stale = await Notification.find({
    status: NOTIFICATION_STATUS.PROCESSING,
    startedAt: { $lt: new Date(Date.now() - maxAgeMs) }
  });
  let recovered = 0;
  for (const notification of stale) {
    for (const delivery of notification.deliveries) {
      if (delivery.status === DELIVERY_STATUS.PROCESSING) delivery.status = DELIVERY_STATUS.QUEUED;
    }
    notification.status = NOTIFICATION_STATUS.QUEUED;
    notification.startedAt = undefined;
    await notification.save();
    await enqueueNotification({ notificationId: String(notification._id), jobId: String(notification._id) + '-recovery-' + Date.now() });
    recovered += 1;
  }
  return { recovered };
}

async function getById(id) {
  const notification = await Notification.findById(id).lean();
  if (!notification) throw new ApiError(404, 'Notificacao nao encontrada');
  return notification;
}

async function list(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.channel) filter.channel = query.channel;
  const [items, total] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter)
  ]);
  return pageResult(items, total, page, limit);
}

async function stats() {
  const [byStatus, byChannel, totals] = await Promise.all([
    Notification.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Notification.aggregate([{ $group: { _id: '$channel', count: { $sum: 1 } } }]),
    Notification.aggregate([{ $group: { _id: null, notifications: { $sum: 1 }, queued: { $sum: '$summary.queued' }, sent: { $sum: '$summary.sent' }, failed: { $sum: '$summary.failed' }, skipped: { $sum: '$summary.skipped' } } }])
  ]);
  return {
    totals: totals[0] || { notifications: 0, queued: 0, sent: 0, failed: 0, skipped: 0 },
    byStatus: Object.fromEntries(byStatus.map((item) => [item._id, item.count])),
    byChannel: Object.fromEntries(byChannel.map((item) => [item._id, item.count]))
  };
}

async function retry(id) {
  const notification = await Notification.findById(id);
  if (!notification) throw new ApiError(404, 'Notificacao nao encontrada');
  for (const delivery of notification.deliveries) {
    if (delivery.status === DELIVERY_STATUS.FAILED || delivery.status === DELIVERY_STATUS.SKIPPED && CHANNEL_SKIP_CODES.has(delivery.errorCode)) {
      delivery.status = DELIVERY_STATUS.QUEUED;
      delivery.errorCode = undefined;
      delivery.errorMessage = undefined;
    }
  }
  if (!notification.deliveries.some((item) => item.status === DELIVERY_STATUS.QUEUED)) throw new ApiError(409, 'Nao ha entregas com falha para repetir');
  notification.status = NOTIFICATION_STATUS.QUEUED;
  notification.completedAt = undefined;
  await notification.save();
  try {
    await enqueueNotification({ notificationId: String(notification._id), jobId: String(notification._id) + '-retry-' + Date.now() });
  } catch (error) {
    notification.status = NOTIFICATION_STATUS.FAILED;
    await notification.save();
    throw new ApiError(503, 'Fila indisponivel; retry pode ser solicitado novamente', { notificationId: String(notification._id), recoverable: true }, 'QUEUE_UNAVAILABLE');
  }
  return notification.toObject();
}

async function cancel(id) {
  const notification = await Notification.findOne({ _id: id, status: { $in: [NOTIFICATION_STATUS.QUEUED, NOTIFICATION_STATUS.DRAFT] } });
  if (!notification) throw new ApiError(409, 'Apenas notificacoes ainda nao iniciadas podem ser canceladas');
  notification.status = NOTIFICATION_STATUS.CANCELLED;
  for (const delivery of notification.deliveries) if (delivery.status === DELIVERY_STATUS.QUEUED) delivery.status = DELIVERY_STATUS.SKIPPED;
  await notification.save();
  return notification.toObject();
}

module.exports = {
  create,
  processJob,
  recoverStale,
  getById,
  list,
  stats,
  retry,
  cancel,
  buildDeliveries,
  channelAvailability,
  normalizeTemplateContent: templateContent
};
