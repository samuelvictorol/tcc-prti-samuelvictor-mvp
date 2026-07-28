const mongoose = require('mongoose');
const { STORED_CHANNELS } = require('../enums/channels');

const consentEventSchema = new mongoose.Schema({
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', index: true },
  contactReferenceHash: { type: String, required: true },
  channel: { type: String, enum: STORED_CHANNELS, required: true, index: true },
  status: { type: String, enum: ['granted', 'revoked', 'denied'], required: true },
  legalBasis: { type: String, default: 'consent' },
  purpose: { type: String, default: 'notification_delivery' },
  source: { type: String, required: true },
  termsVersion: { type: String },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  operationIdHash: { type: String, select: false },
  evidenceEncrypted: { type: String, select: false },
  occurredAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true, versionKey: false });

consentEventSchema.index(
  { operationIdHash: 1 },
  {
    unique: true,
    partialFilterExpression: { operationIdHash: { $type: 'string' } },
    name: 'consent_operation_unique'
  }
);

module.exports = mongoose.models.ConsentEvent || mongoose.model('ConsentEvent', consentEventSchema);
