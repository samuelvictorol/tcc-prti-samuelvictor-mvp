const Contact = require('../models/contact.model');
const ContactGroup = require('../models/contact-group.model');
const ConsentEvent = require('../models/consent-event.model');
const ApiError = require('../utils/api-error');
const { encrypt, decrypt, searchHash } = require('../services/crypto.service');
const { normalizeEmail, normalizePhone, normalizeTelegramUsername, normalizeSearch } = require('../utils/normalizers');
const { parsePagination, pageResult } = require('../utils/pagination');

const SECRET_SELECT = '+displayNameEncrypted +emailEncrypted +phoneEncrypted +telegramUsernameEncrypted +avatarUrlEncrypted +metadataEncrypted +channels.addressEncrypted +channels.metadataEncrypted';

function normalizeAddress(channel, value) {
  if (channel === 'email') return normalizeEmail(value);
  if (channel === 'whatsapp_cloud') return normalizePhone(value) || String(value).trim();
  return value === undefined || value === null ? null : String(value).trim();
}

function safeDecrypt(value, json = false) {
  if (!value) return null;
  try { return decrypt(value, { json }); } catch (_error) { return null; }
}

function serialize(contact) {
  const value = contact?.toObject ? contact.toObject() : contact;
  if (!value) return null;
  return {
    id: String(value._id),
    displayName: safeDecrypt(value.displayNameEncrypted),
    email: safeDecrypt(value.emailEncrypted),
    phone: safeDecrypt(value.phoneEncrypted),
    telegramUsername: safeDecrypt(value.telegramUsernameEncrypted),
    avatarUrl: safeDecrypt(value.avatarUrlEncrypted),
    channels: (value.channels || []).map((identity) => ({
      id: String(identity._id),
      channel: identity.channel,
      address: safeDecrypt(identity.addressEncrypted),
      authorized: identity.authorized,
      consentStatus: identity.consentStatus,
      source: identity.source,
      interactedAt: identity.interactedAt,
      consentedAt: identity.consentedAt,
      metadata: safeDecrypt(identity.metadataEncrypted, true)
    })),
    tags: value.tags || [],
    active: value.active,
    notificationDisabled: value.notificationDisabled,
    inviteClickedAt: value.inviteClickedAt,
    metadata: safeDecrypt(value.metadataEncrypted, true),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  };
}

function encryptedIdentity(input) {
  const address = normalizeAddress(input.channel, input.address);
  if (!address) throw new ApiError(422, 'Endereco do canal invalido');
  return {
    channel: input.channel,
    addressEncrypted: encrypt(address),
    addressHash: searchHash(address),
    authorized: input.authorized ?? input.consentStatus === 'granted',
    consentStatus: input.consentStatus || (input.authorized ? 'granted' : 'unknown'),
    source: input.source || 'manual',
    interactedAt: input.interactedAt,
    consentedAt: input.consentStatus === 'granted' || input.authorized ? new Date() : undefined,
    metadataEncrypted: input.metadata ? encrypt(input.metadata) : undefined
  };
}

async function auditConsent(contactId, channel, status, context = {}) {
  if (!['granted', 'revoked', 'denied'].includes(status)) return null;
  return ConsentEvent.create({
    contact: contactId,
    contactReferenceHash: searchHash(String(contactId)),
    channel,
    status,
    legalBasis: context.legalBasis || 'consent',
    purpose: context.purpose || 'notification_delivery',
    source: context.source || 'contact_manager',
    termsVersion: context.termsVersion,
    actor: context.actorId,
    evidenceEncrypted: context.evidence ? encrypt(context.evidence) : undefined
  });
}

function assignBasicFields(target, input, creating = false) {
  if (creating || input.displayName !== undefined) {
    const name = String(input.displayName || '').trim();
    if (!name) throw new ApiError(422, 'Nome obrigatorio');
    target.displayNameEncrypted = encrypt(name);
    target.displayNameHash = searchHash(normalizeSearch(name));
  }
  if (creating || input.email !== undefined) {
    const email = normalizeEmail(input.email);
    target.emailEncrypted = encrypt(email);
    target.emailHash = searchHash(email);
  }
  if (creating || input.phone !== undefined) {
    const phone = normalizePhone(input.phone);
    target.phoneEncrypted = encrypt(phone);
    target.phoneHash = searchHash(phone);
  }
  if (creating || input.telegramUsername !== undefined) {
    const username = normalizeTelegramUsername(input.telegramUsername);
    target.telegramUsernameEncrypted = encrypt(username);
    target.telegramUsernameHash = searchHash(username);
  }
  if (creating || input.avatarUrl !== undefined) target.avatarUrlEncrypted = encrypt(input.avatarUrl || null);
  if (creating || input.metadata !== undefined) target.metadataEncrypted = input.metadata ? encrypt(input.metadata) : null;
  if (input.tags !== undefined) target.tags = [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))];
  if (input.active !== undefined) target.active = input.active;
  if (input.notificationDisabled !== undefined) target.notificationDisabled = input.notificationDisabled;
}

