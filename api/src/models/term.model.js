const mongoose = require('mongoose');

const termSchema = new mongoose.Schema({
  type: { type: String, enum: ['terms_of_use', 'terms_of_service', 'privacy_policy'], required: true, index: true },
  title: { type: String, required: true },
  content: { type: String, required: true },
  version: { type: String, required: true },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
  publishedAt: { type: Date },
  effectiveAt: { type: Date, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }
}, { timestamps: true, versionKey: false });

termSchema.index({ type: 1, version: 1 }, { unique: true });

module.exports = mongoose.models.Term || mongoose.model('Term', termSchema);
