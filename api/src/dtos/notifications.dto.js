const { z, objectId, idParams, paginationQuery } = require('./common.dto');
const { CHANNELS } = require('../enums/channels');

const createNotificationSchema = z.object({
  body: z.object({
    kind: z.enum(['quick', 'template', 'global']),
    channel: z.enum(Object.values(CHANNELS)),
    templateId: objectId.nullish(),
    content: z.record(z.unknown()).nullish(),
    contactIds: z.array(objectId).max(10000).default([]),
    groupIds: z.array(objectId).max(1000).default([]),
    idempotencyKey: z.string().min(8).max(200).optional()
  }).superRefine((body, context) => {
    if (!body.contactIds.length && !body.groupIds.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe ao menos um destinatario' });
    if (body.kind !== 'quick' && !body.templateId) context.addIssue({ code: z.ZodIssueCode.custom, message: 'templateId obrigatorio' });
    if (body.kind === 'quick' && !body.content) context.addIssue({ code: z.ZodIssueCode.custom, message: 'content obrigatorio' });
  })
});

const notificationIdSchema = z.object({ params: idParams });
const listNotificationsSchema = z.object({
  query: paginationQuery.extend({ status: z.string().max(40).optional(), channel: z.enum(Object.values(CHANNELS)).optional() })
});

module.exports = { createNotificationSchema, notificationIdSchema, listNotificationsSchema };