async function create(input, actorId, options = {}) {
  if (!options.providerManaged && (input.channels || []).some((identity) => identity.channel === 'telegram')) {
    throw new ApiError(403, 'chat_id do Telegram so pode ser criado por webhook verificado', null, 'PROVIDER_IDENTITY_MANAGED');
  }
  const values = {};
  assignBasicFields(values, input, true);
  values.channels = (input.channels || []).map(encryptedIdentity);
  try {
    const contact = await Contact.create(values);
    for (let index = 0; index < (input.channels || []).length; index += 1) {
      const channelInput = input.channels[index];
      const stored = contact.channels[index];
      await auditConsent(contact._id, stored.channel, stored.consentStatus, { source: channelInput.source || 'manual', actorId });
    }
    return getById(contact._id);
  } catch (error) {
    if (error.code === 11000) throw new ApiError(409, 'Identificador de canal ja cadastrado', error.keyPattern, 'DUPLICATE_CONTACT');
    throw error;
  }
}

async function getRawById(id) {
  const contact = await Contact.findById(id).select(SECRET_SELECT);
  if (!contact) throw new ApiError(404, 'Contato nao encontrado');
  return contact;
}

async function getById(id) {
  return serialize(await getRawById(id));
}

async function list(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { deletedAt: null };
  if (query.active !== undefined) filter.active = query.active;
  if (query.channel || query.authorized !== undefined) {
    filter.channels = { $elemMatch: {} };
    if (query.channel) filter.channels.$elemMatch.channel = query.channel;
    if (query.authorized !== undefined) {
      filter.channels.$elemMatch.authorized = query.authorized;
      if (query.authorized) filter.channels.$elemMatch.consentStatus = 'granted';
    }
  }
  if (query.search) {
    const raw = String(query.search).trim();
    const hashes = [...new Set([
      searchHash(normalizeSearch(raw)),
      searchHash(normalizeEmail(raw)),
      searchHash(normalizePhone(raw)),
      searchHash(normalizeTelegramUsername(raw)),
      searchHash(raw)
    ].filter(Boolean))];
    filter.$or = [
      { displayNameHash: { $in: hashes } },
      { emailHash: { $in: hashes } },
      { phoneHash: { $in: hashes } },
      { telegramUsernameHash: { $in: hashes } },
      { 'channels.addressHash': { $in: hashes } }
    ];
  }
  const [items, total] = await Promise.all([
    Contact.find(filter).select(SECRET_SELECT).sort({ updatedAt: -1 }).skip(skip).limit(limit),
    Contact.countDocuments(filter)
  ]);
  return pageResult(items.map(serialize), total, page, limit);
}

async function update(id, input, actorId) {
  const contact = await getRawById(id);
  const previousConsents = new Map(contact.channels.map((identity) => [identity.channel + ':' + identity.addressHash, identity.consentStatus]));
  const previousIdentities = contact.channels.map((identity) => ({
    channel: identity.channel,
    key: identity.channel + ':' + identity.addressHash,
    consentStatus: identity.consentStatus
  }));
  assignBasicFields(contact, input, false);
  if (input.channels !== undefined) {
    const incoming = input.channels.map(encryptedIdentity);
    const existingTelegram = contact.channels.filter((identity) => identity.channel === 'telegram');
    const incomingTelegram = incoming.filter((identity) => identity.channel === 'telegram');
    for (const identity of incomingTelegram) {
      const existing = existingTelegram.find((item) => item.addressHash === identity.addressHash);
      if (!existing || identity.consentStatus === 'granted' && existing.consentStatus !== 'granted') {
        throw new ApiError(403, 'chat_id/consentimento Telegram e gerenciado pelo webhook', null, 'PROVIDER_IDENTITY_MANAGED');
      }
      if (identity.consentStatus !== existing.consentStatus && identity.consentStatus !== 'granted') {
        existing.consentStatus = identity.consentStatus;
        existing.authorized = false;
      }
    }
    contact.channels = [...incoming.filter((identity) => identity.channel !== 'telegram'), ...existingTelegram];
  }
  try {
    await contact.save();
    if (input.channels !== undefined) {
      const currentKeys = new Set(contact.channels.map((identity) => identity.channel + ':' + identity.addressHash));
      for (const identity of contact.channels) {
        const previous = previousConsents.get(identity.channel + ':' + identity.addressHash);
        if (previous !== identity.consentStatus) {
          await auditConsent(contact._id, identity.channel, identity.consentStatus, { source: 'manual_contact_update', actorId });
        }
      }
      for (const previous of previousIdentities) {
        if (!currentKeys.has(previous.key) && previous.consentStatus !== 'revoked') {
          await auditConsent(contact._id, previous.channel, 'revoked', { source: 'manual_identity_removal', actorId });
        }
      }
    }
  } catch (error) {
    if (error.code === 11000) throw new ApiError(409, 'Identificador de canal ja cadastrado');
    throw error;
  }
  return getById(id);
}

