const mongoose = require('mongoose');
const { DELIVERY_CHANNELS } = require('../enums/channels');

const templateReferencesSchema = new mongoose.Schema({
  whatsapp_cloud: { type: mongoose.Schema.Types.ObjectId, ref: 'Template' },
  telegram: { type: mongoose.Schema.Types.ObjectId, ref: 'Template' },
  email: { type: mongoose.Schema.Types.ObjectId, ref: 'Template' }
}, { _id: false });

const templateSetSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 160, index: true },
  description: { type: String, trim: true, maxlength: 2000 },
  invite: { type: mongoose.Schema.Types.ObjectId, ref: 'Invite', index: true },
  templates: {
    type: templateReferencesSchema,
    required: true,
    validate: {
      validator(value) {
        return DELIVERY_CHANNELS.some((channel) => Boolean(value?.[channel]));
      },
      message: 'O conjunto exige ao menos um template'
    }
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true }
}, { timestamps: true, versionKey: false });

templateSetSchema.index({ updatedAt: -1 });
templateSetSchema.index({ invite: 1, updatedAt: -1 });
templateSetSchema.index({ 'templates.whatsapp_cloud': 1 });
templateSetSchema.index({ 'templates.telegram': 1 });
templateSetSchema.index({ 'templates.email': 1 });

module.exports = mongoose.models.TemplateSet || mongoose.model('TemplateSet', templateSetSchema);
