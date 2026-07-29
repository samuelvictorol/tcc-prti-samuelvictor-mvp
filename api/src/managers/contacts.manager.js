const crypto = require('node:crypto');
const Contact = require('../models/contact.model');
const ContactGroup = require('../models/contact-group.model');
const ConsentEvent = require('../models/consent-event.model');
const AdminNotification = require('../models/admin-notification.model');
const Conversation = require('../models/conversation.model');
const ConversationMessage = require('../models/conversation-message.model');
const Invite = require('../models/invite.model');
const InviteClick = require('../models/invite-click.model');
const Notification = require('../models/notification.model');
const ProfileAuthChallenge = require('../models/profile-auth-challenge.model');
const ChatEmailChallenge = require('../models/chat-email-challenge.model');
const ApiError = require('../utils/api-error');
const { DELIVERY_CHANNELS } = require('../enums/channels');
const { encrypt, decrypt, searchHash } = require('../services/crypto.service');
const {
  normalizeEmail,
  normalizePhone,
  normalizeWhatsappE164,
  whatsappLidDigits,
  normalizeTelegramUsername,
  normalizeSearch
} = require('../utils/normalizers');
const { parsePagination, pageResult } = require('../utils/pagination');
const { removeContactArtifacts } = require('../services/contact-artifacts-cleanup.service');

const SECRET_SELECT = '+displayNameEncrypted +emailEncrypted +phoneEncrypted +telegramUsernameEncrypted +avatarUrlEncrypted +channelAvatars.urlEncrypted +metadataEncrypted +channels.addressEncrypted +channels.metadataEncrypted +pendingWhatsappConsents.evidenceEncrypted';
const AVATAR_PRIORITY = ['whatsapp_cloud', 'telegram'];
const WHATSAPP_CHANNELS = ['whatsapp_cloud'];
const providerUpsertLocks = new Map();
const DECIDED_CONSENT_STATUSES = ['granted', 'revoked', 'denied'];

function isReservedIdentityMetadataKey(key) {
  const normalized = String(key || '').replace(/[_-]/g, '').toLowerCase();
  return normalized === 'consentsource'
    || normalized === 'consentcommand'
    || normalized.startsWith('consentchanged')
    || normalized === 'permissioncommandreceived'
    || normalized === 'permissioncommandreceivedvia'
    || normalized === 'sharedwhatsappconsent'
    || normalized === 'consentcommandchannel'
    || normalized === 'autoregisteredvia';
}

function sanitizeAdministrativeIdentityMetadata(metadata, existingMetadata = {}) {
  if (!metadata) return metadata;
  const safe = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !isReservedIdentityMetadataKey(key))
  );
  for (const [key, value] of Object.entries(existingMetadata || {})) {
    if (isReservedIdentityMetadataKey(key)) safe[key] = value;
  }
  return safe;
}

function manualIdentityInput(input) {
  return {
    channel: input.channel,
    address: input.address,
    authorized: false,
    consentStatus: 'unknown',
    source: 'manual',
    interactedAt: input.interactedAt,
    metadata: sanitizeAdministrativeIdentityMetadata(input.metadata)
  };
}

function duplicateContactError(error) {
  if (error?.code !== 11000) return null;
  if (error.keyPattern?.emailHash || error.keyPattern?.phoneHash
    || String(error.message || '').includes('uniq_contact_email_hash')
    || String(error.message || '').includes('uniq_contact_phone_hash')) {
    return new ApiError(
      409,
      'Email ou telefone ja pertence a outro contato',
      null,
      'DUPLICATE_CONTACT_IDENTIFIER'
    );
  }
  return new ApiError(409, 'Identificador de canal ja cadastrado', error.keyPattern, 'DUPLICATE_CONTACT');
}

function consentStatusFromInput(input = {}) {
  return input.consentStatus || (input.authorized === true ? 'granted' : 'unknown');
}

function consentSnapshot(identity) {
  return {
    authorized: Boolean(identity.authorized),
    consentStatus: identity.consentStatus || 'unknown',
    consentedAt: identity.consentedAt,
    consentSource: identity.consentSource,
    consentCommand: identity.consentCommand,
    consentChangedAt: identity.consentChangedAt,
    consentChangedBy: identity.consentChangedBy
  };
}

function restoreConsent(identity, snapshot) {
  Object.assign(identity, snapshot);
}

function applyConsent(identity, status, context = {}, changedAt = new Date()) {
  identity.consentStatus = status;
  identity.authorized = status === 'granted';
  if (status === 'granted') identity.consentedAt = changedAt;
  identity.consentSource = context.source || 'contact_manager';
  identity.consentCommand = context.command || null;
  identity.consentChangedAt = changedAt;
  identity.consentChangedBy = context.actorId || null;
}

function normalizeAddress(channel, value) {
  if (channel === 'email') return normalizeEmail(value);
  if (channel === 'whatsapp_cloud') return normalizeWhatsappE164(value);
  return value === undefined || value === null ? null : String(value).trim();
}

function safeDecrypt(value, json = false) {
  if (!value) return null;
  try { return decrypt(value, { json }); } catch (_error) { return null; }
}

function decodedIdentities(value) {
  return (value.channels || []).map((identity) => ({
    raw: identity,
    address: safeDecrypt(identity.addressEncrypted),
    metadata: safeDecrypt(identity.metadataEncrypted, true) || {}
  }));
}

function providerIdentifierDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || null;
}

function cloudDeliveryAddress(identity) {
  if (!identity || identity.raw.channel !== 'whatsapp_cloud') return null;
  const metadata = identity.metadata || {};
  const trustedWaId = normalizeWhatsappE164(metadata.waId);
  if (trustedWaId) return trustedWaId;
  const blockedIdentifiers = [
    metadata.userId,
    metadata.fromUserId,
    metadata.logicalId,
    metadata.fromLogicalId
  ].map(providerIdentifierDigits).filter(Boolean);
  return normalizeWhatsappE164(identity.address, { blockedIdentifiers });
}

function telegramPrivateChatId(value) {
  const normalized = String(value ?? '').trim();
  return /^\d{1,20}$/.test(normalized) ? normalized : null;
}

function telegramDeliveryAddress(identity) {
  if (!identity || identity.raw.channel !== 'telegram') return null;
  const metadata = identity.metadata || {};
  // O chat_id recebido no webhook é o destino efetivo da Bot API. Registros
  // antigos podem manter user_id/username em address, embora a UI já mostre o
  // chat_id correto vindo dos metadados.
  return telegramPrivateChatId(metadata.chatId)
    || telegramPrivateChatId(metadata.userId)
    || telegramPrivateChatId(identity.address)
    || null;
}

function webPhoneAddress(identity) {
  if (!identity || identity.raw.channel !== 'whatsapp_web') return null;
  const metadata = identity.metadata || {};
  return [identity.address, metadata.contactId, metadata.serializedId]
    .map((candidate) => normalizeWhatsappE164(candidate))
    .find(Boolean) || null;
}

function blockedPhoneIdentifiers(identities) {
  const blocked = new Set();
  for (const identity of identities) {
    if (identity.raw.channel === 'whatsapp_web') {
      for (const candidate of [identity.address, identity.metadata.chatId, identity.metadata.messageFrom]) {
        const lid = whatsappLidDigits(candidate);
        if (lid) blocked.add(lid);
      }
    }
    for (const candidate of [identity.metadata.logicalId, identity.metadata.fromLogicalId]) {
      const digits = providerIdentifierDigits(candidate);
      if (digits) blocked.add(digits);
    }
  }
  return [...blocked];
}

function contactPhoneResolution(value, identities = decodedIdentities(value)) {
  const storedRaw = safeDecrypt(value.phoneEncrypted);
  const stored = normalizeWhatsappE164(storedRaw, { blockedIdentifiers: blockedPhoneIdentifiers(identities) });
  if (stored) return { phone: stored, source: 'stored', storedUnsafe: false, unavailableReason: null };
  const trustedProviderPhone = [
    ...identities.filter((identity) => identity.raw.channel === 'whatsapp_cloud').map(cloudDeliveryAddress),
    ...identities.filter((identity) => identity.raw.channel === 'whatsapp_web').map(webPhoneAddress)
  ].find(Boolean);
  if (trustedProviderPhone) {
    return {
      phone: trustedProviderPhone,
      source: 'verified_provider_identity',
      storedUnsafe: Boolean(storedRaw),
      unavailableReason: null
    };
  }
  return {
    phone: null,
    source: null,
    storedUnsafe: Boolean(storedRaw),
    unavailableReason: storedRaw ? 'PROVIDER_IDENTIFIER_IS_NOT_PHONE' : null
  };
}