async function remove(id) {
  const contact = await Contact.findById(id);
  if (!contact) throw new ApiError(404, 'Contato nao encontrado');
  await Promise.all([
    Contact.deleteOne({ _id: id }),
    ContactGroup.updateMany({ contacts: id }, { $pull: { contacts: id } })
  ]);
  return { id: String(id), removed: true, notificationsStopped: true };
}

async function upsertFromChannel({ channel, address, displayName, avatarUrl, metadata, source = 'inbound', authorize = true, consentStatus }) {
  const normalizedAddress = normalizeAddress(channel, address);
  const addressHash = searchHash(normalizedAddress);
  let contact = await Contact.findOne({ channels: { $elemMatch: { channel, addressHash } } }).select(SECRET_SELECT);
  if (!contact) {
    const created = await create({
      displayName: displayName || normalizedAddress,
      avatarUrl,
      channels: [{
        channel,
        address: normalizedAddress,
        authorized: authorize,
        consentStatus: consentStatus || (authorize ? 'granted' : 'unknown'),
        source,
        interactedAt: new Date(),
        metadata
      }]
    }, null, { providerManaged: true });
    return created;
  }
  const identity = contact.channels.find((item) => item.channel === channel && item.addressHash === addressHash);
  const previousConsent = identity.consentStatus;
  if (authorize) {
    identity.authorized = true;
    identity.consentStatus = consentStatus || 'granted';
    identity.consentedAt ||= new Date();
  } else if (!identity.authorized && identity.consentStatus === 'unknown' && consentStatus && consentStatus !== 'unknown') {
    identity.consentStatus = consentStatus;
  }
  identity.source = source;
  identity.interactedAt = new Date();
  if (metadata) identity.metadataEncrypted = encrypt(metadata);
  if (displayName && !safeDecrypt(contact.displayNameEncrypted)) {
    contact.displayNameEncrypted = encrypt(displayName);
    contact.displayNameHash = searchHash(normalizeSearch(displayName));
  }
  if (avatarUrl) contact.avatarUrlEncrypted = encrypt(avatarUrl);
  await contact.save();
  if (previousConsent !== identity.consentStatus) {
    await auditConsent(contact._id, channel, identity.consentStatus, { source });
  }
  return serialize(contact);
}

async function findByChannelAddress(channel, address) {
  const normalizedAddress = normalizeAddress(channel, address);
  const contact = await Contact.findOne({ channels: { $elemMatch: { channel, addressHash: searchHash(normalizedAddress) } } }).select(SECRET_SELECT);
  return contact ? serialize(contact) : null;
}

async function setConsentByAddress(channel, address, status) {
  const contact = await findByChannelAddress(channel, address);
  if (!contact) return null;
  return setChannelConsent(contact.id, channel, status);
}

async function getDestination(contactId, channel, options = {}) {
  const contact = await getRawById(contactId);
  if (!contact.active || contact.notificationDisabled) throw new ApiError(409, 'Contato desativado para notificacoes', null, 'CONTACT_DISABLED');
  const identities = contact.channels.filter((item) => item.channel === channel);
  const identity = identities.find((item) => options.allowUnconsented || (item.authorized && item.consentStatus === 'granted'));
  if (!identity) throw new ApiError(409, 'Contato nao autorizou o canal ' + channel, null, 'CHANNEL_NOT_AUTHORIZED');
  return { address: decrypt(identity.addressEncrypted), addressHash: identity.addressHash, contact: serialize(contact) };
}

async function setChannelConsent(id, channel, status, context = {}) {
  if (channel === 'telegram' && status === 'granted' && !context.providerManaged) {
    throw new ApiError(403, 'Consentimento Telegram so pode ser concedido por interacao privada verificada', null, 'PROVIDER_CONSENT_MANAGED');
  }
  const contact = await getRawById(id);
  const identities = contact.channels.filter((item) => item.channel === channel);
  if (!identities.length) throw new ApiError(404, 'Identidade do canal nao encontrada');
  const changed = identities.some((identity) => identity.consentStatus !== status || identity.authorized !== (status === 'granted'));
  for (const identity of identities) {
    identity.consentStatus = status;
    identity.authorized = status === 'granted';
    if (status === 'granted') identity.consentedAt = new Date();
  }
  await contact.save();
  if (changed) await auditConsent(contact._id, channel, status, context);
  return serialize(contact);
}

module.exports = { create, getById, getRawById, list, update, remove, upsertFromChannel, findByChannelAddress, setConsentByAddress, getDestination, setChannelConsent, serialize, SECRET_SELECT };
