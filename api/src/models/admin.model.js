const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  active: { type: Boolean, default: true, index: true },
  envManaged: { type: Boolean, default: true },
  sourceIndex: { type: Number },
  lastLoginAt: { type: Date }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.models.Admin || mongoose.model('Admin', adminSchema);
