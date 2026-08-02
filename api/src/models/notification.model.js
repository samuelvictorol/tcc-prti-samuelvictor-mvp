const mongoose = require('mongoose');
const { CHANNELS, STORED_CHANNELS } = require('../enums/channels');
const { NOTIFICATION_STATUS, DELIVERY_STATUS } = require('../enums/notification');

const deliverySchema = new mongoose.Schema({
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true },
  channel: { type: String, enum: STORED_CHANNELS, required: true },
  destinationHash: { type: String },
  status: { type: String, enum: Object.values(DELIVERY_STATUS), default: DELIVERY_STATUS.QUEUED },
  attempts: { type: Number, default: 0 },
  providerMessageId: { type: String },
  errorCode: { type: String },
  errorMessage: { type: String },
  externalProvider: { type: String },
  externalErrorCode: { type: String },
  externalErrorMessage: { type: String },
  externalFailureAt: { type: Date },
  retryNotBefore: { type: Date },
  automaticRetryScheduledAt: { type: Date },
  automaticRetryAttemptedAt: { type: Date },
  automaticRetryAttempts: { type: Number, default: 0 },
  sentAt: { type: Date }
}, { _id: true, timestamps: true });

const notificationTemplatesSchema = new mongoose.Schema({
  telegram: { type: mongoose.Schema.Types.ObjectId, ref: 'Template' },
  whatsapp_cloud: { type: mongoose.Schema.Types.ObjectId, ref: 'Template' },
  email: { type: mongoose.Schema.Types.ObjectId, ref: 'Template' }
}, { _id: false });

const notificationSchema = new mongoose.Schema({
  kind: { type: String, enum: ['quick', 'template', 'global'], required: true },
  channel: { type: String, enum: Object.values(CHANNELS), required: true },
  template: { type: mongoose.Schema.Types.ObjectId, ref: 'Template' },
  templates: { type: notificationTemplatesSchema },
  templateSet: { type: mongoose.Schema.Types.ObjectId, ref: 'TemplateSet', index: true },
  content: { type: mongoose.Schema.Types.Mixed },
  recipientContacts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Contact' }],
  recipientGroups: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ContactGroup' }],
  status: { type: String, enum: Object.values(NOTIFICATION_STATUS), default: NOTIFICATION_STATUS.QUEUED, index: true },
  deliveries: { type: [deliverySchema], default: [] },
  summary: {
    queued: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 }
  },
  idempotencyKey: { type: String, unique: true, sparse: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  startedAt: { type: Date },
  processingJobId: { type: String },
  processingToken: { type: String },
  processingHeartbeatAt: { type: Date },
  enqueuePending: { type: Boolean, default: false },
  queueScheduledAt: { type: Date },
  errorCode: { type: String },
  errorMessage: { type: String },
  completedAt: { type: Date }
}, { timestamps: true, versionKey: false });

notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ status: 1, processingHeartbeatAt: 1 });
notificationSchema.index({ status: 1, enqueuePending: 1, updatedAt: 1 });
notificationSchema.index({ 'deliveries.channel': 1, 'deliveries.status': 1, createdAt: -1 });
notificationSchema.index({
  'deliveries.externalProvider': 1,
  'deliveries.externalErrorCode': 1,
  'deliveries.externalFailureAt': -1
});
notificationSchema.index({ 'deliveries.retryNotBefore': 1, status: 1 });

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
