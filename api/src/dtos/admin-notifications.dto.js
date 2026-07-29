const { z, idParams, booleanQuery, paginationQuery } = require('./common.dto');

const listAdminNotificationsSchema = z.object({
  query: paginationQuery.extend({
    channel: z.string().min(1).max(80).optional(),
    kind: z.string().min(1).max(80).optional(),
    type: z.string().min(1).max(80).optional(),
    search: z.string().trim().min(1).max(120).optional(),
    read: booleanQuery.optional(),
    unread: booleanQuery.optional(),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional()
  }).superRefine((value, context) => {
    if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dateTo'],
        message: 'A data final deve ser posterior a data inicial'
      });
    }
  })
});

const adminNotificationIdSchema = z.object({ params: idParams });

module.exports = { listAdminNotificationsSchema, adminNotificationIdSchema };
