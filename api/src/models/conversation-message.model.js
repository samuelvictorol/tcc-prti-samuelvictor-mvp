const mongoose = require('mongoose');

const conversationMessageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', index: true },
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'ContactGroup', index: true },
  channel: { type: String, enum: ['telegram', 'whatsapp_web', 'whatsapp_cloud'], required: true, index: true },
  direction: { type: String, enum: ['inbound', 'outbound'], required: true },
  providerMessageIdEncrypted: { type: String, select: false },
  providerMessageIdHash: { type: String },
  bodyEncrypted: { type: String, select: false },
  type: { type: String, default: 'text' },
  hasMedia: { type: Boolean, default: false },
  sentAt: { type: Date, required: true, index: true },
  // Mensagens Cloud recebem uma data de expiracao operacional de 30 dias.
  // O campo tambem preserva a expiracao de documentos legados.
  retentionUntil: { type: Date },
  activityVersion: { type: Number, default: 0, min: 0 },
  tombstonedAt: { type: Date },
  metadataEncrypted: { type: String, select: false }
}, { timestamps: true, versionKey: false });

conversationMessageSchema.index(
  { conversation: 1, providerMessageIdHash: 1 },
  { unique: true, partialFilterExpression: { providerMessageIdHash: { $type: 'string' } } }
);
conversationMessageSchema.index({ conversation: 1, sentAt: -1, _id: -1 });
conversationMessageSchema.index({ conversation: 1, activityVersion: 1 });
conversationMessageSchema.index({ tombstonedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
conversationMessageSchema.index({ retentionUntil: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.ConversationMessage || mongoose.model('ConversationMessage', conversationMessageSchema);
