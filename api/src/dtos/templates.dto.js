const { z, idParams, booleanQuery, paginationQuery } = require('./common.dto');
const { CHANNELS } = require('../enums/channels');

const templateBody = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(1000).nullish(),
  channel: z.enum(Object.values(CHANNELS)),
  templateType: z.string().min(1).max(80).optional(),
  subject: z.string().max(998).nullish(),
  body: z.string().max(100000).nullish(),
  html: z.string().max(500000).nullish(),
  payload: z.record(z.unknown()).nullish(),
  variants: z.record(z.unknown()).nullish(),
  whatsappCloudPreset: z.enum(['order_confirmation', 'plain_text', 'hello_world']).nullish(),
  externalTemplateName: z.string().max(512).nullish(),
  languageCode: z.string().max(20).nullish(),
  active: z.boolean().optional()
});

const createTemplateSchema = z.object({ body: templateBody });
const updateTemplateSchema = z.object({ params: idParams, body: templateBody.partial().refine((body) => Object.keys(body).length > 0) });
const templateIdSchema = z.object({ params: idParams });
const listTemplatesSchema = z.object({
  query: paginationQuery.extend({ channel: z.enum(Object.values(CHANNELS)).optional(), search: z.string().max(160).optional(), active: booleanQuery.optional() })
});

module.exports = { createTemplateSchema, updateTemplateSchema, templateIdSchema, listTemplatesSchema };
