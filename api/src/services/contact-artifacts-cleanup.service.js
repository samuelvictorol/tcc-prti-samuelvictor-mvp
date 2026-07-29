const Conversation = require('../models/conversation.model');
const ConversationMessage = require('../models/conversation-message.model');
const AdminNotification = require('../models/admin-notification.model');
const ChatEmailChallenge = require('../models/chat-email-challenge.model');

async function removeContactArtifacts(contactId) {
  const [conversationIds, messageConversationIds] = await Promise.all([
    Conversation.distinct('_id', { contact: contactId }),
    ConversationMessage.distinct('conversation', { contact: contactId })
  ]);
  const privateConversationIds = new Set(conversationIds.map(String));
  const sharedConversationIds = messageConversationIds.filter((id) => !privateConversationIds.has(String(id)));
  const contactReferences = [...new Set([contactId, String(contactId)])];
  const adminReferenceFilter = {
    $or: [
      { contact: contactId },
      { 'context.contactId': { $in: contactReferences } }
    ]
  };
  const [
    messages,
    conversations,
    adminNotifications,
    emailChallenges,
    sanitizedShortcuts
  ] = await Promise.all([
    ConversationMessage.deleteMany({
      $or: [
        { contact: contactId },
        ...(conversationIds.length ? [{ conversation: { $in: conversationIds } }] : [])
      ]
    }),
    Conversation.deleteMany({ contact: contactId }),
    AdminNotification.deleteMany(adminReferenceFilter),
    ChatEmailChallenge.deleteMany({ contact: contactId }),
    sharedConversationIds.length
      ? Conversation.updateMany({ _id: { $in: sharedConversationIds } }, {
          $set: { unreadCount: 0 },
          $unset: {
            lastMessagePreviewEncrypted: 1,
            lastMessageDirection: 1,
            lastMessageType: 1,
            lastMessageAt: 1
          }
        })
      : Promise.resolve({ modifiedCount: 0 })
  ]);
  return {
    removedConversationMessages: messages.deletedCount || 0,
    removedConversations: conversations.deletedCount || 0,
    removedAdminNotifications: adminNotifications.deletedCount || 0,
    removedEmailChallenges: emailChallenges.deletedCount || 0,
    sanitizedConversationShortcuts: sanitizedShortcuts.modifiedCount || 0
  };
}

module.exports = { removeContactArtifacts };
