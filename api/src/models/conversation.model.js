const mongoose = require('mongoose');

// O valor legado `whatsapp_web` permanece aceito apenas para que documentos
// antigos possam expirar/ser removidos sem quebrar migracoes. Novas gravacoes
// passam exclusivamente por Telegram ou pela Cloud API oficial.
const CONVERSATION_CHANNELS = ['telegram', 'whatsapp_web', 'whatsapp_cloud'];

const conversationSchema = new mongoose.Schema({
  channel: { type: String, enum: CONVERSATION_CHANNELS, required: true, index: true },
  externalIdEncrypted: { type: String, required: true, select: false },
  externalIdHash: { type: String, required: true },
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', index: true },
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'ContactGroup', index: true },
  isGroup: { type: Boolean, default: false, index: true },
  displayNameEncrypted: { type: String, select: false },
  avatarUrlEncrypted: { type: String, select: false },
  lastMessagePreviewEncrypted: { type: String, select: false },
  lastMessageDirection: { type: String, enum: ['inbound', 'outbound'] },
  lastMessageType: { type: String },
  lastMessageAt: { type: Date, index: true },
  // A janela de atendimento da Cloud API e renovada somente por uma mensagem
  // inbound real do cliente. Outbounds e status de entrega nunca a estendem.
  lastInboundAt: { type: Date, index: true },
  serviceWindowExpiresAt: { type: Date, index: true },
  unreadCount: { type: Number, default: 0, min: 0 },
  messageCount: { type: Number, default: 0, min: 0 },
  retentionUntil: { type: Date },
  activityVersion: { type: Number, default: 0, min: 0 },
  lastHiddenVersion: { type: Number, default: 0, min: 0 },
  hiddenAt: { type: Date, index: true }
}, { timestamps: true, versionKey: false });

conversationSchema.index({ channel: 1, externalIdHash: 1 }, { unique: true });
conversationSchema.index({ lastMessageAt: -1, updatedAt: -1 });
conversationSchema.index({ channel: 1, hiddenAt: 1, lastMessageAt: -1 });
conversationSchema.index({ retentionUntil: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);
