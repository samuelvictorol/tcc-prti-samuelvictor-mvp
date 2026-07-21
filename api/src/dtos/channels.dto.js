const { z, objectId, inviteUrl } = require('./common.dto');

const channelSendSchema = z.object({
  body: z.object({
    contactId: objectId.optional(),
    groupId: objectId.optional(),
    destination: z.string().min(1).max(500).optional(),
    text: z.string().min(1).max(100000).optional(),
    subject: z.string().max(998).optional(),
    html: z.string().max(500000).optional(),
    templateName: z.string().max(512).optional(),
    languageCode: z.string().max(20).optional(),
    components: z.array(z.record(z.unknown())).optional(),
    payload: z.record(z.unknown()).optional()
  }).refine((body) => body.contactId || body.groupId || body.destination, 'Informe contactId, groupId ou destination')
});

const telegramWebhookSchema = z.object({ body: z.record(z.unknown()) });
const cloudWebhookSchema = z.object({ body: z.record(z.unknown()) });
const registerWebhookSchema = z.object({
  body: z.object({
    url: z.string().url().max(2048).refine((value) => {
      try { return new URL(value).protocol === 'https:'; } catch (_error) { return false; }
    }, 'O webhook do Telegram deve usar HTTPS')
  })
});

const telegramSendSchema = z.object({
  body: z.object({
    contactId: objectId.optional(),
    groupId: objectId.optional(),
    mode: z.enum(['quick', 'template']),
    message: z.string().min(1).max(4096).optional(),
    templateId: objectId.optional()
  }).superRefine((body, context) => {
    if (!body.contactId && !body.groupId) context.addIssue({ code: z.ZodIssueCode.custom, message: 'contactId ou groupId obrigatorio' });
    if (body.contactId && body.groupId) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe somente um destino' });
    if (body.mode === 'quick' && !body.message) context.addIssue({ code: z.ZodIssueCode.custom, message: 'message obrigatoria' });
    if (body.mode === 'template' && !body.templateId) context.addIssue({ code: z.ZodIssueCode.custom, message: 'templateId obrigatorio' });
  })
});

const telegramGroupBody = z.object({
  name: z.string().min(1).max(200),
  chatId: z.string().min(1).max(500),
  inviteLink: inviteUrl.nullish(),
  description: z.string().max(1000).nullish(),
  contactIds: z.array(objectId).max(10000).optional(),
  active: z.boolean().optional(),
  notificationDisabled: z.boolean().optional()
});

const createTelegramGroupSchema = z.object({ body: telegramGroupBody });
const updateTelegramGroupSchema = z.object({ params: z.object({ id: objectId }), body: telegramGroupBody.partial().refine((body) => Object.keys(body).length > 0) });

const whatsappWebMessagesSchema = z.object({
  params: z.object({ chatId: z.string().min(1).max(500) }),
  query: z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).passthrough()
});

const whatsappWebGroupSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000).nullish(),
    chatIds: z.array(z.string().min(1).max(500)).min(1).max(1000)
  })
});

module.exports = {
  channelSendSchema, telegramWebhookSchema, cloudWebhookSchema, registerWebhookSchema,
  telegramSendSchema, createTelegramGroupSchema, updateTelegramGroupSchema,
  whatsappWebMessagesSchema, whatsappWebGroupSchema
};
