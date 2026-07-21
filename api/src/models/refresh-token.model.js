const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  revokedAt: { type: Date },
  replacedByHash: { type: String },
  ipHash: { type: String },
  userAgent: { type: String }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.models.RefreshToken || mongoose.model('RefreshToken', refreshTokenSchema);
