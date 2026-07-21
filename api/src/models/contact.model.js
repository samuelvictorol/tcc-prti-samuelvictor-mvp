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
  consentSource: { type: String },
  consentCommand: { type: String },
  consentChangedAt: { type: Date },
  consentChangedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  metadataEncrypted: { type: String, select: false }
}, { _id: true, timestamps: true });

const channelAvatarSchema = new mongoose.Schema({
  channel: { type: String, enum: DELIVERY_CHANNELS, required: true },
  urlEncrypted: { type: String, required: true, select: false },
  updatedAt: { type: Date, default: Date.now }
}, { _id: false });

// Guarda somente a decisao de consentimento enquanto a identidade real do
// outro provedor WhatsApp ainda nao existe. Nenhum endereco e inferido aqui:
// o grant so se torna enviavel quando o webhook/provider trouxer um destino
// verificavel para o canal correspondente.
const pendingWhatsappConsentSchema = new mongoose.Schema({
  channel: { type: String, enum: ['whatsapp_web', 'whatsapp_cloud'], required: true },
  sourceChannel: { type: String, enum: ['whatsapp_web', 'whatsapp_cloud'], required: true },
  status: { type: String, enum: ['granted', 'revoked', 'denied'], default: 'granted' },
  source: { type: String, default: 'automatic_permission_command' },
  command: { type: String, required: true },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  evidenceEncrypted: { type: String, select: false },
  createdAt: { type: Date, default: Date.now },
  changedAt: { type: Date, default: Date.now }
}, { _id: false });

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
  channelAvatars: { type: [channelAvatarSchema], default: [] },
  displayNameSource: { type: String, default: 'manual' },
  channels: { type: [channelIdentitySchema], default: [] },
  pendingWhatsappConsents: { type: [pendingWhatsappConsentSchema], default: [] },
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
