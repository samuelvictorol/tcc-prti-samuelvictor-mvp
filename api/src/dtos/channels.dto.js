const { z, objectId, inviteUrl } = require('./common.dto');
const { whatsappBuilder } = require('./templates.dto');

const whatsappOfficialTemplateSchema = z.discriminatedUnion('preset', [
  z.object({
    preset: z.literal('order_confirmation'),
    parameters: z.object({
      customerName: z.string().min(1).max(1024).optional(),
      orderNumber: z.string().min(1).max(1024).optional(),
      orderDate: z.string().min(1).max(1024).optional(),
      customer_name: z.string().min(1).max(1024).optional(),
      order_number: z.string().min(1).max(1024).optional(),
      order_date: z.string().min(1).max(1024).optional()
    }).superRefine((parameters, context) => {
      for (const [canonical, alias] of [['customerName', 'customer_name'], ['orderNumber', 'order_number'], ['orderDate', 'order_date']]) {
        if (!parameters[canonical] && !parameters[alias]) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: [canonical], message: canonical + ' obrigatorio' });
        }
      }
    })
  }),
  z.object({ preset: z.literal('plain_text'), parameters: z.object({}).optional() }),
  z.object({ preset: z.literal('hello_world'), parameters: z.object({}).optional() })
]);

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
    officialTemplate: whatsappOfficialTemplateSchema.optional(),
    customTemplate: z.object({
      name: z.string().min(1).max(512).regex(/^[a-z0-9_]+$/),
      languageCode: z.string().min(2).max(20),
      builder: whatsappBuilder,
      // Valores dinamicos continuam disponiveis para integracoes futuras, mas
      // o fluxo comum usa os valores fixos persistidos no builder.
      variables: z.record(z.unknown()).optional()
    }).optional(),
    payload: z.record(z.unknown()).optional()
  }).superRefine((body, context) => {
    const destinations = [body.contactId, body.groupId, body.destination].filter(Boolean);
    if (destinations.length !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe exatamente um destino: contactId, groupId ou destination'
      });
    }
  })
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

module.exports = {
  channelSendSchema, whatsappOfficialTemplateSchema, telegramWebhookSchema, cloudWebhookSchema, registerWebhookSchema,
  telegramSendSchema, createTelegramGroupSchema, updateTelegramGroupSchema
};
