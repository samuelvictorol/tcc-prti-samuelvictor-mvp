const mongoose = require('mongoose');
const { STORED_CHANNELS } = require('../enums/channels');

const contactGroupSchema = new mongoose.Schema({
  nameEncrypted: { type: String, required: true, select: false },
  nameHash: { type: String, required: true, index: true },
  descriptionEncrypted: { type: String, select: false },
  source: { type: String, enum: ['manual', ...STORED_CHANNELS], default: 'manual', index: true },
  externalIdEncrypted: { type: String, select: false },
  externalIdHash: { type: String },
  inviteLinkEncrypted: { type: String, select: false },
  imageUrlEncrypted: { type: String, select: false },
  sourceInvite: { type: mongoose.Schema.Types.ObjectId, ref: 'Invite' },
  sourceInviteTitle: { type: String, maxlength: 200 },
  sourceInviteSlug: { type: String, maxlength: 100 },
  contacts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Contact' }],
  active: { type: Boolean, default: true, index: true },
  notificationDisabled: { type: Boolean, default: false }
}, { timestamps: true, versionKey: false });

contactGroupSchema.index(
  { source: 1, externalIdHash: 1 },
  { unique: true, partialFilterExpression: { externalIdHash: { $type: 'string' } } }
);
contactGroupSchema.index({ updatedAt: -1 });
contactGroupSchema.index(
  { sourceInvite: 1 },
  {
    unique: true,
    partialFilterExpression: { sourceInvite: { $type: 'objectId' } },
    name: 'uniq_contact_group_source_invite'
  }
);

module.exports = mongoose.models.ContactGroup || mongoose.model('ContactGroup', contactGroupSchema);
