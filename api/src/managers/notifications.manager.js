const Notification = require('../models/notification.model');
const ProviderReceipt = require('../models/provider-receipt.model');
const { NOTIFICATION_STATUS, DELIVERY_STATUS } = require('../enums/notification');
const { CHANNELS } = require('../enums/channels');
const contactsManager = require('./contacts.manager');
const groupsManager = require('./groups.manager');
const templatesManager = require('./templates.manager');
const logsManager = require('./logs.manager');
const telegramManager = require('./telegram.manager');
const gmailManager = require('./gmail.manager');
const whatsappCloudManager = require('./whatsapp-cloud.manager');
const queueService = require('../services/queue.service');
const { createHash, randomUUID } = require('node:crypto');
const { parsePagination, pageResult } = require('../utils/pagination');
const ApiError = require('../utils/api-error');
const { officialTemplateInputForPreset } = require('../utils/whatsapp-cloud-templates');

const channelManagers = {
  telegram: telegramManager,
  email: gmailManager,
  whatsapp_cloud: whatsappCloudManager
};

const NOTIFICATION_DELIVERY_CHANNELS = Object.freeze([CHANNELS.TELEGRAM, CHANNELS.WHATSAPP_CLOUD, CHANNELS.EMAIL]);
const MAX_DELIVERY_ATTEMPTS = 4;
const MAX_NOTIFICATION_RECIPIENTS = 10_000;
const MAX_NOTIFICATION_DELIVERIES = 10_000;
const MAX_LIST_DELIVERY_SUMMARIES = 1_000;
const MAX_DELIVERY_ERROR_LENGTH = 500;
const STALE_PROCESSING_MAX_AGE_MS = 2 * 60 * 1000;

const CHANNEL_SKIP_CODES = new Set([
  'CHANNEL_NOT_CONFIGURED',
  'CHANNEL_NOT_READY'
]);

