const mongoose = require('mongoose');
const { CHANNELS } = require('../enums/channels');

const templateSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, index: true },
  description: { type: String, trim: true },
  channel: { type: String, enum: Object.values(CHANNELS), required: true, index: true },
  templateType: { type: String, required: true, trim: true },
  subject: { type: String },
  body: { type: String },
  html: { type: String },
  payload: { type: mongoose.Schema.Types.Mixed },
  variants: { type: mongoose.Schema.Types.Mixed },
  variables: [{ type: String, trim: true }],
  whatsappCloudPreset: { type: String, enum: ['order_confirmation', 'plain_text', 'hello_world', 'custom'] },
  externalTemplateName: { type: String },
  languageCode: { type: String },
  systemKey: { type: String, trim: true, unique: true, sparse: true },
  systemManaged: { type: Boolean, default: false, index: true },
  active: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }
}, { timestamps: true, versionKey: false });

templateSchema.index({ channel: 1, name: 1 });

module.exports = mongoose.models.Template || mongoose.model('Template', templateSchema);
