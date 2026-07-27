const mongoose = require('mongoose');
const { WEBHOOK_PROCESSING_STATUS } = require('../enums/whatsapp-cloud-webhook');

const whatsappCloudWebhookEventSchema = new mongoose.Schema({
  dedupeKey: { type: String, required: true, unique: true },
  payloadHash: { type: String, required: true, index: true },
  payloadEncrypted: { type: String, required: true, select: false },
  object: { type: String, default: 'whatsapp_business_account', index: true },
  businessAccountId: { type: String, index: true },
  field: { type: String, required: true, default: 'unknown', index: true },
  eventType: { type: String, required: true, default: 'unknown', index: true },
  eventTypes: { type: [String], default: [] },
  summary: { type: mongoose.Schema.Types.Mixed, required: true },
  processingStatus: {
    type: String,
    enum: Object.values(WEBHOOK_PROCESSING_STATUS),
    default: WEBHOOK_PROCESSING_STATUS.RECEIVED,
    index: true
  },
  processingToken: { type: String, select: false },
  processingStartedAt: { type: Date },
  processingLeaseUntil: { type: Date },
  processingAttempts: { type: Number, default: 0, min: 0 },
  processingError: {
    code: { type: String },
    message: { type: String }
  },
  receiptCount: { type: Number, default: 0, min: 0 },
  receivedAt: { type: Date, required: true, default: Date.now, index: true },
  lastReceivedAt: { type: Date, required: true, default: Date.now },
  occurredAt: { type: Date, required: true, default: Date.now, index: true },
  processedAt: { type: Date }
}, { timestamps: true, versionKey: false });

whatsappCloudWebhookEventSchema.index({ receivedAt: -1, _id: -1 });
whatsappCloudWebhookEventSchema.index({ field: 1, receivedAt: -1 });
whatsappCloudWebhookEventSchema.index({ eventType: 1, receivedAt: -1 });
whatsappCloudWebhookEventSchema.index({ processingStatus: 1, receivedAt: -1 });
whatsappCloudWebhookEventSchema.index({ processingStatus: 1, processingLeaseUntil: 1 });

module.exports = mongoose.models.WhatsappCloudWebhookEvent
  || mongoose.model('WhatsappCloudWebhookEvent', whatsappCloudWebhookEventSchema);
