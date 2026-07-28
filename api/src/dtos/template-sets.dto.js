const { z, objectId, idParams, paginationQuery } = require('./common.dto');
const { DELIVERY_CHANNELS } = require('../enums/channels');

const templateIds = z.object({
  whatsapp_cloud: objectId.optional(),
  telegram: objectId.optional(),
  email: objectId.optional()
}).strict().superRefine((value, context) => {
  if (!DELIVERY_CHANNELS.some((channel) => Boolean(value[channel]))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Selecione ao menos um template',
      path: []
    });
  }
});

const templateSetBody = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).nullish(),
  inviteId: objectId.nullish(),
  templateIds
}).strict();

const createTemplateSetSchema = z.object({ body: templateSetBody });
const updateTemplateSetSchema = z.object({
  params: idParams,
  body: templateSetBody.partial().strict().refine((body) => Object.keys(body).length > 0)
});
const templateSetIdSchema = z.object({ params: idParams });
const listTemplateSetsSchema = z.object({
  query: paginationQuery.extend({
    search: z.string().trim().max(160).optional(),
    inviteId: objectId.optional(),
    templateId: objectId.optional()
  })
});

module.exports = {
  templateIds,
  createTemplateSetSchema,
  updateTemplateSetSchema,
  templateSetIdSchema,
  listTemplateSetsSchema
};