const TRANSIENT_PROVIDER_CODES = new Set([
  1, 2, 4, 17, 32, 341, 613, 80007,
  130429, 131000, 131016, 131048, 131056
]);
const SUCCESS_DELIVERY_STATUSES = new Set([
  DELIVERY_STATUS.SENT,
  DELIVERY_STATUS.DELIVERED,
  DELIVERY_STATUS.READ
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
    return { available: true };
  } catch (error) {
    return {
      available: false,
      retryable: true,
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

async function recipients(contactIds, groupIds, options = {}) {
  const fromGroups = await groupsManager.expandContactIds(groupIds, options);
  return [...new Set([...(contactIds || []).map(String), ...fromGroups])];
}

async function scheduleNotification(notificationId, options = {}) {
  try {
    const queued = await queueService.enqueueNotification({
      notificationId,
      jobId: options.jobId,
      delayMs: options.delayMs
    });
    const scheduledAt = new Date();
    await Notification.updateOne(
      { _id: notificationId, status: NOTIFICATION_STATUS.QUEUED, enqueuePending: true },
      {
        $set: { enqueuePending: false, queueScheduledAt: scheduledAt },
        $unset: { errorCode: 1, errorMessage: 1 }
      }
    ).catch((error) => logsManager.create({
      level: 'warn',
      channel: 'global',
      action: 'notification.queue_marker_failed',
      message: 'Job enfileirado, mas marcador de fila permaneceu pendente',
      context: { notificationId, error: error.message }
    }).catch(() => undefined));
    return { scheduled: true, scheduledAt, queued };
  } catch (error) {
    const errorMessage = String(error.message || 'Fila indisponivel').slice(0, 1000);
    await Notification.updateOne(
      { _id: notificationId, status: NOTIFICATION_STATUS.QUEUED },
      {
        $set: {
          enqueuePending: true,
          errorCode: 'QUEUE_UNAVAILABLE',
          errorMessage
        },
        $unset: { queueScheduledAt: 1 }
      }
    ).catch(() => undefined);
    await logsManager.create({
      level: 'error',
      channel: 'global',
      action: 'notification.enqueue_failed',
      message: 'Notificacao preservada para recuperacao da fila',
      context: { notificationId, error: errorMessage }
    }).catch(() => undefined);
    return { scheduled: false, error, errorMessage };
  }
}

function hasCloudTemplateDefinition(content) {
  return Boolean(
    content?.templateName || content?.externalTemplateName || content?.officialTemplate || content?.customTemplate
    || content?.whatsappCloudPreset || content?.payload?.builder
  );
}

function deliverySummary(delivery) {
  const value = delivery?.toObject ? delivery.toObject() : delivery;
  const contactId = String(value.contact?._id || value.contact);
  return {
    contactId,
    contactPath: '/contacts/' + contactId,
    channel: value.channel,
    status: value.status,
    attempts: value.attempts || 0,
    errorCode: value.errorCode || null,
    errorMessage: value.errorMessage || null
  };
}

function deliveryIssueLog(notification, delivery) {
  if (![DELIVERY_STATUS.QUEUED, DELIVERY_STATUS.FAILED, DELIVERY_STATUS.SKIPPED].includes(delivery.status)) return null;
  const statusMeta = {
    [DELIVERY_STATUS.QUEUED]: {
      level: 'warn',
      action: 'notification.delivery.retry_pending',
      message: 'Entrega individual aguardando nova tentativa'
    },
    [DELIVERY_STATUS.FAILED]: {
      level: 'error',
      action: 'notification.delivery.failed',
      message: 'Entrega individual falhou'
    },
    [DELIVERY_STATUS.SKIPPED]: {
      level: 'warn',
      action: 'notification.delivery.skipped',
      message: 'Entrega individual ignorada'
    }
  }[delivery.status];
  return {
    ...statusMeta,
    channel: delivery.channel,
    context: {
      notificationId: String(notification._id),
      deliveryId: delivery._id ? String(delivery._id) : null,
      contactId: String(delivery.contact?._id || delivery.contact),
      status: delivery.status,
      attempts: Number(delivery.attempts || 0),
      errorCode: delivery.errorCode || null
    },
    actor: notification.requestedBy || undefined,
    // O detalhe duravel fica na notificacao. O evento operacional nao inclui
    // endereco nem conteudo e usa retencao menor para controlar volume.
    retentionUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  };
}

async function recordDeliveryIssues(notification, deliveries = []) {
  const inputs = deliveries.map((delivery) => deliveryIssueLog(notification, delivery)).filter(Boolean);
  const batchSize = 20;
  for (let offset = 0; offset < inputs.length; offset += batchSize) {
    await Promise.allSettled(inputs.slice(offset, offset + batchSize).map((input) => logsManager.create(input)));
  }
}

function summarizeDeliveries(deliveries = []) {
  const counts = deliveries.reduce((result, delivery) => {
    result[delivery.status] = (result[delivery.status] || 0) + 1;
    return result;
  }, {});
  return {
    queued: (counts[DELIVERY_STATUS.QUEUED] || 0) + (counts[DELIVERY_STATUS.PROCESSING] || 0),
    sent: (counts[DELIVERY_STATUS.SENT] || 0) + (counts[DELIVERY_STATUS.DELIVERED] || 0) + (counts[DELIVERY_STATUS.READ] || 0),
    failed: counts[DELIVERY_STATUS.FAILED] || 0,
    skipped: counts[DELIVERY_STATUS.SKIPPED] || 0
  };
}

function serializeNotification(notification, options = {}) {
  const value = notification?.toObject ? notification.toObject() : notification;
  const publicValue = { ...value };
  delete publicValue.processingJobId;
  delete publicValue.processingToken;
  delete publicValue.processingHeartbeatAt;
  delete publicValue.$where;
  delete publicValue.deliveries;
  const deliveries = (value.deliveries || []).map(deliverySummary);
  const summaryEligible = Number(value.summary?.queued || 0) + Number(value.summary?.sent || 0);
  const summaryIneligible = Number(value.summary?.skipped || 0) + Number(value.summary?.failed || 0);
  const summaryTotal = summaryEligible + summaryIneligible;
  const useSummary = summaryTotal > deliveries.length || deliveries.length === 0;
  const eligibleCount = useSummary
    ? summaryEligible
    : deliveries.filter((delivery) => ['queued', 'processing', 'sent', 'delivered', 'read'].includes(delivery.status)).length;
  const ineligibleCount = useSummary
    ? summaryIneligible
    : deliveries.filter((delivery) => ['skipped', 'failed'].includes(delivery.status)).length;
  const deliveryCount = Math.max(summaryTotal, deliveries.length);
  const includeDeliveries = options.includeDeliveries !== false;
  return {
    ...publicValue,
    ...(includeDeliveries ? {
      deliveries,
      deliveryDetails: {
        total: deliveryCount,
        returned: deliveries.length,
        truncated: deliveryCount > deliveries.length
      }
    } : {}),
    eligibility: {
      eligibleCount,
      ineligibleCount
    }
  };
}

function notificationChannels(channel, kind, templateIds = {}) {
  const requestedGlobalChannels = NOTIFICATION_DELIVERY_CHANNELS.filter((selectedChannel) => templateIds?.[selectedChannel]);
  let selectedChannels = channel === 'global'
    ? (kind === 'global' && requestedGlobalChannels.length ? requestedGlobalChannels : [...NOTIFICATION_DELIVERY_CHANNELS])
    : [channel];
  if (channel === 'global' && kind === 'quick') {
    selectedChannels = selectedChannels.filter((selectedChannel) => selectedChannel !== CHANNELS.WHATSAPP_CLOUD);
  }
  return selectedChannels;
}

async function buildDeliveries(contactIds, channel, template, options = {}) {
  const deliveries = [];
  const selectedChannels = notificationChannels(channel, options.kind, options.templateIds);
  const availability = new Map(await Promise.all(selectedChannels.map(async (selectedChannel) => [
    selectedChannel,
    await channelAvailability(selectedChannel)
  ])));
  const contacts = await contactsManager.getManyByIds(contactIds);
  const contactsById = new Map(contacts.map((contact) => [String(contact.id), contact]));
  for (const contactId of contactIds) {
    const contact = contactsById.get(String(contactId));
    if (!contact) {
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
      } else if (!availability.get(selectedChannel).available && !availability.get(selectedChannel).retryable) {
        skip = availability.get(selectedChannel);
      }
      const identity = contact.channels.find((item) => item.channel === selectedChannel && item.authorized && item.consentStatus === 'granted');
      if (!skip && !identity) {
        skip = { errorCode: 'CHANNEL_NOT_AUTHORIZED', errorMessage: 'Contato nao autorizou este canal' };
      }
      const selectedTemplate = options.templates?.[selectedChannel] || template;
      if (!skip && channel === 'global' && options.templates && !selectedTemplate) {
        skip = { errorCode: 'TEMPLATE_MISSING', errorMessage: 'Selecione um template para este canal' };
      } else if (!skip && channel === 'global' && template?.variants && !template.variants[selectedChannel]) {
        skip = { errorCode: 'TEMPLATE_VARIANT_MISSING', errorMessage: 'Template nao possui variante para este canal' };
      } else if (!skip && selectedChannel === CHANNELS.WHATSAPP_CLOUD && selectedTemplate?.channel === 'global'
        && !hasCloudTemplateDefinition(template.variants?.whatsapp_cloud)) {
        skip = { errorCode: 'WHATSAPP_CLOUD_TEMPLATE_INVALID', errorMessage: 'Variante WhatsApp Cloud deve usar template oficial' };
      } else if (!skip && selectedChannel === CHANNELS.WHATSAPP_CLOUD && selectedTemplate
        && selectedTemplate.channel !== 'global' && !selectedTemplate.whatsappCloudPreset) {
        skip = { errorCode: 'WHATSAPP_CLOUD_TEMPLATE_INVALID', errorMessage: 'Template WhatsApp Cloud precisa ser oficial' };
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
  if (input.kind === 'quick' && input.channel === CHANNELS.GLOBAL) {
    throw new ApiError(422, 'Disparo global exige um template por canal', null, 'GLOBAL_TEMPLATE_REQUIRED');
  }
  if (input.channel === CHANNELS.WHATSAPP_CLOUD && input.kind !== 'template') {
    throw new ApiError(422, 'WhatsApp Cloud aceita apenas template oficial', null, 'WHATSAPP_CLOUD_TEMPLATE_ONLY');
  }
  let template = null;
  const templates = {};
  if (input.templateId) {
    template = await templatesManager.getById(input.templateId);
    if (template.active === false) {
      throw new ApiError(
        422,
        'Template inativo nao pode ser usado em notificacoes',
        { templateId: String(input.templateId) },
        'TEMPLATE_INACTIVE'
      );
    }
    if (input.kind === 'global' && template.channel !== 'global') throw new ApiError(422, 'Notificacao global exige template global');
    if (input.kind !== 'global' && template.channel !== input.channel) throw new ApiError(422, 'Canal do template difere da notificacao');
    if (input.channel === CHANNELS.WHATSAPP_CLOUD && !template.whatsappCloudPreset) {
      throw new ApiError(422, 'Selecione um template oficial valido do WhatsApp Cloud', null, 'WHATSAPP_CLOUD_TEMPLATE_INVALID');
    }
  }
  if (input.kind === 'global') {
    if (input.channel !== 'global') throw new ApiError(422, 'Notificacao global exige channel=global');
    if (input.templateId) throw new ApiError(422, 'Use templateIds por canal no disparo global', null, 'GLOBAL_TEMPLATE_MAP_REQUIRED');
    const selectedEntries = Object.entries(input.templateIds || {})
      .filter(([channel, id]) => NOTIFICATION_DELIVERY_CHANNELS.includes(channel) && id);
    if (!selectedEntries.length) {
      throw new ApiError(422, 'Selecione ao menos um template por canal', null, 'GLOBAL_TEMPLATE_REQUIRED');
    }
    for (const [channel, templateId] of selectedEntries) {
      const selected = await templatesManager.getById(templateId);
      if (selected.active === false) {
        throw new ApiError(422, 'Template inativo nao pode ser usado em notificacoes', { templateId: String(templateId), channel }, 'TEMPLATE_INACTIVE');
      }
      if (selected.channel !== channel) {
        throw new ApiError(422, 'Canal do template global difere da selecao', { templateId: String(templateId), expectedChannel: channel, actualChannel: selected.channel }, 'TEMPLATE_CHANNEL_MISMATCH');
      }
      if (channel === CHANNELS.WHATSAPP_CLOUD && !selected.whatsappCloudPreset) {
        throw new ApiError(422, 'Selecione um template oficial valido do WhatsApp Cloud', { templateId: String(templateId) }, 'WHATSAPP_CLOUD_TEMPLATE_INVALID');
      }
      templates[channel] = selected;
    }
  } else if (input.channel === 'global') {
    throw new ApiError(422, 'Canal global aceita somente o modo global por templates', null, 'GLOBAL_TEMPLATE_REQUIRED');
  }
  const deliveryChannelCount = notificationChannels(input.channel, input.kind, input.templateIds).length;
  const recipientLimit = Math.min(
    MAX_NOTIFICATION_RECIPIENTS,
    Math.floor(MAX_NOTIFICATION_DELIVERIES / Math.max(1, deliveryChannelCount))
  );
  const contactIds = await recipients(input.contactIds, input.groupIds, { maxUnique: recipientLimit + 1 });
  if (!contactIds.length) throw new ApiError(422, 'Nenhum contato encontrado nos destinatarios');
  if (contactIds.length > recipientLimit) {
    throw new ApiError(
      422,
      'Quantidade total de entregas excede o limite seguro por notificacao',
      {
        deliveryLimit: MAX_NOTIFICATION_DELIVERIES,
        recipientLimit,
        recipients: contactIds.length,
        channelsPerRecipient: deliveryChannelCount
      },
      'NOTIFICATION_DELIVERY_LIMIT_EXCEEDED'
    );
  }
  const deliveries = await buildDeliveries(contactIds, input.channel, template, {
    kind: input.kind,
    templateIds: input.templateIds,
    templates: input.kind === 'global' ? templates : undefined
  });
  const queuedCount = deliveries.filter((delivery) => delivery.status === DELIVERY_STATUS.QUEUED).length;
  const skippedCount = deliveries.filter((delivery) => delivery.status === DELIVERY_STATUS.SKIPPED).length;
  try {
    const notification = await Notification.create({
      kind: input.kind,
      channel: input.channel,
      template: input.templateId,
      templates: input.kind === 'global' ? input.templateIds : undefined,
      content: input.content,
      recipientContacts: input.contactIds,
      recipientGroups: input.groupIds,
      deliveries,
      status: queuedCount ? NOTIFICATION_STATUS.QUEUED : NOTIFICATION_STATUS.FAILED,
      idempotencyKey: input.idempotencyKey,
      requestedBy: actorId,
      completedAt: queuedCount ? undefined : new Date(),
      enqueuePending: Boolean(queuedCount),
      summary: { queued: queuedCount, sent: 0, failed: 0, skipped: skippedCount }
    });
    if (skippedCount) {
      await recordDeliveryIssues(
        notification,
        notification.deliveries.filter((delivery) => delivery.status === DELIVERY_STATUS.SKIPPED)
      );
    }
    if (queuedCount) {
      const scheduling = await scheduleNotification(String(notification._id));
      if (!scheduling.scheduled) {
        notification.enqueuePending = true;
        notification.errorCode = 'QUEUE_UNAVAILABLE';
        notification.errorMessage = scheduling.errorMessage;
        throw new ApiError(503, 'Falha ao enfileirar; notificacao preservada para retry', { notificationId: String(notification._id), recoverable: true }, 'QUEUE_UNAVAILABLE');
      }
      notification.enqueuePending = false;
      notification.queueScheduledAt = scheduling.scheduledAt;
    }
    await logsManager.create({
      channel: input.channel,
      action: queuedCount ? 'notification.queued' : 'notification.skipped',
      message: queuedCount ? 'Notificacao enfileirada' : 'Notificacao sem canais elegiveis',
      context: { notificationId: String(notification._id), queued: queuedCount, skipped: skippedCount },
      actor: actorId
    });
    return { ...serializeNotification(notification, { includeDeliveries: false }), queuedCount };
  } catch (error) {
    if (error.code === 11000 && input.idempotencyKey) {
      const existing = await Notification.findOne({ idempotencyKey: input.idempotencyKey }).select('-deliveries').lean();
      return { ...serializeNotification(existing, { includeDeliveries: false }), queuedCount: existing.summary?.queued || 0, idempotentReplay: true };
    }
    throw error;
  }
}

function templateContent(template, channel) {
  const templateIdentifier = template._id || template.id;
  const content = template.channel === 'global' ? { ...(template.variants?.[channel] || {}) } : {
    subject: template.subject,
    text: template.body,
    body: template.body,
    html: template.html,
    payload: template.payload,
    templateName: template.externalTemplateName,
    languageCode: template.languageCode
  };
  content.templateId ||= templateIdentifier ? String(templateIdentifier) : undefined;
  content.templateRevision ||= template.updatedAt ? new Date(template.updatedAt).getTime().toString(36) : undefined;
  content.text ||= content.body || content.payload?.text;
  content.body ||= content.text;
  content.components ||= content.payload?.components;
  content.templateName ||= content.externalTemplateName;
  const cloudPreset = content.whatsappCloudPreset || template.whatsappCloudPreset;
  if (channel === 'whatsapp_cloud' && cloudPreset === 'custom') {
    content.customTemplate = {
      name: content.externalTemplateName || template.externalTemplateName,
      languageCode: content.languageCode || template.languageCode,
      builder: content.payload?.builder || template.payload?.builder
    };
  } else if (channel === 'whatsapp_cloud' && cloudPreset) {
    content.officialTemplate = officialTemplateInputForPreset(cloudPreset);
  }
  return content;
}

function deliveryTemplate(notification, delivery, templateOrMap) {
  if (notification.kind === 'global' && templateOrMap && !templateOrMap.channel) {
    return templateOrMap[delivery.channel] || null;
  }
  return templateOrMap;
}

async function dispatchDelivery(notification, delivery, templateOrMap) {
  const contact = await contactsManager.getById(delivery.contact);
  const template = deliveryTemplate(notification, delivery, templateOrMap);
  if (notification.kind === 'global' && templateOrMap && !templateOrMap.channel && !template) {
    throw new ApiError(422, 'Template do canal nao encontrado no disparo global', { channel: delivery.channel }, 'TEMPLATE_MISSING');
  }
  const base = template ? templateContent(template, delivery.channel) : notification.content || {};
  const variables = {
    displayName: contact.displayName,
    email: contact.email,
    phone: contact.phone,
    telegramUsername: contact.telegramUsername,
    ...(notification.content?.variables || {})
  };
  const content = interpolate(base, contact, variables);
  if (content.customTemplate) content.customTemplate.variables = variables;
  const manager = channelManagers[delivery.channel];
  if (!manager) throw new ApiError(500, 'Adaptador de canal ausente: ' + delivery.channel);
  return manager.send({
    ...content,
    contactId: String(delivery.contact),
    notificationId: String(notification._id),
    deliveryId: delivery._id ? String(delivery._id) : undefined
  });
}

function permanentDeliveryError(error) {
  if (['CONTACT_DISABLED', 'CHANNEL_NOT_AUTHORIZED', 'UNKNOWN_DESTINATION'].includes(error.code) || CHANNEL_SKIP_CODES.has(error.code)) return true;
  const providerDetails = error.details || {};
  const providerCode = Number(providerDetails.code ?? providerDetails.providerErrorCode ?? providerDetails.error_code);
  if (providerDetails.is_transient === true || providerDetails.isTransient === true || TRANSIENT_PROVIDER_CODES.has(providerCode)) return false;
  // Telegram reports its HTTP-like status inside providerErrorCode while the
  // adapter exposes a 502. These client errors cannot succeed on a retry.
  if ([400, 401, 403, 404].includes(providerCode)) return true;
  if ([400, 401, 403, 404, 409, 422].includes(error.statusCode)) return true;
  const providerHttpStatus = Number(providerDetails.providerHttpStatus);
  if (providerHttpStatus >= 400 && providerHttpStatus < 500) return ![421, 429].includes(providerHttpStatus);
  // SMTP uses 4xx for temporary failures and 5xx for permanent rejection.
  const smtpResponseCode = Number(error.responseCode);
  if (smtpResponseCode >= 400 && smtpResponseCode < 500) return false;
  if (smtpResponseCode >= 500 && smtpResponseCode < 600) return true;
  return false;
}

async function dispatchAttempt(notification, delivery, template) {
  delivery.attempts += 1;
  return dispatchDelivery(notification, delivery, template);
}

async function saveClaimed(notification, processingToken, options = {}) {
  if (processingToken) notification.$where = { processingToken };
  if (options.heartbeat !== false) notification.processingHeartbeatAt = new Date();
  return notification.save();
}

async function persistClaimedDelivery(notification, processingToken, delivery) {
  // Unit fixtures created outside Mongoose do not have subdocument ids. Real deliveries always do.
  if (!delivery?._id) return saveClaimed(notification, processingToken);
  const heartbeatAt = new Date();
  const set = {
    'deliveries.$.status': delivery.status,
    'deliveries.$.attempts': Number(delivery.attempts || 0),
    'deliveries.$.updatedAt': heartbeatAt,
    processingHeartbeatAt: heartbeatAt
  };
  const unset = {};
  for (const [field, value] of [
    ['providerMessageId', delivery.providerMessageId],
    ['errorCode', delivery.errorCode],
    ['errorMessage', delivery.errorMessage],
    ['sentAt', delivery.sentAt]
  ]) {
    const path = `deliveries.$.${field}`;
    if (value === undefined || value === null || value === '') unset[path] = 1;
    else set[path] = field === 'errorMessage' ? String(value).slice(0, MAX_DELIVERY_ERROR_LENGTH) : value;
  }
  const update = { $set: set };
  if (Object.keys(unset).length) update.$unset = unset;
  const result = await Notification.updateOne(
    {
      _id: notification._id,
      status: NOTIFICATION_STATUS.PROCESSING,
      processingToken,
      'deliveries._id': delivery._id
    },
    update
  );
  if (result.matchedCount === 0) {
    throw new ApiError(409, 'Lock de processamento da notificacao foi perdido', null, 'NOTIFICATION_PROCESSING_LOCK_LOST');
  }
  notification.processingHeartbeatAt = heartbeatAt;
  return result;
}

async function assertClaimOwnership(notificationId, processingToken, verifyOwnership) {
  if (!verifyOwnership) return;
  const owned = await Notification.exists({
    _id: notificationId,
    status: NOTIFICATION_STATUS.PROCESSING,
    processingToken
  });
  if (!owned) {
    throw new ApiError(409, 'Lock de processamento da notificacao foi perdido', null, 'NOTIFICATION_PROCESSING_LOCK_LOST');
  }
}

function processingClaim(notificationId, queueContext = {}) {
  const jobId = String(queueContext.jobId || notificationId);
  const token = String(queueContext.lockToken || randomUUID());
  const stalledRecovery = Number(queueContext.stalledCounter || 0) > 0;
  const claimable = [{ status: NOTIFICATION_STATUS.QUEUED }];
  if (stalledRecovery) {
    claimable.push({
      status: NOTIFICATION_STATUS.PROCESSING,
      $or: [
        { processingJobId: jobId },
        { processingJobId: { $exists: false } }
      ]
    });
  }
  return { jobId, token, stalledRecovery, filter: { _id: notificationId, $or: claimable } };
}

function isFinalQueueAttempt(queueContext = {}) {
  if (!queueContext.lockToken) return false;
  const maxAttempts = Math.max(1, Number(queueContext.maxAttempts || 1));
  const attemptsMade = Math.max(0, Number(queueContext.attemptsMade || 0));
  return attemptsMade + 1 >= maxAttempts;
}

async function processJob({ notificationId, queueContext = {} }) {
  const claim = processingClaim(notificationId, queueContext);
  const claimedAt = new Date();
  const notification = await Notification.findOneAndUpdate(
    claim.filter,
    {
      $set: {
        status: NOTIFICATION_STATUS.PROCESSING,
        startedAt: claimedAt,
        processingHeartbeatAt: claimedAt,
        processingJobId: claim.jobId,
        processingToken: claim.token,
        enqueuePending: false
      },
      $unset: { errorCode: 1, errorMessage: 1, queueScheduledAt: 1 }
    },
    { new: true }
  );
  if (!notification) return { ignored: true };
  notification.processingJobId = claim.jobId;
  notification.processingToken = claim.token;
  notification.processingHeartbeatAt = claimedAt;
  notification.enqueuePending = false;
  notification.queueScheduledAt = undefined;
  notification.errorCode = undefined;
  notification.errorMessage = undefined;
  await logsManager.create({
    channel: notification.channel,
    action: 'notification.processing_started',
    message: 'Processamento do lote iniciado',
    context: {
      notificationId,
      jobId: claim.jobId,
      queued: notification.deliveries.filter((delivery) => delivery.status === DELIVERY_STATUS.QUEUED).length,
      total: notification.deliveries.length,
      attempt: Number(queueContext.attemptsMade || 0) + 1,
      stalledRecovery: claim.stalledRecovery
    }
  }).catch(() => undefined);
  try {
  let template = null;
  const storedTemplateIds = notification.templates?.toObject
    ? notification.templates.toObject()
    : notification.templates;
  const globalTemplateEntries = Object.entries(storedTemplateIds || {})
    .filter(([channel, id]) => NOTIFICATION_DELIVERY_CHANNELS.includes(channel) && id);
  if (notification.kind === 'global' && globalTemplateEntries.length) {
    template = {};
    for (const [channel, templateId] of globalTemplateEntries) {
      const selected = await templatesManager.getById(templateId);
      if (selected.active === false) {
        throw new ApiError(
          422,
          'Template inativo nao pode ser usado em notificacoes',
          { templateId: String(templateId), channel },
          'TEMPLATE_INACTIVE'
        );
      }
      if (selected.channel !== channel) {
        throw new ApiError(422, 'Canal do template global foi alterado', { templateId: String(templateId), expectedChannel: channel, actualChannel: selected.channel }, 'TEMPLATE_CHANNEL_MISMATCH');
      }
      template[channel] = selected;
    }
  } else if (notification.template) {
    template = await templatesManager.getById(notification.template);
    if (template.active === false) {
      throw new ApiError(
        422,
        'Template inativo nao pode ser usado em notificacoes',
        { templateId: String(notification.template) },
        'TEMPLATE_INACTIVE'
      );
    }
  }
  const currentlyEligibleRecipients = new Set(await recipients(notification.recipientContacts.map(String), notification.recipientGroups.map(String)));
  const availability = new Map();
  for (const delivery of notification.deliveries) {
    if (delivery.status !== DELIVERY_STATUS.QUEUED) continue;
    if (!currentlyEligibleRecipients.has(String(delivery.contact))) {
      delivery.status = DELIVERY_STATUS.SKIPPED;
      delivery.errorCode = 'RECIPIENT_SCOPE_CHANGED';
      delivery.errorMessage = 'Contato saiu do grupo ou grupo foi removido antes do envio';
      await persistClaimedDelivery(notification, claim.token, delivery);
      await recordDeliveryIssues(notification, [delivery]);
      continue;
    }
    if (!availability.has(delivery.channel)) availability.set(delivery.channel, await channelAvailability(delivery.channel));
    const currentAvailability = availability.get(delivery.channel);
    if (!currentAvailability.available) {
      delivery.attempts += 1;
      const canRetry = currentAvailability.retryable && delivery.attempts < MAX_DELIVERY_ATTEMPTS;
      delivery.status = canRetry ? DELIVERY_STATUS.QUEUED : currentAvailability.retryable ? DELIVERY_STATUS.FAILED : DELIVERY_STATUS.SKIPPED;
      delivery.errorCode = currentAvailability.errorCode;
      delivery.errorMessage = String(currentAvailability.errorMessage || '').slice(0, MAX_DELIVERY_ERROR_LENGTH);
      await persistClaimedDelivery(notification, claim.token, delivery);
      await recordDeliveryIssues(notification, [delivery]);
      continue;
    }
    await assertClaimOwnership(notificationId, claim.token, Boolean(queueContext.lockToken));
    delivery.status = DELIVERY_STATUS.PROCESSING;
    try {
      const result = await dispatchAttempt(notification, delivery, template);
      delivery.status = DELIVERY_STATUS.SENT;
      delivery.providerMessageId = result.providerMessageId;
      delivery.sentAt = new Date();
      delivery.errorCode = undefined;
      delivery.errorMessage = undefined;
    } catch (error) {
      const skipped = ['CONTACT_DISABLED', 'CHANNEL_NOT_AUTHORIZED'].includes(error.code) || CHANNEL_SKIP_CODES.has(error.code) || error.statusCode === 404;
      const canRetry = !skipped && !permanentDeliveryError(error) && delivery.attempts < MAX_DELIVERY_ATTEMPTS;
      delivery.status = skipped ? DELIVERY_STATUS.SKIPPED : canRetry ? DELIVERY_STATUS.QUEUED : DELIVERY_STATUS.FAILED;
      delivery.errorCode = error.code || 'DELIVERY_ERROR';
      delivery.errorMessage = String(error.message).slice(0, MAX_DELIVERY_ERROR_LENGTH);
    }
    await persistClaimedDelivery(notification, claim.token, delivery);
    if (delivery.status !== DELIVERY_STATUS.SENT) await recordDeliveryIssues(notification, [delivery]);
  }
  const counts = notification.deliveries.reduce((result, delivery) => {
    result[delivery.status] = (result[delivery.status] || 0) + 1;
    return result;
  }, {});
  const successfulCount = (counts.sent || 0) + (counts.delivered || 0) + (counts.read || 0);
  notification.summary = { queued: counts.queued || 0, sent: successfulCount, failed: counts.failed || 0, skipped: counts.skipped || 0 };
  let retrySchedule;
  if (counts.queued) {
    const highestAttempt = Math.max(...notification.deliveries.filter((delivery) => delivery.status === DELIVERY_STATUS.QUEUED).map((delivery) => delivery.attempts || 1));
    const delayMs = Math.min(60_000, 2_000 * (2 ** Math.max(0, highestAttempt - 1)));
    retrySchedule = { highestAttempt, delayMs };
    notification.status = NOTIFICATION_STATUS.QUEUED;
    notification.enqueuePending = true;
    notification.queueScheduledAt = undefined;
    notification.startedAt = undefined;
    notification.completedAt = undefined;
  } else {
    notification.completedAt = new Date();
    if (successfulCount && counts.failed) notification.status = NOTIFICATION_STATUS.PARTIAL;
    else if (successfulCount) notification.status = NOTIFICATION_STATUS.SENT;
    else notification.status = NOTIFICATION_STATUS.FAILED;
    notification.enqueuePending = false;
    notification.queueScheduledAt = undefined;
  }
  notification.processingJobId = undefined;
  notification.processingToken = undefined;
  notification.processingHeartbeatAt = undefined;
  notification.errorCode = undefined;
  notification.errorMessage = undefined;
  await saveClaimed(notification, claim.token, { heartbeat: false });
  if (retrySchedule) {
    const scheduling = await scheduleNotification(notificationId, {
      jobId: notificationId + '-post-batch-' + retrySchedule.highestAttempt,
      delayMs: retrySchedule.delayMs
    });
    notification.enqueuePending = !scheduling.scheduled;
    notification.queueScheduledAt = scheduling.scheduledAt;
    if (!scheduling.scheduled) {
      notification.errorCode = 'QUEUE_UNAVAILABLE';
      notification.errorMessage = scheduling.errorMessage;
      return serializeNotification(notification);
    }
    await logsManager.create({
      level: 'warn',
      channel: notification.channel,
      action: 'notification.retry_scheduled',
      message: 'Falhas transitorias serao repetidas apos o lote',
      context: {
        notificationId,
        queued: counts.queued,
        delayMs: retrySchedule.delayMs,
        attempt: retrySchedule.highestAttempt
      }
    }).catch(() => undefined);
  } else {
    await logsManager.create({ channel: notification.channel, action: 'notification.completed', message: 'Processamento de notificacao concluido', context: { notificationId, summary: notification.summary } }).catch(() => undefined);
  }
  const cloudProviderIds = notification.deliveries
    .filter((delivery) => delivery.channel === CHANNELS.WHATSAPP_CLOUD && delivery.providerMessageId)
    .map((delivery) => delivery.providerMessageId);
  if (cloudProviderIds.length) {
    await reconcileStoredCloudReceipts(cloudProviderIds).catch((error) => logsManager.create({
      level: 'warn',
      channel: CHANNELS.WHATSAPP_CLOUD,
      action: 'notification.receipt_reconcile_deferred',
      message: 'Receipt Cloud preservado para reconciliacao posterior',
      context: { notificationId, error: error.message }
    }).catch(() => undefined));
  }
  const refreshed = cloudProviderIds.length ? await Notification.findById(notificationId).catch(() => null) : null;
  return serializeNotification(refreshed || notification);
  } catch (error) {
    const terminalFailure = isFinalQueueAttempt(queueContext) || permanentDeliveryError(error);
    const errorCode = String(error.code || 'NOTIFICATION_PROCESSING_ERROR');
    const errorMessage = String(error.message || 'Falha no processamento da notificacao').slice(0, MAX_DELIVERY_ERROR_LENGTH);
    const affectedDeliveries = [];
    for (const delivery of notification.deliveries) {
      if (![DELIVERY_STATUS.PROCESSING, DELIVERY_STATUS.QUEUED].includes(delivery.status)) continue;
      delivery.status = terminalFailure ? DELIVERY_STATUS.FAILED : DELIVERY_STATUS.QUEUED;
      delivery.errorCode = errorCode;
      delivery.errorMessage = errorMessage;
      affectedDeliveries.push(delivery);
    }
    const counts = notification.deliveries.reduce((result, delivery) => {
      result[delivery.status] = (result[delivery.status] || 0) + 1;
      return result;
    }, {});
    notification.summary = {
      queued: counts.queued || 0,
      sent: counts.sent || 0,
      failed: counts.failed || 0,
      skipped: counts.skipped || 0
    };
    notification.status = terminalFailure
      ? counts.sent ? NOTIFICATION_STATUS.PARTIAL : NOTIFICATION_STATUS.FAILED
      : NOTIFICATION_STATUS.QUEUED;
    notification.enqueuePending = false;
    notification.queueScheduledAt = terminalFailure ? undefined : new Date();
    notification.startedAt = undefined;
    notification.completedAt = terminalFailure ? new Date() : undefined;
    notification.processingJobId = undefined;
    notification.processingToken = undefined;
    notification.processingHeartbeatAt = undefined;
    notification.errorCode = errorCode;
    notification.errorMessage = errorMessage;
    await saveClaimed(notification, claim.token, { heartbeat: false }).catch(() => undefined);
    await recordDeliveryIssues(notification, affectedDeliveries);
    await logsManager.create({
      level: 'error',
      channel: notification.channel,
      action: terminalFailure ? 'notification.processing_failed' : 'notification.processing_recovered',
      message: terminalFailure ? 'Processamento da notificacao esgotou as tentativas' : 'Processamento interrompido; notificacao retornou para fila',
      context: {
        notificationId,
        error: errorMessage,
        attemptsMade: Number(queueContext.attemptsMade || 0) + 1,
        maxAttempts: Number(queueContext.maxAttempts || 0),
        terminalFailure
      }
    }).catch(() => undefined);
    throw error;
  }
}

function staleProcessingFilter(cutoff) {
  return {
    status: NOTIFICATION_STATUS.PROCESSING,
    $or: [
      { processingHeartbeatAt: { $lt: cutoff } },
      { processingHeartbeatAt: { $exists: false }, startedAt: { $lt: cutoff } }
    ]
  };
}

function queuedRecoveryFilter(cutoff) {
  return {
    status: NOTIFICATION_STATUS.QUEUED,
    updatedAt: { $lt: cutoff },
    $or: [
      { enqueuePending: true },
      { queueScheduledAt: { $lt: cutoff } },
      {
        enqueuePending: { $exists: false },
        queueScheduledAt: { $exists: false }
      }
    ]
  };
}

async function recoverStale(maxAgeMs = STALE_PROCESSING_MAX_AGE_MS) {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const stale = await Notification.find(staleProcessingFilter(cutoff)).select('_id').lean();
  let recovered = 0;
  for (const candidate of stale) {
    const notificationId = String(candidate._id);
    const notification = await Notification.findOneAndUpdate(
      { _id: candidate._id, ...staleProcessingFilter(cutoff) },
      {
        $set: {
          status: NOTIFICATION_STATUS.QUEUED,
          enqueuePending: true,
          'deliveries.$[delivery].status': DELIVERY_STATUS.QUEUED
        },
        $unset: {
          startedAt: 1,
          processingHeartbeatAt: 1,
          processingJobId: 1,
          processingToken: 1,
          queueScheduledAt: 1
        }
      },
      {
        new: true,
        arrayFilters: [{ 'delivery.status': DELIVERY_STATUS.PROCESSING }]
      }
    );
    if (!notification) continue;
    const scheduling = await scheduleNotification(notificationId, {
      jobId: notificationId + '-recovery-' + Date.now(),
      delayMs: 1_000
    });
    if (scheduling.scheduled) recovered += 1;
  }
  const pending = await Notification.find(queuedRecoveryFilter(cutoff)).select('_id').lean();
  let queuedRecovered = 0;
  for (const candidate of pending) {
    const notificationId = String(candidate._id);
    const scheduling = await scheduleNotification(notificationId, {
      jobId: notificationId + '-queue-recovery-' + Date.now(),
      delayMs: 1_000
    });
    if (scheduling.scheduled) queuedRecovered += 1;
  }
  await reconcilePendingCloudReceipts().catch(() => undefined);
  if (recovered || queuedRecovered) {
    await logsManager.create({
      level: 'warn',
      channel: 'global',
      action: 'notification.recovery_completed',
      message: 'Notificacoes pendentes foram recuperadas pela fila',
      context: { recoveredProcessing: recovered, recoveredQueued: queuedRecovered }
    }).catch(() => undefined);
  }
  return { recovered, queuedRecovered };
}

async function getById(id) {
  const notification = await Notification.findById(id).select('-deliveries').lean();
  if (!notification) throw new ApiError(404, 'Notificacao nao encontrada');
  return serializeNotification(notification, { includeDeliveries: false });
}

async function list(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.channel) filter.channel = query.channel;
  const includeDeliveries = query.includeDeliveries === true;
  let itemsQuery = Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);
  if (!includeDeliveries) {
    itemsQuery = itemsQuery.select('-deliveries');
  } else {
    const perNotificationLimit = Math.max(1, Math.floor(MAX_LIST_DELIVERY_SUMMARIES / limit));
    itemsQuery = itemsQuery.select({ deliveries: { $slice: perNotificationLimit } });
  }
  const [items, total] = await Promise.all([
    itemsQuery.lean(),
    Notification.countDocuments(filter)
  ]);
  return pageResult(items.map((item) => serializeNotification(item, { includeDeliveries })), total, page, limit);
}

async function listDeliveryIssues(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const match = { 'deliveries.status': { $in: [DELIVERY_STATUS.FAILED, DELIVERY_STATUS.SKIPPED] } };
  if (query.channel) match['deliveries.channel'] = query.channel;
  if (query.status) match['deliveries.status'] = query.status;
  const rootMatch = query.notificationId ? { _id: Notification.db.base.Types.ObjectId.createFromHexString(query.notificationId) } : {};
  const [result = {}] = await Notification.aggregate([
    { $match: rootMatch },
    { $unwind: '$deliveries' },
    { $match: match },
    {
      $set: {
        issueCreatedAt: {
          $ifNull: ['$deliveries.updatedAt', { $ifNull: ['$deliveries.createdAt', '$createdAt'] }]
        }
      }
    },
    { $sort: { issueCreatedAt: -1, _id: -1, 'deliveries._id': -1 } },
    {
      $facet: {
        items: [
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              id: '$deliveries._id',
              notificationId: '$_id',
              contactId: '$deliveries.contact',
              channel: '$deliveries.channel',
              status: '$deliveries.status',
              attempts: { $ifNull: ['$deliveries.attempts', 0] },
              errorCode: { $ifNull: ['$deliveries.errorCode', null] },
              errorMessage: { $ifNull: ['$deliveries.errorMessage', 'Entrega nao elegivel'] },
              createdAt: '$issueCreatedAt',
              notificationStatus: '$status'
            }
          }
        ],
        metadata: [{ $count: 'total' }]
      }
    }
  ]);
  const items = (result.items || []).map((item) => ({
    ...item,
    id: String(item.id),
    notificationId: String(item.notificationId),
    contactId: String(item.contactId)
  }));
  const total = Number(result.metadata?.[0]?.total || 0);
  return pageResult(items, total, page, limit);
}

async function listDeliveries(notificationId, query = {}) {
  const exists = await Notification.exists({ _id: notificationId });
  if (!exists) throw new ApiError(404, 'Notificacao nao encontrada');
  const { page, limit, skip } = parsePagination(query);
  const deliveryMatch = {};
  if (query.channel) deliveryMatch['deliveries.channel'] = query.channel;
  if (query.status) deliveryMatch['deliveries.status'] = query.status;
  const [result = {}] = await Notification.aggregate([
    { $match: { _id: Notification.db.base.Types.ObjectId.createFromHexString(notificationId) } },
    { $unwind: '$deliveries' },
    ...(Object.keys(deliveryMatch).length ? [{ $match: deliveryMatch }] : []),
    {
      $set: {
        deliveryCreatedAt: {
          $ifNull: ['$deliveries.createdAt', '$createdAt']
        }
      }
    },
    { $sort: { deliveryCreatedAt: -1, 'deliveries._id': -1 } },
    {
      $facet: {
        items: [
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              id: '$deliveries._id',
              notificationId: '$_id',
              contactId: '$deliveries.contact',
              channel: '$deliveries.channel',
              status: '$deliveries.status',
              attempts: { $ifNull: ['$deliveries.attempts', 0] },
              errorCode: { $ifNull: ['$deliveries.errorCode', null] },
              errorMessage: { $ifNull: ['$deliveries.errorMessage', null] },
              sentAt: { $ifNull: ['$deliveries.sentAt', null] },
              createdAt: '$deliveryCreatedAt',
              updatedAt: { $ifNull: ['$deliveries.updatedAt', '$deliveryCreatedAt'] }
            }
          }
        ],
        metadata: [{ $count: 'total' }]
      }
    }
  ]);
  const items = (result.items || []).map((item) => {
    const contactId = String(item.contactId);
    return {
      ...item,
      id: String(item.id),
      notificationId: String(item.notificationId),
      contactId,
      contactPath: '/contacts/' + contactId
    };
  });
  const total = Number(result.metadata?.[0]?.total || 0);
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
      delivery.attempts = 0;
      delivery.errorCode = undefined;
      delivery.errorMessage = undefined;
    }
  }
  if (!notification.deliveries.some((item) => item.status === DELIVERY_STATUS.QUEUED)) throw new ApiError(409, 'Nao ha entregas com falha para repetir');
  notification.status = NOTIFICATION_STATUS.QUEUED;
  notification.enqueuePending = true;
  notification.queueScheduledAt = undefined;
  notification.completedAt = undefined;
  notification.errorCode = undefined;
  notification.errorMessage = undefined;
  notification.summary = summarizeDeliveries(notification.deliveries);
  await notification.save();
  const scheduling = await scheduleNotification(String(notification._id), {
    jobId: String(notification._id) + '-retry-' + Date.now()
  });
  if (!scheduling.scheduled) {
    notification.errorCode = 'QUEUE_UNAVAILABLE';
    notification.errorMessage = scheduling.errorMessage;
    throw new ApiError(503, 'Fila indisponivel; retry pode ser solicitado novamente', { notificationId: String(notification._id), recoverable: true }, 'QUEUE_UNAVAILABLE');
  }
  notification.enqueuePending = false;
  notification.queueScheduledAt = scheduling.scheduledAt;
  return serializeNotification(notification, { includeDeliveries: false });
}