function serialize(contact, options = {}) {
  const value = contact?.toObject ? contact.toObject() : contact;
  if (!value) return null;
  const identities = decodedIdentities(value);
  const phoneResolution = contactPhoneResolution(value, identities);
  const channelAvatars = (value.channelAvatars || []).filter((item) => DELIVERY_CHANNELS.includes(item.channel)).map((item) => ({
    channel: item.channel,
    url: safeDecrypt(item.urlEncrypted),
    updatedAt: item.updatedAt
  })).filter((item) => item.url);
  const includeInlineAvatar = options.includeInlineAvatar !== false;
  const usableAvatars = includeInlineAvatar
    ? channelAvatars
    : channelAvatars.filter((item) => !String(item.url).startsWith('data:'));
  const preferredAvatar = AVATAR_PRIORITY
    .map((channel) => usableAvatars.find((item) => item.channel === channel))
    .find(Boolean);
  return {
    id: String(value._id),
    displayName: safeDecrypt(value.displayNameEncrypted),
    email: safeDecrypt(value.emailEncrypted),
    phone: phoneResolution.phone,
    phoneSource: phoneResolution.source,
    phoneUnavailableReason: phoneResolution.unavailableReason,
    telegramUsername: safeDecrypt(value.telegramUsernameEncrypted),
    avatarUrl: preferredAvatar?.url || (includeInlineAvatar ? safeDecrypt(value.avatarUrlEncrypted) : null),
    avatarSource: preferredAvatar?.channel || (includeInlineAvatar && value.avatarUrlEncrypted ? 'manual' : null),
    channels: identities.filter((identity) => DELIVERY_CHANNELS.includes(identity.raw.channel)).map((identity) => ({
      id: String(identity.raw._id),
      channel: identity.raw.channel,
      address: identity.address,
      deliveryAddress: identity.raw.channel === 'whatsapp_cloud'
        ? cloudDeliveryAddress(identity)
        : identity.raw.channel === 'telegram'
          ? telegramDeliveryAddress(identity)
          : identity.address,
      addressUnavailableReason: identity.raw.channel === 'whatsapp_cloud' && !cloudDeliveryAddress(identity)
        ? 'WHATSAPP_PHONE_UNAVAILABLE'
        : identity.raw.channel === 'telegram' && !telegramDeliveryAddress(identity)
          ? 'TELEGRAM_CHAT_UNAVAILABLE'
          : null,
      authorized: identity.raw.authorized,
      consentStatus: identity.raw.consentStatus,
      source: identity.raw.source,
      interactedAt: identity.raw.interactedAt,
      consentedAt: identity.raw.consentedAt,
      consentSource: identity.raw.consentSource || null,
      consentCommand: identity.raw.consentCommand || null,
      consentChangedAt: identity.raw.consentChangedAt || null,
      consentChangedBy: identity.raw.consentChangedBy ? String(identity.raw.consentChangedBy._id || identity.raw.consentChangedBy) : null,
      metadata: identity.metadata
    })),
    pendingWhatsappConsents: (value.pendingWhatsappConsents || [])
      .filter((pending) => pending.channel === 'whatsapp_cloud')
      .map((pending) => ({
      channel: pending.channel,
      sourceChannel: pending.sourceChannel,
      status: pending.status || 'granted',
      source: pending.source || 'automatic_permission_command',
      command: pending.command,
      changedBy: pending.changedBy ? String(pending.changedBy._id || pending.changedBy) : null,
      createdAt: pending.createdAt,
      changedAt: pending.changedAt || pending.createdAt
    })),
    tags: value.tags || [],
    active: value.active,
    notificationDisabled: value.notificationDisabled,
    inviteClickedAt: value.inviteClickedAt,
    inviteOrigins: (value.inviteOrigins || []).map((origin) => ({
      inviteId: String(origin.invite?._id || origin.invite),
      title: origin.title,
      slug: origin.slug,
       channels: [...new Set((origin.channels || []).filter((channel) => DELIVERY_CHANNELS.includes(channel)))],
      firstUsedAt: origin.firstUsedAt,
      lastUsedAt: origin.lastUsedAt
    })),
    metadata: safeDecrypt(value.metadataEncrypted, true),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  };
}

function encryptedIdentity(input) {
  const address = normalizeAddress(input.channel, input.address);
  if (!address) throw new ApiError(422, 'Endereco do canal invalido');
  const consentStatus = consentStatusFromInput(input);
  const authorized = consentStatus === 'granted';
  const hasConsentDecision = DECIDED_CONSENT_STATUSES.includes(consentStatus);
  return {
    channel: input.channel,
    addressEncrypted: encrypt(address),
    addressHash: searchHash(address),
    authorized,
    consentStatus,
    source: input.source || 'manual',
    interactedAt: input.interactedAt,
    consentedAt: consentStatus === 'granted' ? new Date() : undefined,
    consentSource: hasConsentDecision ? input.consentSource || input.source || 'manual' : undefined,
    consentCommand: hasConsentDecision ? input.consentCommand : undefined,
    consentChangedAt: hasConsentDecision ? input.consentChangedAt || new Date() : undefined,
    consentChangedBy: hasConsentDecision ? input.consentChangedBy : undefined,
    metadataEncrypted: input.metadata ? encrypt(input.metadata) : undefined
  };
}

async function auditConsent(contactId, channel, status, context = {}) {
  if (!DECIDED_CONSENT_STATUSES.includes(status)) return null;
  const operationId = context.operationId || context.evidence?.operationId;
  try {
    return await ConsentEvent.create({
      contact: contactId,
      contactReferenceHash: searchHash(String(contactId)),
      channel,
      status,
      legalBasis: context.legalBasis || 'consent',
      purpose: context.purpose || 'notification_delivery',
      source: context.source || 'contact_manager',
      termsVersion: context.termsVersion,
      actor: context.actorId,
      operationIdHash: operationId ? searchHash(`consent-operation:${operationId}`) : undefined,
      evidenceEncrypted: context.evidence ? encrypt(context.evidence) : undefined
    });
  } catch (error) {
    if (operationId && error?.code === 11000) return null;
    throw error;
  }
}

