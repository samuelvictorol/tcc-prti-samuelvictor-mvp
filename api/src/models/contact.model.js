const mongoose = require('mongoose');
const { DELIVERY_CHANNELS } = require('../enums/channels');

const channelIdentitySchema = new mongoose.Schema({
  channel: { type: String, enum: DELIVERY_CHANNELS, required: true },
  addressEncrypted: { type: String, required: true, select: false },
  addressHash: { type: String, required: true },
  authorized: { type: Boolean, default: false },
  consentStatus: { type: String, enum: ['unknown', 'granted', 'revoked', 'denied'], default: 'unknown' },
  source: { type: String, default: 'manual' },
  interactedAt: { type: Date },
  consentedAt: { type: Date },
  metadataEncrypted: { type: String, select: false }
}, { _id: true, timestamps: true });

const contactSchema = new mongoose.Schema({
  displayNameEncrypted: { type: String, required: true, select: false },
  displayNameHash: { type: String, required: true, index: true },
  emailEncrypted: { type: String, select: false },
  emailHash: { type: String, sparse: true, index: true },
  phoneEncrypted: { type: String, select: false },
  phoneHash: { type: String, sparse: true, index: true },
  telegramUsernameEncrypted: { type: String, select: false },
  telegramUsernameHash: { type: String, sparse: true, index: true },
  avatarUrlEncrypted: { type: String, select: false },
  channels: { type: [channelIdentitySchema], default: [] },
  tags: { type: [String], default: [] },
  active: { type: Boolean, default: true, index: true },
  notificationDisabled: { type: Boolean, default: false, index: true },
  inviteClickedAt: { type: Date },
  metadataEncrypted: { type: String, select: false },
  deletedAt: { type: Date }
}, { timestamps: true, versionKey: false });

contactSchema.index({ 'channels.channel': 1, 'channels.addressHash': 1 }, { unique: true, sparse: true });
contactSchema.index({ updatedAt: -1 });

module.exports = mongoose.models.Contact || mongoose.model('Contact', contactSchema);