async function cancel(id) {
  const notification = await Notification.findOne({ _id: id, status: { $in: [NOTIFICATION_STATUS.QUEUED, NOTIFICATION_STATUS.DRAFT] } });
  if (!notification) throw new ApiError(409, 'Apenas notificacoes ainda nao iniciadas podem ser canceladas');
  notification.status = NOTIFICATION_STATUS.CANCELLED;
  for (const delivery of notification.deliveries) if (delivery.status === DELIVERY_STATUS.QUEUED) delivery.status = DELIVERY_STATUS.SKIPPED;
  notification.summary = summarizeDeliveries(notification.deliveries);
  notification.enqueuePending = false;
  notification.queueScheduledAt = undefined;
  notification.completedAt = new Date();
  await notification.save();
  return serializeNotification(notification, { includeDeliveries: false });
}

function sanitizeCloudReceiptErrors(receipt = {}) {
  const providerErrors = Array.isArray(receipt.errors)
    ? receipt.errors
    : Array.isArray(receipt.providerErrors) ? receipt.providerErrors : [];
  return providerErrors.slice(0, 5).map((error) => ({
    code: error?.code === undefined ? null : String(error.code).slice(0, 80),
    title: String(error?.title || '').replace(/[\r\n\t]+/g, ' ').slice(0, 300) || null,
    message: String(error?.message || '').replace(/[\r\n\t]+/g, ' ').slice(0, 500) || null,
    details: String(error?.error_data?.details || error?.details || '').replace(/[\r\n\t]+/g, ' ').slice(0, 500) || null,
    transient: error?.is_transient === true || error?.transient === true
  }));
}

