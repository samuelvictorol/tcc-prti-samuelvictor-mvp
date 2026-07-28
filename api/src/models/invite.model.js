const mongoose = require('mongoose');
const { STORED_CHANNELS } = require('../enums/channels');

const inviteLinkSchema = new mongoose.Schema({
  label: { type: String, required: true },
  url: { type: String, required: true },
  channel: { type: String, enum: [...STORED_CHANNELS, 'other'], default: 'other' },
  active: { type: Boolean, default: true }
}, { _id: true });

const inviteSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  title: { type: String, required: true },
  description: { type: String },
  iconeUrl: { type: String },
  links: { type: [inviteLinkSchema], default: [] },
  gradientStart: { type: String, default: '#82F8E6' },
  gradientEnd: { type: String, default: '#35BCA4' },
  recipientContact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
  clickCount: { type: Number, default: 0 },
  active: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.models.Invite || mongoose.model('Invite', inviteSchema);
