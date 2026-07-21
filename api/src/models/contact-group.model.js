const mongoose = require('mongoose');
const { DELIVERY_CHANNELS } = require('../enums/channels');

const contactGroupSchema = new mongoose.Schema({
  nameEncrypted: { type: String, required: true, select: false },
  nameHash: { type: String, required: true, index: true },
  descriptionEncrypted: { type: String, select: false },
  source: { type: String, enum: ['manual', ...DELIVERY_CHANNELS], default: 'manual', index: true },
  externalIdEncrypted: { type: String, select: false },
  externalIdHash: { type: String },
  inviteLinkEncrypted: { type: String, select: false },
  imageUrlEncrypted: { type: String, select: false },
  contacts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Contact' }],
  active: { type: Boolean, default: true, index: true },
  notificationDisabled: { type: Boolean, default: false }
}, { timestamps: true, versionKey: false });

contactGroupSchema.index(
  { source: 1, externalIdHash: 1 },
  { unique: true, partialFilterExpression: { externalIdHash: { $type: 'string' } } }
);
contactGroupSchema.index({ updatedAt: -1 });

module.exports = mongoose.models.ContactGroup || mongoose.model('ContactGroup', contactGroupSchema);
