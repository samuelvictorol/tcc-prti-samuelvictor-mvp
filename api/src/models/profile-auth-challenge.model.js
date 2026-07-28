const mongoose = require('mongoose');

const deliveryAttemptSchema = new mongoose.Schema({
  channel: { type: String, enum: ['email', 'whatsapp_cloud', 'telegram'], required: true },
  status: { type: String, enum: ['sent', 'failed', 'not_available'], required: true },
  errorCode: { type: String },
  attemptedAt: { type: Date, default: Date.now }
}, { _id: false });

const profileAuthChallengeSchema = new mongoose.Schema({
  challengeId: { type: String, required: true, unique: true, index: true },
  flow: { type: String, enum: ['code', 'link'], default: 'code', index: true },
  identifierType: { type: String, enum: ['email', 'phone'], required: true },
  identifierHash: { type: String, required: true, select: false, index: true },
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', index: true },
  codeHash: { type: String, select: false },
  activatedAt: { type: Date },
  activationChannel: { type: String, enum: ['whatsapp_cloud', 'telegram', 'email'] },
  activationCount: { type: Number, default: 0, min: 0 },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, required: true },
  deliveries: { type: [deliveryAttemptSchema], default: [] },
  requestIpHash: { type: String, select: false },
  loginMarkerHash: { type: String, select: false, index: true },
  linkTokenHash: { type: String, select: false },
  linkExpiresAt: { type: Date },
  linkConsumedAt: { type: Date },
  linkSource: { type: String, maxlength: 100 },
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
profileAuthChallengeSchema.index(
  { linkTokenHash: 1 },
  {
    unique: true,
    partialFilterExpression: { linkTokenHash: { $type: 'string' } },
    name: 'uniq_profile_link_token_hash'
  }
);

module.exports = mongoose.models.ProfileAuthChallenge
  || mongoose.model('ProfileAuthChallenge', profileAuthChallengeSchema);