function normalizedCloudReceipt(receipt = {}) {
  return {
    channel: CHANNELS.WHATSAPP_CLOUD,
    providerMessageId: String(receipt.id || receipt.providerMessageId || '').trim(),
    status: String(receipt.status || '').toLowerCase(),
    providerErrors: sanitizeCloudReceiptErrors(receipt),
    revisionToken: randomUUID(),
    receivedAt: receipt.receivedAt ? new Date(receipt.receivedAt) : new Date()
  };
}

async function storeCloudReceipt(receipt = {}) {
  const normalized = normalizedCloudReceipt(receipt);
  if (!normalized.providerMessageId || !['sent', 'delivered', 'read', 'failed'].includes(normalized.status)) return null;
  if (ProviderReceipt.db.readyState !== 1) return normalized;
  return ProviderReceipt.findOneAndUpdate(
    { channel: normalized.channel, providerMessageId: normalized.providerMessageId },
    {
      $set: {
        status: normalized.status,
        providerErrors: normalized.providerErrors,
        revisionToken: normalized.revisionToken,
        receivedAt: normalized.receivedAt
      },
      $unset: { processedAt: 1 },
      $inc: { processingAttempts: 1 }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
}

async function markCloudReceiptProcessed(providerMessageId, revisionToken) {
  if (ProviderReceipt.db.readyState !== 1 || !providerMessageId || !revisionToken) return false;
  const result = await ProviderReceipt.updateOne(
    { channel: CHANNELS.WHATSAPP_CLOUD, providerMessageId, revisionToken },
    { $set: { processedAt: new Date() } }
  );
  return Boolean(result.matchedCount);
}

async function reconcileStoredCloudReceipts(providerMessageIds = []) {
  if (ProviderReceipt.db.readyState !== 1) return { processed: 0 };
  const unique = [...new Set(providerMessageIds.map(String).filter(Boolean))];
  const receipts = await ProviderReceipt.find({
    channel: CHANNELS.WHATSAPP_CLOUD,
    providerMessageId: { $in: unique },
    processedAt: { $exists: false }
  }).sort({ receivedAt: 1 }).lean();
  let processed = 0;
  for (const receipt of receipts) {
    const result = await reconcileCloudReceipt({
      id: receipt.providerMessageId,
      status: receipt.status,
      errors: receipt.providerErrors,
      revisionToken: receipt.revisionToken,
      receivedAt: receipt.receivedAt
    });
    if (result.matched) {
      if (await markCloudReceiptProcessed(receipt.providerMessageId, receipt.revisionToken)) processed += 1;
    }
  }
  return { processed };
}

async function reconcilePendingCloudReceipts(limit = 50) {
  if (ProviderReceipt.db.readyState !== 1) return { processed: 0 };
  const receipts = await ProviderReceipt.find({
    channel: CHANNELS.WHATSAPP_CLOUD,
    processedAt: { $exists: false }
  }).sort({ receivedAt: 1 }).limit(Math.max(1, Math.min(Number(limit) || 50, 200))).lean();
  return reconcileStoredCloudReceipts(receipts.map((receipt) => receipt.providerMessageId));
}

function cloudReceiptFailure(receipt = {}) {
  const errors = sanitizeCloudReceiptErrors(receipt);
  const first = errors[0] || {};
  const providerCode = Number(first.code);
  return {
    errors,
    code: first.code ? 'META_' + first.code : 'WHATSAPP_CLOUD_ASYNC_FAILED',
    message: first.details || first.message || first.title || 'A Meta informou falha apos aceitar a mensagem',
    transient: errors.some((error) => error.transient || TRANSIENT_PROVIDER_CODES.has(Number(error.code)))
      || receipt.is_transient === true
      || TRANSIENT_PROVIDER_CODES.has(providerCode)
  };
}

function cloudDeliveryMatchExpression(providerMessageId) {
  return {
    $and: [
      { $eq: ['$$delivery.channel', CHANNELS.WHATSAPP_CLOUD] },
      { $eq: ['$$delivery.providerMessageId', { $literal: providerMessageId }] }
    ]
  };
}

function deliveryCountExpression(statuses) {
  return {
    $size: {
      $filter: {
        input: '$deliveries',
        as: 'delivery',
        cond: { $in: ['$$delivery.status', statuses] }
      }
    }
  };
}

function cloudReceiptUpdatePipeline(providerMessageId, updatedDeliveryExpression, options = {}) {
  const hasQueued = { $gt: ['$summary.queued', 0] };
  const hasSent = { $gt: ['$summary.sent', 0] };
  const hasFailed = { $gt: ['$summary.failed', 0] };
  const retryRequested = options.retryRequested === true;
  const failure = options.failure;
  return [
    {
      $set: {
        deliveries: {
          $map: {
            input: '$deliveries',
            as: 'delivery',
            in: {
              $cond: [
                cloudDeliveryMatchExpression(providerMessageId),
                updatedDeliveryExpression,
                '$$delivery'
              ]
            }
          }
        },
        updatedAt: '$$NOW'
      }
    },
    {
      $set: {
        summary: {
          queued: deliveryCountExpression([DELIVERY_STATUS.QUEUED, DELIVERY_STATUS.PROCESSING]),
          sent: deliveryCountExpression([...SUCCESS_DELIVERY_STATUSES]),
          failed: deliveryCountExpression([DELIVERY_STATUS.FAILED]),
          skipped: deliveryCountExpression([DELIVERY_STATUS.SKIPPED])
        }
      }
    },
    {
      $set: {
        status: {
          $switch: {
            branches: [
              { case: hasQueued, then: NOTIFICATION_STATUS.QUEUED },
              { case: { $and: [hasSent, hasFailed] }, then: NOTIFICATION_STATUS.PARTIAL },
              { case: hasSent, then: NOTIFICATION_STATUS.SENT }
            ],
            default: NOTIFICATION_STATUS.FAILED
          }
        },
        completedAt: { $cond: [hasQueued, '$$REMOVE', '$$NOW'] },
        enqueuePending: retryRequested
          ? true
          : { $cond: [hasQueued, { $ifNull: ['$enqueuePending', false] }, false] },
        queueScheduledAt: retryRequested
          ? '$$REMOVE'
          : { $cond: [hasQueued, '$queueScheduledAt', '$$REMOVE'] },
        errorCode: failure
          ? { $literal: failure.code }
          : { $cond: [hasFailed, '$errorCode', '$$REMOVE'] },
        errorMessage: failure
          ? { $literal: failure.message.slice(0, MAX_DELIVERY_ERROR_LENGTH) }
          : { $cond: [hasFailed, '$errorMessage', '$$REMOVE'] }
      }
    }
  ];
}

function cloudReceiptFilter(providerMessageId, deliveryFilter = {}) {
  return {
    status: { $nin: [NOTIFICATION_STATUS.PROCESSING, NOTIFICATION_STATUS.CANCELLED] },
    deliveries: {
      $elemMatch: {
        channel: CHANNELS.WHATSAPP_CLOUD,
        providerMessageId,
        ...deliveryFilter
      }
    }
  };
}

async function cloudReceiptDeferredOrMissing(providerMessageId, providerStatus) {
  const receiptFilter = {
    deliveries: { $elemMatch: { channel: CHANNELS.WHATSAPP_CLOUD, providerMessageId } }
  };
  if (await Notification.exists({ ...receiptFilter, status: NOTIFICATION_STATUS.PROCESSING })) {
    throw new ApiError(
      503,
      'Entrega ainda esta sendo finalizada; o receipt deve ser repetido',
      null,
      'WHATSAPP_CLOUD_RECEIPT_PROCESSING'
    );
  }
  if (await Notification.exists(receiptFilter)) {
    return { matched: true, ignored: true, providerStatus };
  }
  return { matched: false, providerStatus };
}

function successDeliveryExpression(providerStatus) {
  let nextStatus = DELIVERY_STATUS.READ;
  if (providerStatus === 'delivered') {
    nextStatus = { $cond: [{ $eq: ['$$delivery.status', DELIVERY_STATUS.READ] }, DELIVERY_STATUS.READ, DELIVERY_STATUS.DELIVERED] };
  }
  const promoted = {
    $mergeObjects: [
      '$$delivery',
      { status: nextStatus, errorCode: null, errorMessage: null, updatedAt: '$$NOW' }
    ]
  };
  if (providerStatus !== 'sent') return promoted;
  return {
    $cond: [
      { $eq: ['$$delivery.status', DELIVERY_STATUS.SENT] },
      {
        $mergeObjects: [
          '$$delivery',
          { errorCode: null, errorMessage: null, updatedAt: '$$NOW' }
        ]
      },
      '$$delivery'
    ]
  };
}

function failedDeliveryExpression(status, failure) {
  return {
    $mergeObjects: [
      '$$delivery',
      {
        status,
        errorCode: { $literal: failure.code },
        errorMessage: { $literal: failure.message.slice(0, MAX_DELIVERY_ERROR_LENGTH) },
        updatedAt: '$$NOW'
      }
    ]
  };
}

async function reconcileCloudReceipt(receipt = {}) {
  const providerMessageId = String(receipt.id || receipt.providerMessageId || '').trim();
  const providerStatus = String(receipt.status || '').toLowerCase();
  if (!providerMessageId || !['sent', 'delivered', 'read', 'failed'].includes(providerStatus)) {
    return { matched: false, ignored: true, providerStatus };
  }
  let notification;
  let retry = false;
  let failure = null;
  if (providerStatus === 'failed') {
    failure = cloudReceiptFailure(receipt);
    const changeableStatuses = {
      $nin: [DELIVERY_STATUS.QUEUED, DELIVERY_STATUS.PROCESSING, DELIVERY_STATUS.DELIVERED, DELIVERY_STATUS.READ]
    };
    if (failure.transient) {
      notification = await Notification.findOneAndUpdate(
        cloudReceiptFilter(providerMessageId, { status: changeableStatuses, attempts: { $lt: MAX_DELIVERY_ATTEMPTS } }),
        cloudReceiptUpdatePipeline(
          providerMessageId,
          failedDeliveryExpression(DELIVERY_STATUS.QUEUED, failure),
          { retryRequested: true, failure }
        ),
        { new: true }
      );
      retry = Boolean(notification);
    }
    if (!notification) {
      notification = await Notification.findOneAndUpdate(
        cloudReceiptFilter(providerMessageId, { status: changeableStatuses }),
        cloudReceiptUpdatePipeline(
          providerMessageId,
          failedDeliveryExpression(DELIVERY_STATUS.FAILED, failure),
          { failure }
        ),
        { new: true }
      );
    }
  } else {
    notification = await Notification.findOneAndUpdate(
      cloudReceiptFilter(providerMessageId),
      cloudReceiptUpdatePipeline(providerMessageId, successDeliveryExpression(providerStatus)),
      { new: true }
    );
  }

  if (!notification) return cloudReceiptDeferredOrMissing(providerMessageId, providerStatus);
  const delivery = notification.deliveries.find((item) => (
    item.channel === CHANNELS.WHATSAPP_CLOUD && item.providerMessageId === providerMessageId
  ));
  const counts = {
    queued: Number(notification.summary?.queued || 0),
    sent: Number(notification.summary?.sent || 0),
    failed: Number(notification.summary?.failed || 0),
    skipped: Number(notification.summary?.skipped || 0)
  };

  let retryScheduled = false;
  if (retry) {
    const delayMs = Math.min(60_000, 2_000 * (2 ** Math.max(0, Number(delivery?.attempts || 1) - 1)));
    const receiptJobKey = createHash('sha256')
      .update(String(receipt.revisionToken || providerMessageId))
      .digest('hex')
      .slice(0, 12);
    const deliveryJobKey = String(delivery?._id || 'delivery').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
    const scheduling = await scheduleNotification(String(notification._id), {
      jobId: String(notification._id) + '-cloud-receipt-' + deliveryJobKey + '-' + Number(delivery?.attempts || 1) + '-' + receiptJobKey,
      delayMs
    });
    retryScheduled = scheduling.scheduled;
    notification.enqueuePending = !scheduling.scheduled;
    notification.queueScheduledAt = scheduling.scheduledAt;
    if (!scheduling.scheduled) {
      notification.errorCode = 'QUEUE_UNAVAILABLE';
      notification.errorMessage = scheduling.errorMessage;
    }
  }
  return {
    matched: true,
    notificationId: String(notification._id),
    providerStatus,
    deliveryStatus: delivery?.status || (retry ? DELIVERY_STATUS.QUEUED : undefined),
    retryScheduled,
    summary: counts,
    errors: failure?.errors || []
  };
}

module.exports = {
  create,
  processJob,
  recoverStale,
  getById,
  list,
  listDeliveryIssues,
  listDeliveries,
  stats,
  retry,
  cancel,
  buildDeliveries,
  channelAvailability,
  normalizeTemplateContent: templateContent,
  serializeNotification,
  permanentDeliveryError,
  processingClaim,
  isFinalQueueAttempt,
  staleProcessingFilter,
  queuedRecoveryFilter,
  scheduleNotification,
  reconcileCloudReceipt,
  sanitizeCloudReceiptErrors,
  storeCloudReceipt,
  markCloudReceiptProcessed,
  reconcileStoredCloudReceipts,
  reconcilePendingCloudReceipts,
  MAX_NOTIFICATION_RECIPIENTS,
  MAX_NOTIFICATION_DELIVERIES,
  MAX_LIST_DELIVERY_SUMMARIES
};
