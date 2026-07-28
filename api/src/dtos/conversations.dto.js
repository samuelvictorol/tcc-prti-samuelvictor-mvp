const { z, objectId, booleanQuery, paginationQuery, idParams } = require('./common.dto');

const conversationChannels = z.enum(['telegram', 'whatsapp_cloud']);

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

const listCloudConversationsSchema = z.object({
  query: paginationQuery.extend({
    contactId: objectId.optional(),
    unreadOnly: booleanQuery.optional()
  })
});

const cloudConversationMessageSchema = z.object({
  params: idParams,
  body: z.object({
    text: z.string().trim().min(1).max(4096)
  }).strict()
});

const conversationBackupIdSchema = z.object({
  params: z.object({ backupId: objectId })
});

const listConversationBackupsSchema = z.object({
  query: paginationQuery
});

module.exports = {
  listConversationsSchema,
  conversationIdSchema,
  listConversationMessagesSchema,
  listCloudConversationsSchema,
  cloudConversationMessageSchema,
  conversationBackupIdSchema,
  listConversationBackupsSchema
};
