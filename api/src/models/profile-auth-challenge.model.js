const mongoose = require('mongoose');

const deliveryAttemptSchema = new mongoose.Schema({
  channel: { type: String, enum: ['email', 'whatsapp_cloud', 'telegram'], required: true },
  status: { type: String, enum: ['sent', 'failed', 'not_available'], required: true },
  errorCode: { type: String },
  attemptedAt: { type: Date, default: Date.now }
}, { _id: false });

const profileAuthChallengeSchema = new mongoose.Schema({
  challengeId: { type: String, required: true, unique: true, index: true },
  identifierType: { type: String, enum: ['email', 'phone'], required: true },
  identifierHash: { type: String, required: true, select: false, index: true },
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', index: true },
  codeHash: { type: String, select: false },
  activatedAt: { type: Date },
  activationChannel: { type: String, enum: ['whatsapp_cloud'] },
  activationCount: { type: Number, default: 0, min: 0 },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, required: true },
  deliveries: { type: [deliveryAttemptSchema], default: [] },
  requestIpHash: { type: String, select: false },
  userAgent: { type: String, maxlength: 500 },
  // Validade real do codigo. `expiresAt` permanece como a data de limpeza do
  // documento para que o historico necessario ao rate limit sobreviva por toda
  // a janela configurada.
  codeExpiresAt: { type: Date },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date },
  revokedAt: { type: Date }
}, { timestamps: true, versionKey: false });

profileAuthChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
profileAuthChallengeSchema.index({ identifierHash: 1, createdAt: -1 });
profileAuthChallengeSchema.index({ contact: 1, createdAt: -1 });

module.exports = mongoose.models.ProfileAuthChallenge
  || mongoose.model('ProfileAuthChallenge', profileAuthChallengeSchema);
