const { z, objectId, idParams, paginationQuery, booleanQuery } = require('./common.dto');
const { CHANNELS } = require('../enums/channels');

const notificationChannel = z.enum([CHANNELS.TELEGRAM, CHANNELS.WHATSAPP_CLOUD, CHANNELS.EMAIL, CHANNELS.GLOBAL]);

const notificationTemplateIds = z.object({
  telegram: objectId.optional(),
  whatsapp_cloud: objectId.optional(),
  email: objectId.optional()
}).strict();

const createNotificationSchema = z.object({
  body: z.object({
    kind: z.enum(['quick', 'template', 'global']),
    channel: notificationChannel,
    templateId: objectId.nullish(),
    templateIds: notificationTemplateIds.optional(),
    templateSetId: objectId.nullish(),
    content: z.record(z.unknown()).nullish(),
    contactIds: z.array(objectId).max(10000).default([]),
    groupIds: z.array(objectId).max(1000).default([]),
    idempotencyKey: z.string().min(8).max(200).optional()
  }).superRefine((body, context) => {
    if (!body.contactIds.length && !body.groupIds.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe ao menos um destinatario' });
    const globalTemplateIds = Object.values(body.templateIds || {}).filter(Boolean);
    if (body.kind === 'template' && !body.templateId) context.addIssue({ code: z.ZodIssueCode.custom, message: 'templateId obrigatorio' });
    if (body.kind === 'global' && !globalTemplateIds.length && !body.templateSetId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['templateIds'], message: 'Selecione templates por canal ou um conjunto de templates' });
    }
    if (body.kind === 'quick' && !body.content) context.addIssue({ code: z.ZodIssueCode.custom, message: 'content obrigatorio' });
    if (body.kind === 'quick' && body.channel === CHANNELS.GLOBAL) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['channel'], message: 'Disparo global exige templates por canal' });
    }
    if (body.kind === 'global' && body.channel !== CHANNELS.GLOBAL) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['channel'], message: 'Notificacao global exige channel=global' });
    }
    if (body.kind !== 'global' && body.templateIds !== undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['templateIds'], message: 'templateIds e exclusivo do disparo global' });
    }
    if (body.kind !== 'global' && body.templateSetId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['templateSetId'], message: 'templateSetId e exclusivo do disparo global' });
    }
    if (body.kind === 'global' && body.templateSetId && globalTemplateIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['templateSetId'], message: 'Use templateSetId ou templateIds, nunca os dois' });
    }
    if (body.kind === 'global' && body.templateId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['templateId'], message: 'Use templateIds por canal no disparo global' });
    }
    if (body.kind !== 'global' && body.channel === CHANNELS.GLOBAL) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['channel'], message: 'Canal global aceita somente o modo global por templates' });
    }
    if (body.channel === CHANNELS.WHATSAPP_CLOUD && body.kind !== 'template') {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['kind'], message: 'WhatsApp Cloud aceita apenas template oficial' });
    }
  })
});

const notificationIdSchema = z.object({ params: idParams });
const listNotificationsSchema = z.object({
  query: paginationQuery.extend({
    status: z.string().max(40).optional(),
    channel: z.enum(Object.values(CHANNELS)).optional(),
    includeDeliveries: booleanQuery.optional()
  })
});

const listDeliveryIssuesSchema = z.object({
  query: paginationQuery.extend({
    channel: z.enum([CHANNELS.TELEGRAM, CHANNELS.WHATSAPP_CLOUD, CHANNELS.EMAIL]).optional(),
    notificationId: objectId.optional(),
    status: z.enum(['failed', 'skipped']).optional()
  })
});

const listNotificationDeliveriesSchema = z.object({
  params: idParams,
  query: paginationQuery.extend({
    channel: z.enum([CHANNELS.TELEGRAM, CHANNELS.WHATSAPP_CLOUD, CHANNELS.EMAIL]).optional(),
    status: z.enum(['queued', 'processing', 'sent', 'delivered', 'read', 'failed', 'skipped']).optional()
  })
});

const externalErrorCode = z.string().regex(/^META_[0-9]{1,12}$/).max(32);
const listExternalProviderIssuesSchema = z.object({
  query: paginationQuery.extend({
    errorCode: externalErrorCode.optional(),
    status: z.enum(['queued', 'processing', 'sent', 'delivered', 'read', 'failed', 'skipped']).optional()
  })
});
const externalProviderIssueSchema = z.object({ params: z.object({ errorCode: externalErrorCode }) });
const externalDeliveryRetrySchema = z.object({
  params: z.object({ id: objectId, deliveryId: objectId })
});
const externalDeliveryIdSchema = z.object({ params: z.object({ deliveryId: objectId }) });

module.exports = {
  createNotificationSchema,
  notificationIdSchema,
  listNotificationsSchema,
  listDeliveryIssuesSchema,
  listNotificationDeliveriesSchema,
  listExternalProviderIssuesSchema,
  externalProviderIssueSchema,
  externalDeliveryRetrySchema,
  externalDeliveryIdSchema,
  notificationChannel,
  notificationTemplateIds
};
