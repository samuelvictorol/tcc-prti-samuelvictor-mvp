const mongoose = require('mongoose');

const inviteClickSchema = new mongoose.Schema({
  invite: { type: mongoose.Schema.Types.ObjectId, ref: 'Invite', required: true, index: true },
  linkId: { type: mongoose.Schema.Types.ObjectId },
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
  anonymousTokenHash: { type: String },
  attributionMarkerHash: { type: String },
  ipHash: { type: String },
  userAgentHash: { type: String },
  clickedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: false, versionKey: false });

inviteClickSchema.index(
  { attributionMarkerHash: 1 },
  {
    unique: true,
    partialFilterExpression: { attributionMarkerHash: { $type: 'string' } },
    name: 'uniq_invite_attribution_marker'
  }
);

module.exports = mongoose.models.InviteClick || mongoose.model('InviteClick', inviteClickSchema);
