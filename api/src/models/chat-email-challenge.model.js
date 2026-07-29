const mongoose = require('mongoose');

const redactionHashSchema = new mongoose.Schema({
  hash: { type: String, required: true },
  expiresAt: { type: Date, required: true }
}, { _id: false });

const chatEmailChallengeSchema = new mongoose.Schema({
  // Um unico slot por contato evita que alternar entre Telegram e WhatsApp
  // seja usado para contornar a janela de reenvio.
  slotKey: { type: String, required: true, unique: true, index: true },
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
  sourceChannel: {
    type: String,
    enum: ['telegram', 'whatsapp_cloud'],
    required: true
  },
  operationId: { type: String, required: true, index: true },
  targetEmailEncrypted: { type: String, required: true, select: false },
  targetEmailHash: { type: String, required: true, select: false, index: true },
  codeHash: { type: String, required: true, select: false },
  redactionCodeHashes: {
    type: [redactionHashSchema],
    default: [],
    select: false
  },
  status: {
    type: String,
    enum: ['pending_delivery', 'active', 'verifying', 'consumed', 'revoked', 'delivery_failed'],
    default: 'pending_delivery',
    index: true
  },
  attempts: { type: Number, default: 0, min: 0 },
  maxAttempts: { type: Number, required: true, min: 1 },
  sentAt: { type: Date },
  resendAt: { type: Date, required: true },
  requestWindowStartedAt: { type: Date, required: true },
  requestCount: { type: Number, default: 1, min: 1 },
  codeExpiresAt: { type: Date, required: true },
  verificationLeaseId: { type: String },
  verificationLeaseUntil: { type: Date },
  consumedAt: { type: Date },
  revokedAt: { type: Date },
  providerMessageReferenceHash: { type: String, select: false },
  providerUpdateReferenceHash: { type: String, select: false },
  cleanupAt: { type: Date, required: true }
}, { timestamps: true, versionKey: false });

chatEmailChallengeSchema.index({ cleanupAt: 1 }, { expireAfterSeconds: 0 });
chatEmailChallengeSchema.index({ contact: 1, updatedAt: -1 });

module.exports = mongoose.models.ChatEmailChallenge
  || mongoose.model('ChatEmailChallenge', chatEmailChallengeSchema);
