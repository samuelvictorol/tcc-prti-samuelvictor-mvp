const { z, idParams, booleanQuery, paginationQuery } = require('./common.dto');

const listAdminNotificationsSchema = z.object({
  query: paginationQuery.extend({
    channel: z.string().min(1).max(80).optional(),
    kind: z.string().min(1).max(80).optional(),
    unread: booleanQuery.optional()
  })
});

const adminNotificationIdSchema = z.object({ params: idParams });

module.exports = { listAdminNotificationsSchema, adminNotificationIdSchema };