function assignBasicFields(target, input, creating = false) {
  if (creating || input.displayName !== undefined) {
    const name = String(input.displayName || '').trim();
    if (!name) throw new ApiError(422, 'Nome obrigatorio');
    target.displayNameEncrypted = encrypt(name);
    target.displayNameHash = searchHash(normalizeSearch(name));
    target.displayNameSource = input.displayNameSource || 'manual';
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
  const channelInputs = options.providerManaged
    ? (input.channels || [])
    : (input.channels || []).map(manualIdentityInput);
  const desiredIdentities = channelInputs.map(encryptedIdentity);
  const values = {};
  assignBasicFields(values, input, true);
  if (options.providerManaged) values.displayNameSource = options.displayNameSource || input.channels?.[0]?.channel || 'provider';
  if (options.channelAvatar?.url) {
    values.channelAvatars = [{
      channel: options.channelAvatar.channel,
      urlEncrypted: encrypt(options.channelAvatar.url),
      updatedAt: new Date()
    }];
  }
  // Um contato novo e persistido inicialmente sem permissao efetiva. Para um
  // grant vindo do provedor, o evento e gravado antes da segunda escrita que
  // habilita o canal. Assim, uma falha de auditoria nunca deixa opt-in ativo.
  values.channels = desiredIdentities.map((identity, index) => {
    if (!options.providerManaged || !DECIDED_CONSENT_STATUSES.includes(identity.consentStatus)) return identity;
    return encryptedIdentity({
      ...channelInputs[index],
      authorized: false,
      consentStatus: 'unknown',
      consentSource: undefined,
      consentCommand: undefined,
      consentChangedAt: undefined,
      consentChangedBy: undefined
    });
  });
  try {
    const contact = await Contact.create(values);
    if (options.providerManaged) {
      const snapshots = contact.channels.map(consentSnapshot);
      let hasConsentChanges = false;
      try {
        for (let index = 0; index < channelInputs.length; index += 1) {
          const channelInput = channelInputs[index];
          const desired = desiredIdentities[index];
          if (!DECIDED_CONSENT_STATUSES.includes(desired.consentStatus)) continue;
          const context = {
            source: channelInput.consentSource || channelInput.source || 'provider',
            actorId: channelInput.consentChangedBy || actorId,
            command: channelInput.consentCommand,
            evidence: channelInput.consentEvidence
          };
          await auditConsent(contact._id, desired.channel, desired.consentStatus, context);
          applyConsent(contact.channels[index], desired.consentStatus, context, desired.consentChangedAt || new Date());
          hasConsentChanges = true;
        }
        if (hasConsentChanges) await contact.save();
      } catch (error) {
        contact.channels.forEach((identity, index) => restoreConsent(identity, snapshots[index]));
        throw error;
      }
    }
    return getById(contact._id);
  } catch (error) {
    const duplicate = duplicateContactError(error);
    if (duplicate) throw duplicate;
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

async function attachInviteOrigin(contactId, invite, context = {}) {
  const inviteId = invite?._id || invite?.id;
  const title = String(invite?.title || '').trim();
  const slug = String(invite?.slug || '').trim().toLowerCase();
  if (!inviteId || !title || !slug) {
    throw new ApiError(422, 'Convite invalido para atribuicao ao contato', null, 'INVITE_ORIGIN_INVALID');
  }
  const channel = context.channel && DELIVERY_CHANNELS.includes(context.channel)
    ? context.channel
    : null;
  const usedAt = context.usedAt ? new Date(context.usedAt) : new Date();
  const origin = {
    invite: inviteId,
    title,
    slug,
    channels: channel ? [channel] : [],
    firstUsedAt: usedAt,
    lastUsedAt: usedAt
  };
  const inserted = await Contact.updateOne(
    {
      _id: contactId,
      active: true,
      deletedAt: null,
      'inviteOrigins.invite': { $ne: inviteId }
    },
    {
      $push: { inviteOrigins: origin },
      $set: { inviteClickedAt: usedAt }
    }
  );
  const set = {
    'inviteOrigins.$.title': title,
    'inviteOrigins.$.slug': slug
  };
  const update = {
    $set: set,
    $max: {
      'inviteOrigins.$.lastUsedAt': usedAt,
      inviteClickedAt: usedAt
    }
  };
  if (channel) update.$addToSet = { 'inviteOrigins.$.channels': channel };
  const refreshed = await Contact.updateOne(
    {
      _id: contactId,
      active: true,
      deletedAt: null,
      'inviteOrigins.invite': inviteId
    },
    update
  );
  if (!inserted.matchedCount && !refreshed.matchedCount) {
    throw new ApiError(404, 'Contato nao encontrado');
  }
  return getById(contactId);
}

async function getManyByIds(ids) {
  const uniqueIds = [...new Set((ids || []).map(String))];
  if (!uniqueIds.length) return [];
  const contacts = await Contact.find({ _id: { $in: uniqueIds }, deletedAt: null }).select(SECRET_SELECT);
  return contacts.map((contact) => serialize(contact, { includeInlineAvatar: false }));
}

async function list(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { deletedAt: null };
  if (query.active !== undefined) filter.active = query.active;
  if (query.inviteId) filter['inviteOrigins.invite'] = query.inviteId;
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
  return pageResult(items.map((contact) => serialize(contact, { includeInlineAvatar: false })), total, page, limit);
}

async function update(id, input) {
  const contact = await getRawById(id);
  assignBasicFields(contact, input, false);
  if (input.channels !== undefined) {
    const currentByKey = new Map(contact.channels.map((identity) => [identity.channel + ':' + identity.addressHash, identity]));
    const incoming = input.channels.map((identityInput) => {
      const address = normalizeAddress(identityInput.channel, identityInput.address);
      const key = identityInput.channel + ':' + searchHash(address);
      const existing = currentByKey.get(key);
      if (!existing && identityInput.channel === 'telegram') {
        throw new ApiError(403, 'chat_id/consentimento Telegram e gerenciado pelo webhook', null, 'PROVIDER_IDENTITY_MANAGED');
      }
      const requestedStatus = identityInput.consentStatus
        || (identityInput.authorized === true ? 'granted' : identityInput.authorized === false ? 'unknown' : existing?.consentStatus || 'unknown');
      const requestedAuthorized = identityInput.authorized ?? requestedStatus === 'granted';
      if (existing && (requestedStatus !== existing.consentStatus || requestedAuthorized !== existing.authorized)) {
        throw new ApiError(
          409,
          'Altere permissoes pelo controle de consentimento do contato',
          null,
          'CONSENT_UPDATE_REQUIRES_ENDPOINT'
        );
      }
      if (!existing && (requestedAuthorized || requestedStatus !== 'unknown')) {
        throw new ApiError(
          409,
          'Crie a identidade sem permissao e conceda o consentimento pelo controle dedicado',
          null,
          'CONSENT_UPDATE_REQUIRES_ENDPOINT'
        );
      }
      const existingMetadata = existing ? safeDecrypt(existing.metadataEncrypted, true) || {} : {};
      const safeMetadata = identityInput.metadata === undefined
        ? existingMetadata
        : sanitizeAdministrativeIdentityMetadata(identityInput.metadata, existingMetadata);
      const incomingIdentity = encryptedIdentity({
        ...identityInput,
        authorized: existing?.authorized || false,
        consentStatus: existing?.consentStatus || 'unknown',
        source: existing?.source || 'manual',
        metadata: safeMetadata
      });
      if (existing) {
        incomingIdentity._id = existing._id;
        incomingIdentity.consentedAt = existing.consentedAt;
        incomingIdentity.consentSource = existing.consentSource;
        incomingIdentity.consentCommand = existing.consentCommand;
        incomingIdentity.consentChangedAt = existing.consentChangedAt;
        incomingIdentity.consentChangedBy = existing.consentChangedBy;
        if (identityInput.interactedAt === undefined) incomingIdentity.interactedAt = existing.interactedAt;
        if (identityInput.metadata === undefined) incomingIdentity.metadataEncrypted = existing.metadataEncrypted;
      }
      return incomingIdentity;
    });
    const incomingKeys = new Set(incoming.map((identity) => identity.channel + ':' + identity.addressHash));
    for (const existing of contact.channels) {
      if (existing.channel === 'telegram') continue;
      const key = existing.channel + ':' + existing.addressHash;
      if (!incomingKeys.has(key) && (existing.authorized || existing.consentStatus === 'granted')) {
        throw new ApiError(
          409,
          'Revogue a permissao antes de remover uma identidade',
          null,
          'CONSENT_UPDATE_REQUIRES_ENDPOINT'
        );
      }
    }
    const existingTelegram = contact.channels.filter((identity) => identity.channel === 'telegram');
    const nonTelegram = incoming.filter((identity) => identity.channel !== 'telegram');
    contact.channels = [...nonTelegram, ...existingTelegram];
  }
  try {
    await contact.save();
  } catch (error) {
    const duplicate = duplicateContactError(error);
    if (duplicate) throw duplicate;
    throw error;
  }
  return getById(id);
}

async function remove(id) {
  const contact = await Contact.findById(id);
  if (!contact) throw new ApiError(404, 'Contato nao encontrado');
  const artifacts = await removeContactArtifacts(id);
  await Promise.all([
    Contact.deleteOne({ _id: id }),
    ContactGroup.updateMany({ contacts: id }, { $pull: { contacts: id } })
  ]);
  return { id: String(id), removed: true, notificationsStopped: true, ...artifacts };
}

function setChannelAvatar(contact, channel, avatarUrl) {
  if (!avatarUrl) return;
  const existing = contact.channelAvatars.find((item) => item.channel === channel);
  if (existing) {
    existing.urlEncrypted = encrypt(avatarUrl);
    existing.updatedAt = new Date();
  } else {
    contact.channelAvatars.push({ channel, urlEncrypted: encrypt(avatarUrl), updatedAt: new Date() });
  }
}

async function updateChannelAvatar(id, channel, avatarUrl) {
  if (!avatarUrl) return getById(id);
  const contact = await getRawById(id);
  setChannelAvatar(contact, channel, avatarUrl);
  await contact.save();
  return serialize(contact);
}

function whatsappPendingList(contact) {
  if (!Array.isArray(contact.pendingWhatsappConsents)) contact.pendingWhatsappConsents = [];
  return contact.pendingWhatsappConsents;
}

function commandConsentMetadata(identity, sourceChannel) {
  const metadata = safeDecrypt(identity.metadataEncrypted, true) || {};
  identity.metadataEncrypted = encrypt({
    ...metadata,
    permissionCommandReceived: true,
    permissionCommandReceivedVia: sourceChannel,
    sharedWhatsappConsent: true
  });
}

function pendingConsentContext(pending) {
  return {
    source: pending.source || 'automatic_permission_command',
    command: pending.command,
    actorId: pending.changedBy,
    evidence: {
      ...(safeDecrypt(pending.evidenceEncrypted, true) || {}),
      receivedVia: pending.sourceChannel,
      propagatedAfterIdentityDiscovery: true
    }
  };
}

async function grantWhatsappConsentFromCommand(id, sourceChannel, context = {}) {
  if (!WHATSAPP_CHANNELS.includes(sourceChannel)) {
    throw new ApiError(422, 'Canal de origem WhatsApp invalido', null, 'INVALID_WHATSAPP_CONSENT_SOURCE');
  }
  const command = String(context.command || '').trim();
  if (!command) throw new ApiError(422, 'Comando de permissao obrigatorio', null, 'WHATSAPP_CONSENT_COMMAND_REQUIRED');

  const contact = await getRawById(id);
  if (!contact.channels.some((identity) => identity.channel === sourceChannel)) {
    throw new ApiError(409, 'Identidade de origem do comando nao encontrada', null, 'WHATSAPP_CONSENT_SOURCE_IDENTITY_MISSING');
  }

  const identities = contact.channels.filter((identity) => WHATSAPP_CHANNELS.includes(identity.channel));
  const changedIdentities = identities.filter((identity) => (
    !identity.authorized
    || identity.consentStatus !== 'granted'
    || identity.consentSource !== 'automatic_permission_command'
    || identity.consentCommand !== command
    || (safeDecrypt(identity.metadataEncrypted, true) || {}).permissionCommandReceivedVia !== sourceChannel
  ));
  const identitySnapshots = changedIdentities.map((identity) => ({
    identity,
    consent: consentSnapshot(identity),
    metadataEncrypted: identity.metadataEncrypted
  }));
  const previousPending = whatsappPendingList(contact).map((pending) => ({
    channel: pending.channel,
    sourceChannel: pending.sourceChannel,
    status: pending.status || 'granted',
    source: pending.source,
    command: pending.command,
    changedBy: pending.changedBy,
    evidenceEncrypted: pending.evidenceEncrypted,
    createdAt: pending.createdAt,
    changedAt: pending.changedAt
  }));
  const consentContext = {
    source: 'automatic_permission_command',
    command,
    evidence: {
      ...(context.evidence || {}),
      receivedVia: sourceChannel
    }
  };
  const identityChannels = new Set(identities.map((identity) => identity.channel));
  const pendingChannelsToChange = WHATSAPP_CHANNELS.filter((channel) => {
    if (identityChannels.has(channel)) return false;
    const current = whatsappPendingList(contact).find((pending) => pending.channel === channel);
    return current?.sourceChannel !== sourceChannel
      || (current?.status || 'granted') !== 'granted'
      || current?.source !== 'automatic_permission_command'
      || current?.command !== command;
  });
  const channelsToAudit = [...new Set([
    ...changedIdentities.map((identity) => identity.channel),
    ...pendingChannelsToChange
  ])];

  // Cada permissao (Web/Cloud) e auditada uma vez antes da unica escrita,
  // mesmo quando o contato possui mais de um endereco no mesmo provedor.
  // A decisao do canal ainda ausente tambem e auditada como pendente.
  for (const channel of channelsToAudit) {
    await auditConsent(contact._id, channel, 'granted', {
      ...consentContext,
      evidence: {
        ...consentContext.evidence,
        appliesTo: channel,
        stage: identityChannels.has(channel) ? 'effective_identity' : 'pending_identity'
      }
    });
  }

  const changedAt = new Date();
  for (const identity of changedIdentities) {
    applyConsent(identity, 'granted', consentContext, changedAt);
    commandConsentMetadata(identity, sourceChannel);
  }

  let pendingChanged = false;
  for (const channel of WHATSAPP_CHANNELS) {
    const pendingIndex = whatsappPendingList(contact).findIndex((pending) => pending.channel === channel);
    if (identityChannels.has(channel)) {
      if (pendingIndex >= 0) {
        contact.pendingWhatsappConsents.splice(pendingIndex, 1);
        pendingChanged = true;
      }
      continue;
    }
    const current = pendingIndex >= 0 ? contact.pendingWhatsappConsents[pendingIndex] : null;
    if (current?.sourceChannel === sourceChannel
      && (current?.status || 'granted') === 'granted'
      && current?.source === 'automatic_permission_command'
      && current?.command === command) continue;
    const pending = {
      channel,
      sourceChannel,
      status: 'granted',
      source: 'automatic_permission_command',
      command,
      evidenceEncrypted: encrypt(context.evidence || {}),
      createdAt: changedAt,
      changedAt
    };
    if (pendingIndex >= 0) contact.pendingWhatsappConsents.splice(pendingIndex, 1, pending);
    else contact.pendingWhatsappConsents.push(pending);
    pendingChanged = true;
  }

  if (!changedIdentities.length && !pendingChanged) return serialize(contact);
  try {
    await contact.save();
  } catch (error) {
    for (const snapshot of identitySnapshots) {
      restoreConsent(snapshot.identity, snapshot.consent);
      snapshot.identity.metadataEncrypted = snapshot.metadataEncrypted;
    }
    contact.pendingWhatsappConsents = previousPending;
    throw error;
  }
  return serialize(contact);
}

function mergePhoneIdentity(channel, phone, options = {}) {
  const verifiedTelegramPhone = channel === 'telegram' && options.verified === true;
  if (channel !== 'whatsapp_cloud' && !verifiedTelegramPhone) return null;
  const normalized = normalizeWhatsappE164(phone);
  const digits = String(normalized || '').replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(digits)) return null;
  const aliases = new Set([digits]);
  const brazilianWithoutNinthDigit = digits.match(/^55(\d{2})(\d{8})$/);
  const brazilianWithNinthDigit = digits.match(/^55(\d{2})9(\d{8})$/);
  if (brazilianWithoutNinthDigit) aliases.add('55' + brazilianWithoutNinthDigit[1] + '9' + brazilianWithoutNinthDigit[2]);
  if (brazilianWithNinthDigit) aliases.add('55' + brazilianWithNinthDigit[1] + brazilianWithNinthDigit[2]);
  return {
    normalized,
    digits,
    aliases: [...aliases],
    hashes: [...new Set([...aliases].flatMap((alias) => [searchHash(alias), searchHash('+' + alias)]))]
  };
}

async function findUniquePhoneContact(channel, phone, options = {}) {
  const identity = mergePhoneIdentity(channel, phone, options);
  if (!identity) return null;
  const matches = await Contact.find({ deletedAt: null, phoneHash: { $in: identity.hashes } })
    .select(SECRET_SELECT)
    .limit(2);
  return matches.length === 1 ? matches[0] : null;
}

function plainIdentity(identity) {
  if (identity?.toObject) return identity.toObject({ depopulate: true });
  return { ...identity };
}

function mergedInviteOrigins(targetOrigins = [], sourceOrigins = []) {
  const byInvite = new Map();
  for (const origin of [...targetOrigins, ...sourceOrigins]) {
    const value = origin?.toObject ? origin.toObject({ depopulate: true }) : { ...origin };
    const key = String(value.invite?._id || value.invite);
    if (!key || key === 'undefined') continue;
    const current = byInvite.get(key);
    if (!current) {
      byInvite.set(key, {
        ...value,
        channels: [...new Set(value.channels || [])]
      });
      continue;
    }
    current.title = value.title || current.title;
    current.slug = value.slug || current.slug;
    current.channels = [...new Set([...(current.channels || []), ...(value.channels || [])])];
    const firstDates = [current.firstUsedAt, value.firstUsedAt].filter(Boolean).map((date) => new Date(date));
    const lastDates = [current.lastUsedAt, value.lastUsedAt].filter(Boolean).map((date) => new Date(date));
    current.firstUsedAt = firstDates.length ? new Date(Math.min(...firstDates)) : undefined;
    current.lastUsedAt = lastDates.length ? new Date(Math.max(...lastDates)) : undefined;
  }
  return [...byInvite.values()];
}

function restoreArchivedTelegramSource(source, snapshot) {
  source.channels = snapshot.channels;
  source.emailEncrypted = snapshot.emailEncrypted;
  source.emailHash = snapshot.emailHash;
  source.phoneEncrypted = snapshot.phoneEncrypted;
  source.phoneHash = snapshot.phoneHash;
  source.telegramUsernameEncrypted = snapshot.telegramUsernameEncrypted;
  source.telegramUsernameHash = snapshot.telegramUsernameHash;
  source.channelAvatars = snapshot.channelAvatars;
  source.metadataEncrypted = snapshot.metadataEncrypted;
  source.deletedAt = snapshot.deletedAt;
}

async function migrateMergedContactReferences(sourceId, targetId) {
  const source = String(sourceId);
  const target = String(targetId);
  await Promise.all([
    AdminNotification.updateMany({ contact: source }, { $set: { contact: target } }),
    Conversation.updateMany({ contact: source }, { $set: { contact: target } }),
    ConversationMessage.updateMany({ contact: source }, { $set: { contact: target } }),
    Invite.updateMany({ recipientContact: source }, { $set: { recipientContact: target } }),
    InviteClick.updateMany({ contact: source }, { $set: { contact: target } }),
    ProfileAuthChallenge.updateMany({ contact: source }, { $set: { contact: target } }),
    ChatEmailChallenge.updateMany(
      { contact: source, status: { $in: ['pending_delivery', 'active', 'verifying'] } },
      { $set: { status: 'revoked', revokedAt: new Date() } }
    ),
    ConsentEvent.updateMany(
      { contact: source },
      { $set: { contact: target, contactReferenceHash: searchHash(target) } }
    ),
    Notification.updateMany(
      { 'deliveries.contact': source },
      { $set: { 'deliveries.$[delivery].contact': target } },
      { arrayFilters: [{ 'delivery.contact': source }] }
    )
  ]);
  await ContactGroup.updateMany({ contacts: source }, { $addToSet: { contacts: target } });
  await ContactGroup.updateMany({ contacts: source }, { $pull: { contacts: source } });
  await Notification.updateMany({ recipientContacts: source }, { $addToSet: { recipientContacts: target } });
  await Notification.updateMany({ recipientContacts: source }, { $pull: { recipientContacts: source } });
}

async function mergeTelegramSourceIntoPhoneTarget(source, target, addressHash, verifiedPhone) {
  if (!source || !target || String(source._id) === String(target._id)) {
    return { contact: target || source, sourceContactId: null };
  }
  const transferableIdentity = source.channels.find((identity) => (
    identity.channel === 'telegram' && identity.addressHash === addressHash
  ));
  if (!transferableIdentity) return { contact: target, sourceContactId: null };

  const sourceChannels = source.channels || [];
  const sourcePhone = normalizeWhatsappE164(safeDecrypt(source.phoneEncrypted));
  const sourceEmail = normalizeEmail(safeDecrypt(source.emailEncrypted));
  const targetEmail = normalizeEmail(safeDecrypt(target.emailEncrypted));
  const hasNonTelegramIdentity = sourceChannels.some((identity) => identity.channel !== 'telegram');
  const hasConflictingProfileData = (sourcePhone && sourcePhone !== verifiedPhone)
    || (sourceEmail && sourceEmail !== targetEmail);
  if (hasNonTelegramIdentity || hasConflictingProfileData) {
    throw new ApiError(
      409,
      'A identidade Telegram ja pertence a outro perfil com dados que exigem revisao administrativa',
      null,
      'TELEGRAM_CONTACT_MERGE_CONFLICT'
    );
  }

  const transferred = plainIdentity(transferableIdentity);
  const sourceTelegramAvatar = (source.channelAvatars || []).find((avatar) => avatar.channel === 'telegram');
  const sourceUsername = safeDecrypt(source.telegramUsernameEncrypted);
  const sourceName = safeDecrypt(source.displayNameEncrypted);
  const sourceMetadata = safeDecrypt(source.metadataEncrypted, true) || {};
  const snapshot = {
    channels: sourceChannels.map(plainIdentity),
    emailEncrypted: source.emailEncrypted,
    emailHash: source.emailHash,
    phoneEncrypted: source.phoneEncrypted,
    phoneHash: source.phoneHash,
    telegramUsernameEncrypted: source.telegramUsernameEncrypted,
    telegramUsernameHash: source.telegramUsernameHash,
    channelAvatars: (source.channelAvatars || []).map((avatar) => (
      avatar?.toObject ? avatar.toObject({ depopulate: true }) : { ...avatar }
    )),
    metadataEncrypted: source.metadataEncrypted,
    deletedAt: source.deletedAt
  };

  // Libera primeiro os indices unicos da identidade Telegram. Caso a gravacao
  // do destino falhe, o perfil de origem e restaurado antes de propagar o erro.
  source.channels = [];
  source.emailEncrypted = undefined;
  source.emailHash = undefined;
  source.phoneEncrypted = undefined;
  source.phoneHash = undefined;
  source.telegramUsernameEncrypted = undefined;
  source.telegramUsernameHash = undefined;
  source.channelAvatars = [];
  source.metadataEncrypted = encrypt({ ...sourceMetadata, mergedIntoContactId: String(target._id) });
  source.deletedAt = new Date();
  await source.save();

  target.channels.push(transferred);
  if (sourceUsername && !safeDecrypt(target.telegramUsernameEncrypted)) {
    target.telegramUsernameEncrypted = encrypt(sourceUsername);
    target.telegramUsernameHash = searchHash(normalizeTelegramUsername(sourceUsername));
  }
  if (sourceTelegramAvatar) {
    const avatarUrl = safeDecrypt(sourceTelegramAvatar.urlEncrypted);
    if (avatarUrl) setChannelAvatar(target, 'telegram', avatarUrl);
  }
  if (sourceName && target.displayNameSource !== 'manual') {
    target.displayNameEncrypted = encrypt(sourceName);
    target.displayNameHash = searchHash(normalizeSearch(sourceName));
    target.displayNameSource = 'telegram';
  }
  target.tags = [...new Set([...(target.tags || []), ...(source.tags || [])])];
  target.inviteOrigins = mergedInviteOrigins(target.inviteOrigins || [], source.inviteOrigins || []);
  const inviteClickedAtValues = [target.inviteClickedAt, source.inviteClickedAt].filter(Boolean).map((date) => new Date(date));
  if (inviteClickedAtValues.length) target.inviteClickedAt = new Date(Math.max(...inviteClickedAtValues));

  try {
    await target.save();
  } catch (error) {
    restoreArchivedTelegramSource(source, snapshot);
    await source.save();
    throw error;
  }
  await migrateMergedContactReferences(source._id, target._id);
  return { contact: target, sourceContactId: String(source._id) };
}

async function findByChannelOrPhone(channel, address, phone) {
  const byAddress = await findByChannelAddress(channel, address);
  if (byAddress) return byAddress;
  const byPhone = await findUniquePhoneContact(channel, phone);
  return byPhone ? serialize(byPhone) : null;
}

async function upsertFromChannelUnlocked({
  channel, address, displayName, phone, avatarUrl, metadata, source = 'inbound', authorize = false,
  consentStatus, consentSource, consentCommand, consentChangedBy, consentEvidence, refreshProfile = false,
  skipPendingWhatsappConsent = false, matchedContactId, phoneVerified = false
}) {
  const normalizedAddress = normalizeAddress(channel, address);
  const addressHash = searchHash(normalizedAddress);
  const trustedPhone = channel === 'telegram' && phoneVerified !== true ? null : phone;
  let mergedSourceContactId = null;
  let contact = await Contact.findOne({ channels: { $elemMatch: { channel, addressHash } } }).select(SECRET_SELECT);
  const phoneContact = trustedPhone && (!contact || channel === 'telegram')
    ? await findUniquePhoneContact(channel, trustedPhone, { verified: channel === 'telegram' })
    : null;
  if (contact && phoneContact && String(contact._id) !== String(phoneContact._id) && channel === 'telegram') {
    const merged = await mergeTelegramSourceIntoPhoneTarget(
      contact,
      phoneContact,
      addressHash,
      mergePhoneIdentity('telegram', trustedPhone, { verified: true }).normalized
    );
    contact = merged.contact;
    mergedSourceContactId = merged.sourceContactId;
  }
  if (!contact) contact = phoneContact;
  if (!contact && matchedContactId) {
    contact = await Contact.findOne({ _id: matchedContactId, deletedAt: null }).select(SECRET_SELECT);
  }
  if (!contact) {
    const created = await create({
      displayName: displayName || normalizedAddress,
      phone: trustedPhone,
      channels: [{
        channel,
        address: normalizedAddress,
        authorized: authorize,
        consentStatus: consentStatus || (authorize ? 'granted' : 'unknown'),
        source,
        consentSource,
        consentCommand,
        consentChangedBy,
        consentEvidence,
        interactedAt: new Date(),
        metadata
      }]
    }, null, {
      providerManaged: true,
      displayNameSource: channel,
      channelAvatar: avatarUrl ? { channel, url: avatarUrl } : undefined
    });
    return { ...created, upsertState: { created: true, identityAdded: true } };
  }
  let identity = contact.channels.find((item) => item.channel === channel && item.addressHash === addressHash);
  const identityAdded = !identity;
  const pendingIndex = WHATSAPP_CHANNELS.includes(channel) && !skipPendingWhatsappConsent
    ? whatsappPendingList(contact).findIndex((pending) => pending.channel === channel)
    : -1;
  const pendingConsent = pendingIndex >= 0 ? contact.pendingWhatsappConsents[pendingIndex] : null;
  const previousPending = pendingConsent ? {
    channel: pendingConsent.channel,
    sourceChannel: pendingConsent.sourceChannel,
    status: pendingConsent.status || 'granted',
    source: pendingConsent.source,
    command: pendingConsent.command,
    changedBy: pendingConsent.changedBy,
    evidenceEncrypted: pendingConsent.evidenceEncrypted,
    createdAt: pendingConsent.createdAt,
    changedAt: pendingConsent.changedAt
  } : null;
  const explicitConsentStatus = consentStatus !== undefined
    ? consentStatus
    : authorize ? 'granted' : null;
  if (!identity) {
    contact.channels.push(encryptedIdentity({
      channel,
      address: normalizedAddress,
      authorized: false,
      consentStatus: explicitConsentStatus === 'granted' ? 'unknown' : explicitConsentStatus || 'unknown',
      source,
      interactedAt: new Date(),
      metadata
    }));
    identity = contact.channels[contact.channels.length - 1];
  }
  const previousConsent = consentSnapshot(identity);
  const previousMetadataEncrypted = identity.metadataEncrypted;
  const propagatedConsent = explicitConsentStatus === null && pendingConsent ? pendingConsent : null;
  let desiredConsentStatus = explicitConsentStatus
    || (propagatedConsent ? propagatedConsent.status || 'granted' : previousConsent.consentStatus);
  // Nunca transforme um registro legado inconsistente em grant apenas porque o
  // status isolado diz granted. A autorizacao efetiva sempre exige o par AND.
  if (explicitConsentStatus === null && !propagatedConsent
    && desiredConsentStatus === 'granted' && !previousConsent.authorized) {
    desiredConsentStatus = 'unknown';
  }
  const consentChanged = previousConsent.consentStatus !== desiredConsentStatus
    || previousConsent.authorized !== (desiredConsentStatus === 'granted');
  const consentContext = propagatedConsent
    ? pendingConsentContext(propagatedConsent)
    : {
        source: consentSource || source,
        actorId: consentChangedBy,
        command: consentCommand,
        evidence: consentEvidence
      };
  if (consentChanged && desiredConsentStatus === 'granted') {
    try {
      await auditConsent(contact._id, channel, desiredConsentStatus, consentContext);
    } catch (error) {
      if (identityAdded) contact.channels.splice(contact.channels.indexOf(identity), 1);
      throw error;
    }
    applyConsent(identity, desiredConsentStatus, consentContext);
    if (propagatedConsent) commandConsentMetadata(identity, propagatedConsent.sourceChannel);
  } else if (consentChanged) {
    applyConsent(identity, desiredConsentStatus, consentContext);
  }
  const pendingConsumed = Boolean(propagatedConsent && DECIDED_CONSENT_STATUSES.includes(desiredConsentStatus));
  if (pendingConsumed) contact.pendingWhatsappConsents.splice(pendingIndex, 1);
  identity.interactedAt = new Date();
  if (metadata) {
    const existingMetadata = safeDecrypt(identity.metadataEncrypted, true) || {};
    identity.metadataEncrypted = encrypt({ ...existingMetadata, ...metadata });
  }
  const currentDisplayName = safeDecrypt(contact.displayNameEncrypted);
  const providerManagedName = contact.displayNameSource && contact.displayNameSource !== 'manual'
    || !contact.displayNameSource && (!currentDisplayName || normalizeSearch(currentDisplayName) === normalizeSearch(normalizedAddress));
  if (displayName && (refreshProfile || providerManagedName)) {
    contact.displayNameEncrypted = encrypt(displayName);
    contact.displayNameHash = searchHash(normalizeSearch(displayName));
    contact.displayNameSource = channel;
  }
  const currentPhoneResolution = contactPhoneResolution(contact);
  const normalizedPhone = normalizeWhatsappE164(trustedPhone, {
    blockedIdentifiers: blockedPhoneIdentifiers(decodedIdentities(contact))
  });
  if (normalizedPhone && (
    refreshProfile
    || !contact.phoneEncrypted
    || currentPhoneResolution.storedUnsafe
    || !currentPhoneResolution.phone
  )) {
    contact.phoneEncrypted = encrypt(normalizedPhone);
    contact.phoneHash = searchHash(normalizedPhone);
  }
  setChannelAvatar(contact, channel, avatarUrl);
  try {
    await contact.save();
  } catch (error) {
    if (identityAdded) contact.channels.splice(contact.channels.indexOf(identity), 1);
    else if (consentChanged) {
      restoreConsent(identity, previousConsent);
      identity.metadataEncrypted = previousMetadataEncrypted;
    }
    if (pendingConsumed && previousPending) contact.pendingWhatsappConsents.splice(pendingIndex, 0, previousPending);
    if (error.code !== 11000) throw error;
    const concurrent = await Contact.findOne({ channels: { $elemMatch: { channel, addressHash } } }).select(SECRET_SELECT);
    if (concurrent) return { ...serialize(concurrent), upsertState: { created: false, identityAdded: false } };
    throw duplicateContactError(error);
  }
  const blockingAuditRetry = ['revoked', 'denied'].includes(explicitConsentStatus);
  if (desiredConsentStatus !== 'granted' && DECIDED_CONSENT_STATUSES.includes(desiredConsentStatus)
    && (consentChanged || blockingAuditRetry)) {
    // Revogacao/negacao falha fechada: o bloqueio ja esta persistido. Se o
    // evento falhar, o retry volta a esta linha mesmo sem uma nova mudanca.
    await auditConsent(contact._id, channel, desiredConsentStatus, consentContext);
  }
  return {
    ...serialize(contact),
    upsertState: {
      created: false,
      identityAdded,
      ...(mergedSourceContactId ? { merged: true, mergedSourceContactId } : {})
    }
  };
}

function providerUpsertKey(channel, address, phone, phoneVerified = false) {
  const phoneIdentity = mergePhoneIdentity(channel, phone, { verified: channel === 'telegram' && phoneVerified === true });
  if (phoneIdentity?.aliases?.length) {
    return 'phone:' + [...phoneIdentity.aliases].sort((left, right) => left.length - right.length || left.localeCompare(right))[0];
  }
  return channel + ':' + String(normalizeAddress(channel, address) || 'unknown');
}

async function upsertFromChannel(input) {
  const key = providerUpsertKey(input.channel, input.address, input.phone, input.phoneVerified);
  const previous = providerUpsertLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  providerUpsertLocks.set(key, current);
  await previous.catch(() => undefined);
  try {
    if (input.shareWhatsappConsent === true) {
      const initial = await upsertFromChannelUnlocked({
        ...input,
        authorize: false,
        consentStatus: undefined,
        consentSource: undefined,
        consentCommand: undefined,
        consentEvidence: undefined,
        skipPendingWhatsappConsent: true
      });
      const granted = await grantWhatsappConsentFromCommand(initial.id, input.channel, {
        command: input.consentCommand,
        evidence: input.consentEvidence
      });
      return { ...granted, upsertState: initial.upsertState };
    }
    return await upsertFromChannelUnlocked(input);
  } finally {
    release();
    if (providerUpsertLocks.get(key) === current) providerUpsertLocks.delete(key);
  }
}

async function findByChannelAddress(channel, address) {
  const normalizedAddress = normalizeAddress(channel, address);
  if (!normalizedAddress) return null;
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
  let address = decrypt(identity.addressEncrypted);
  if (channel === 'whatsapp_cloud') {
    address = cloudDeliveryAddress({
      raw: identity,
      address,
      metadata: safeDecrypt(identity.metadataEncrypted, true) || {}
    });
    if (!address) {
      throw new ApiError(
        409,
        'O contato nao possui telefone E.164 verificado para WhatsApp Cloud',
        null,
        'WHATSAPP_PHONE_UNAVAILABLE'
      );
    }
  } else if (channel === 'telegram') {
    address = telegramDeliveryAddress({
      raw: identity,
      address,
      metadata: safeDecrypt(identity.metadataEncrypted, true) || {}
    });
    if (!address) {
      throw new ApiError(
        409,
        'O contato nao possui chat_id confirmado para Telegram',
        null,
        'TELEGRAM_CHAT_UNAVAILABLE'
      );
    }
  }
  return { address, addressHash: identity.addressHash, contact: serialize(contact) };
}

function validChatEmail(value) {
  const normalized = normalizeEmail(value);
  if (!normalized || normalized.length > 254 || /\s/.test(normalized)) return null;
  const separator = normalized.lastIndexOf('@');
  if (separator <= 0 || separator === normalized.length - 1) return null;
  const local = normalized.slice(0, separator);
  const domain = normalized.slice(separator + 1);
  if (local.length > 64 || !domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return null;
  return normalized;
}

async function setEmailFromChat(id, value, context = {}) {
  const email = validChatEmail(value);
  if (!email) throw new ApiError(422, 'Email invalido', null, 'INVALID_EMAIL');
  const sourceChannel = String(context.channel || '').trim();
  if (!['telegram', 'whatsapp_cloud'].includes(sourceChannel)) {
    throw new ApiError(422, 'Canal de origem da atualizacao de email invalido', null, 'INVALID_EMAIL_SOURCE_CHANNEL');
  }
  const contact = await getRawById(id);
  const emailHash = searchHash(email);
  const owner = await Contact.findOne({
    _id: { $ne: contact._id },
    deletedAt: null,
    $or: [
      { emailHash },
      { channels: { $elemMatch: { channel: 'email', addressHash: emailHash } } }
    ]
  }).select('_id');
  if (owner) {
    // Digitar um endereco em um chat autenticado pelo provedor nao comprova a
    // posse da caixa de email. O merge fica bloqueado ate o usuario validar o
    // codigo no Meu perfil, evitando que um contato tome o cadastro de outro.
    throw new ApiError(
      409,
      'Email ja pertence a outro perfil e exige verificacao de titularidade',
      null,
      'EMAIL_OWNERSHIP_VERIFICATION_REQUIRED'
    );
  }

  contact.emailEncrypted = encrypt(email);
  contact.emailHash = emailHash;
  const emailIdentities = contact.channels.filter((identity) => identity.channel === 'email');
  const retainedIdentity = emailIdentities.find((identity) => (
    identity.authorized && identity.consentStatus === 'granted'
  )) || emailIdentities[0];
  let revocationAudit = null;
  if (retainedIdentity) {
    const addressChanged = retainedIdentity.addressHash !== emailHash;
    const metadata = safeDecrypt(retainedIdentity.metadataEncrypted, true) || {};
    const pendingAudit = metadata.pendingConsentAudit;
    if (addressChanged && (retainedIdentity.authorized || retainedIdentity.consentStatus === 'granted')) {
      revocationAudit = {
        source: 'chat_profile_email_change',
        purpose: 'notification_delivery',
        operationId: crypto.randomUUID(),
        evidence: {
          channel: sourceChannel,
          previousAddressReferenceHash: retainedIdentity.addressHash,
          replacementAddressReferenceHash: emailHash,
          replacementRequiresConsent: true
        }
      };
      revocationAudit.evidence.operationId = revocationAudit.operationId;
    } else if (!addressChanged && pendingAudit?.kind === 'email_replacement_revocation') {
      revocationAudit = {
        source: 'chat_profile_email_change',
        purpose: 'notification_delivery',
        operationId: pendingAudit.operationId,
        evidence: {
          channel: pendingAudit.channel || sourceChannel,
          previousAddressReferenceHash: pendingAudit.previousAddressReferenceHash,
          replacementAddressReferenceHash: pendingAudit.replacementAddressReferenceHash || emailHash,
          replacementRequiresConsent: true,
          operationId: pendingAudit.operationId
        }
      };
    }
    retainedIdentity.addressEncrypted = encrypt(email);
    retainedIdentity.addressHash = emailHash;
    retainedIdentity.interactedAt = new Date();
    if (addressChanged) {
      retainedIdentity.authorized = false;
      retainedIdentity.consentStatus = 'unknown';
      retainedIdentity.source = 'chat_profile';
      retainedIdentity.consentedAt = undefined;
      retainedIdentity.consentSource = undefined;
      retainedIdentity.consentCommand = undefined;
      retainedIdentity.consentChangedAt = undefined;
      retainedIdentity.consentChangedBy = undefined;
    }
    retainedIdentity.metadataEncrypted = encrypt({
      ...metadata,
      lastProfileUpdateSource: 'chat',
      lastProfileUpdateChannel: sourceChannel,
      ...(revocationAudit ? {
        pendingConsentAudit: {
          kind: 'email_replacement_revocation',
          channel: revocationAudit.evidence.channel,
          previousAddressReferenceHash: revocationAudit.evidence.previousAddressReferenceHash,
          replacementAddressReferenceHash: revocationAudit.evidence.replacementAddressReferenceHash,
          operationId: revocationAudit.operationId,
          createdAt: pendingAudit?.createdAt || new Date().toISOString()
        }
      } : {})
    });
    contact.channels = [
      ...contact.channels.filter((identity) => identity.channel !== 'email'),
      retainedIdentity
    ];
  } else {
    contact.channels.push(encryptedIdentity({
      channel: 'email',
      address: email,
      authorized: false,
      consentStatus: 'unknown',
      source: 'chat_profile',
      interactedAt: new Date(),
      metadata: {
        lastProfileUpdateSource: 'chat',
        lastProfileUpdateChannel: sourceChannel
      }
    }));
  }

  try {
    await contact.save();
  } catch (error) {
    const duplicate = duplicateContactError(error);
    if (duplicate) throw duplicate;
    throw error;
  }
  // Revogacoes sao persistidas antes da auditoria (fail-closed). Assim, uma
  // falha de validacao/indice nunca deixa um evento dizendo que o endereco
  // antigo foi revogado enquanto ele ainda permanece autorizado no contato.
  if (revocationAudit) {
    await auditConsent(contact._id, 'email', 'revoked', revocationAudit);
    const metadata = safeDecrypt(retainedIdentity.metadataEncrypted, true) || {};
    const pendingConsentAudit = metadata.pendingConsentAudit;
    delete metadata.pendingConsentAudit;
    retainedIdentity.metadataEncrypted = encrypt(metadata);
    try {
      await contact.save();
    } catch (error) {
      retainedIdentity.metadataEncrypted = encrypt({
        ...metadata,
        pendingConsentAudit
      });
      throw error;
    }
  }
  const operationId = context.operationId || crypto.randomUUID();
  const evidence = {
    sourceChannel,
    interaction: context.verificationMethod === 'chat_email_code'
      ? 'email_verified_by_chat_code'
      : 'email_submitted_after_consent_prompt',
    ...(context.verificationMethod ? { verificationMethod: context.verificationMethod } : {}),
    addressReferenceHash: emailHash,
    operationId
  };
  if (context.providerMessageId !== undefined && context.providerMessageId !== null) {
    evidence.providerMessageReferenceHash = searchHash(
      `chat-email-message:${sourceChannel}:${String(context.providerMessageId)}`
    );
  }
  if (context.updateId !== undefined && context.updateId !== null) {
    evidence.providerUpdateReferenceHash = searchHash(
      `chat-email-update:${sourceChannel}:${String(context.updateId)}`
    );
  }
  return setChannelConsent(contact._id, 'email', 'granted', {
    source: 'chat_email_explicit_opt_in',
    legalBasis: 'consent',
    purpose: 'notification_delivery',
    operationId,
    evidence
  });
}

async function ensureEmailIdentity(id) {
  const contact = await getRawById(id);
  const email = normalizeEmail(safeDecrypt(contact.emailEncrypted));
  if (!email) {
    throw new ApiError(409, 'Cadastre um email antes de ativar este canal', null, 'EMAIL_IDENTITY_UNAVAILABLE');
  }
  const addressHash = searchHash(email);
  if (contact.channels.some((identity) => identity.channel === 'email' && identity.addressHash === addressHash)) {
    return serialize(contact);
  }
  contact.channels.push(encryptedIdentity({
    channel: 'email',
    address: email,
    authorized: false,
    consentStatus: 'unknown',
    source: 'self_service_profile',
    interactedAt: new Date()
  }));
  try {
    await contact.save();
  } catch (error) {
    const duplicate = duplicateContactError(error);
    if (duplicate) throw duplicate;
    throw error;
  }
  return serialize(contact);
}

async function repairLegacyWhatsappPhones() {
  const contacts = await Contact.find({
    deletedAt: null,
    phoneEncrypted: { $exists: true, $ne: null }
  }).select(SECRET_SELECT);
  const summary = { scanned: contacts.length, repaired: 0, cleared: 0, conflicts: 0 };
  for (const contact of contacts) {
    const resolution = contactPhoneResolution(contact);
    if (!resolution.storedUnsafe) continue;
    let replacement = resolution.phone;
    if (replacement) {
      const identity = mergePhoneIdentity('whatsapp_cloud', replacement);
      const duplicate = identity && await Contact.exists({
        _id: { $ne: contact._id },
        deletedAt: null,
        phoneHash: { $in: identity.hashes }
      });
      if (duplicate) {
        replacement = null;
        summary.conflicts += 1;
      }
    }
    contact.phoneEncrypted = replacement ? encrypt(replacement) : undefined;
    contact.phoneHash = replacement ? searchHash(replacement) : undefined;
    await contact.save();
    if (replacement) summary.repaired += 1;
    else summary.cleared += 1;
  }
  return summary;
}

async function setChannelConsent(id, channel, status, context = {}) {
  const isTelegramGrant = channel === 'telegram' && status === 'granted';
  const isAuthenticatedAdminGrant = isTelegramGrant
    && context.source === 'admin_manual'
    && Boolean(context.actorId);
  if (isTelegramGrant && !context.providerManaged && !isAuthenticatedAdminGrant) {
    throw new ApiError(403, 'Consentimento Telegram so pode ser concedido por interacao privada verificada', null, 'PROVIDER_CONSENT_MANAGED');
  }
  const contact = await getRawById(id);
  const identities = contact.channels.filter((item) => item.channel === channel);
  if (
    isAuthenticatedAdminGrant
    && !identities.some((identity) => (
      identity.addressEncrypted
      && String(identity.source || '').startsWith('telegram_')
    ))
  ) {
    throw new ApiError(
      403,
      'A permissao administrativa exige uma identidade Telegram verificada pelo bot',
      null,
      'TELEGRAM_IDENTITY_UNVERIFIED'
    );
  }
  const pendingIndex = WHATSAPP_CHANNELS.includes(channel)
    ? whatsappPendingList(contact).findIndex((pending) => pending.channel === channel)
    : -1;
  const pending = pendingIndex >= 0 ? contact.pendingWhatsappConsents[pendingIndex] : null;
  if (!identities.length) {
    if (!pending) throw new ApiError(404, 'Identidade do canal nao encontrada');
    if (status === 'granted') {
      throw new ApiError(
        409,
        'A permissao esta pendente ate o provedor identificar um destino real',
        null,
        'WHATSAPP_IDENTITY_PENDING'
      );
    }
    const pendingSnapshot = {
      status: pending.status || 'granted',
      source: pending.source,
      changedBy: pending.changedBy,
      evidenceEncrypted: pending.evidenceEncrypted,
      changedAt: pending.changedAt
    };
    pending.status = status;
    pending.source = context.source || 'contact_manager';
    pending.changedBy = context.actorId || null;
    pending.evidenceEncrypted = context.evidence ? encrypt(context.evidence) : pending.evidenceEncrypted;
    pending.changedAt = new Date();
    try {
      await contact.save();
    } catch (error) {
      Object.assign(pending, pendingSnapshot);
      throw error;
    }
    // Save-first: a decisao pendente bloqueada nunca volta a conceder o canal,
    // mesmo se a auditoria estiver temporariamente indisponivel.
    await auditConsent(contact._id, channel, status, context);
    return serialize(contact);
  }
  const changed = identities.some((identity) => identity.consentStatus !== status || identity.authorized !== (status === 'granted'));
  const snapshots = identities.map(consentSnapshot);
  const pendingSnapshot = pending ? {
    channel: pending.channel,
    sourceChannel: pending.sourceChannel,
    status: pending.status || 'granted',
    source: pending.source,
    command: pending.command,
    changedBy: pending.changedBy,
    evidenceEncrypted: pending.evidenceEncrypted,
    createdAt: pending.createdAt,
    changedAt: pending.changedAt
  } : null;
  if (status === 'granted') {
    if (!changed && !pending) return serialize(contact);
    // Grant e audit-first: se o evento falhar, nenhuma escrita habilita o canal.
    if (changed) await auditConsent(contact._id, channel, status, context);
    const changedAt = new Date();
    if (changed) identities.forEach((identity) => applyConsent(identity, status, context, changedAt));
    if (pending) contact.pendingWhatsappConsents.splice(pendingIndex, 1);
    try {
      await contact.save();
    } catch (error) {
      identities.forEach((identity, index) => restoreConsent(identity, snapshots[index]));
      if (pendingSnapshot) contact.pendingWhatsappConsents.splice(pendingIndex, 0, pendingSnapshot);
      throw error;
    }
    return serialize(contact);
  }

  if (changed || pending) {
    const changedAt = new Date();
    if (changed) identities.forEach((identity) => applyConsent(identity, status, context, changedAt));
    if (pending) contact.pendingWhatsappConsents.splice(pendingIndex, 1);
    try {
      await contact.save();
    } catch (error) {
      identities.forEach((identity, index) => restoreConsent(identity, snapshots[index]));
      if (pendingSnapshot) contact.pendingWhatsappConsents.splice(pendingIndex, 0, pendingSnapshot);
      throw error;
    }
  }
  // Revoke/deny e save-first para falhar fechado. Mesmo quando o estado ja esta
  // bloqueado, repetimos a auditoria: isso torna recuperavel uma falha anterior
  // ocorrida depois da persistencia do bloqueio.
  await auditConsent(contact._id, channel, status, context);
  return serialize(contact);
}

module.exports = {
  create,
  getById,
  getManyByIds,
  getRawById,
  list,
  update,
  remove,
  upsertFromChannel,
  findByChannelAddress,
  findByChannelOrPhone,
  setConsentByAddress,
  getDestination,
  attachInviteOrigin,
  setChannelConsent,
  grantWhatsappConsentFromCommand,
  ensureEmailIdentity,
  setEmailFromChat,
  repairLegacyWhatsappPhones,
  updateChannelAvatar,
  serialize,
  mergePhoneIdentity,
  mergedInviteOrigins,
  contactPhoneResolution,
  SECRET_SELECT
};
