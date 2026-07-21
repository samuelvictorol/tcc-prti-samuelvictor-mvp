const mongoose = require('mongoose');

const readSchema = new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  readAt: { type: Date, default: Date.now }
}, { _id: false });

const adminNotificationSchema = new mongoose.Schema({
  kind: { type: String, required: true, index: true },
  channel: { type: String, required: true, index: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', index: true },
  context: { type: mongoose.Schema.Types.Mixed },
  reads: { type: [readSchema], default: [] },
  retentionUntil: { type: Date, index: { expires: 0 } }
}, { timestamps: true, versionKey: false });

adminNotificationSchema.index({ createdAt: -1 });
adminNotificationSchema.index({ 'reads.admin': 1, createdAt: -1 });

module.exports = mongoose.models.AdminNotification || mongoose.model('AdminNotification', adminNotificationSchema);
