const mongoose = require('mongoose');

const conversationBackupSchema = new mongoose.Schema({
  channel: { type: String, enum: ['whatsapp_cloud'], default: 'whatsapp_cloud', required: true, index: true },
  trigger: { type: String, enum: ['automatic', 'manual'], required: true, index: true },
  periodKey: { type: String, required: true, index: true },
  periodStartedAt: { type: Date, required: true },
  periodEndsAt: { type: Date, required: true },
  generatedAt: { type: Date, required: true, default: Date.now, index: true },
  conversationCount: { type: Number, required: true, min: 0 },
  messageCount: { type: Number, required: true, min: 0 },
  gridFsFileId: { type: mongoose.Schema.Types.ObjectId, index: true },
  filename: { type: String, maxlength: 500 },
  contentType: { type: String, default: 'application/octet-stream' },
  storageBytes: { type: Number, min: 0 },
  plaintextBytes: { type: Number, min: 0 },
  checksumSha256: { type: String, minlength: 64, maxlength: 64 },
  expiresAt: { type: Date, required: true, index: true },
  // Compatibilidade somente leitura com snapshots criados antes do GridFS.
  payloadEncrypted: { type: String, select: false }
}, { timestamps: true, versionKey: false });

conversationBackupSchema.index(
  { channel: 1, periodKey: 1 },
  {
    unique: true,
    partialFilterExpression: { trigger: 'automatic' },
    name: 'uniq_automatic_cloud_backup_period'
  }
);
conversationBackupSchema.index({ channel: 1, trigger: 1, generatedAt: -1 });
conversationBackupSchema.index({ expiresAt: 1, generatedAt: 1 });

module.exports = mongoose.models.ConversationBackup
  || mongoose.model('ConversationBackup', conversationBackupSchema);
