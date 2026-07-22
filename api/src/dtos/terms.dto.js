const { z, idParams, paginationQuery } = require('./common.dto');

const termBody = z.object({
  type: z.enum(['terms_of_use', 'terms_of_service', 'privacy_policy']),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(1000000),
  version: z.string().min(1).max(40).optional(),
  effectiveAt: z.coerce.date().nullish(),
  status: z.enum(['draft', 'published', 'archived']).optional()
});

const createTermSchema = z.object({ body: termBody });
const updateTermSchema = z.object({ params: idParams, body: termBody.partial().refine((body) => Object.keys(body).length > 0) });
const termIdSchema = z.object({ params: idParams });
const listTermsSchema = z.object({ query: paginationQuery.extend({ type: z.enum(['terms_of_use', 'terms_of_service', 'privacy_policy']).optional(), status: z.enum(['draft', 'published', 'archived']).optional() }) });
const publicTermSchema = z.object({ params: z.object({ type: z.enum(['terms_of_use', 'terms_of_service', 'privacy_policy']) }) });

module.exports = { createTermSchema, updateTermSchema, termIdSchema, listTermsSchema, publicTermSchema };
