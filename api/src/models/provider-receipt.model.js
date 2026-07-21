const mongoose = require('mongoose');

const providerReceiptSchema = new mongoose.Schema({
  channel: { type: String, enum: ['whatsapp_cloud'], required: true, index: true },
  providerMessageId: { type: String, required: true },
  status: { type: String, enum: ['sent', 'delivered', 'read', 'failed'], required: true },
  providerErrors: { type: mongoose.Schema.Types.Mixed, default: [] },
  revisionToken: { type: String, required: true },
  receivedAt: { type: Date, default: Date.now },
  processedAt: { type: Date },
  processingAttempts: { type: Number, default: 0 }
}, { timestamps: true, versionKey: false });

providerReceiptSchema.index({ channel: 1, providerMessageId: 1 }, { unique: true });
providerReceiptSchema.index({ processedAt: 1, receivedAt: 1 });
providerReceiptSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.models.ProviderReceipt || mongoose.model('ProviderReceipt', providerReceiptSchema);
