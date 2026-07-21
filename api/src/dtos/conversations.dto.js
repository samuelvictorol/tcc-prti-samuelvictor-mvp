const { z, objectId, booleanQuery, paginationQuery, idParams } = require('./common.dto');

const conversationChannels = z.enum(['telegram', 'whatsapp_web']);

const listConversationsSchema = z.object({
  query: paginationQuery.extend({
    channel: conversationChannels.optional(),
    contactId: objectId.optional(),
    groupId: objectId.optional(),
    isGroup: booleanQuery.optional(),
    unreadOnly: booleanQuery.optional()
  })
});

const conversationIdSchema = z.object({ params: idParams });
const listConversationMessagesSchema = z.object({
  params: idParams,
  query: paginationQuery
});

module.exports = { listConversationsSchema, conversationIdSchema, listConversationMessagesSchema };
