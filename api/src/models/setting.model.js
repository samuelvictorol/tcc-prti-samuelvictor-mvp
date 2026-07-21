const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, uppercase: true, trim: true },
  valueEncrypted: { type: String, required: true, select: false },
  sensitive: { type: Boolean, default: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.models.Setting || mongoose.model('Setting', settingSchema);
