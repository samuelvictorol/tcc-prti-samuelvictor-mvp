const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
  level: { type: String, enum: ['debug', 'info', 'warn', 'error'], default: 'info', index: true },
  channel: { type: String, default: 'system', index: true },
  action: { type: String, index: true },
  message: { type: String, required: true },
  context: { type: mongoose.Schema.Types.Mixed },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  requestId: { type: String, index: true },
  retentionUntil: { type: Date, index: { expires: 0 } }
}, { timestamps: true, versionKey: false });

logSchema.index({ createdAt: -1 });

module.exports = mongoose.models.Log || mongoose.model('Log', logSchema);
