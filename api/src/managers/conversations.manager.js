const Conversation = require('../models/conversation.model');
const ConversationMessage = require('../models/conversation-message.model');
const ApiError = require('../utils/api-error');
const { env } = require('../config/env');
const { encrypt, decrypt, searchHash } = require('../services/crypto.service');
const { parsePagination, pageResult } = require('../utils/pagination');
const { safeTemplateConversationMetadata } = require('../utils/whatsapp-cloud-templates');
const socketService = require('../services/socket.service');

// `whatsapp_web` e aceito apenas para manutencao/expiracao de documentos
// legados. Nao existe mais rota ou runtime capaz de criar novas sessoes Web.
const CHANNELS = ['telegram', 'whatsapp_web', 'whatsapp_cloud'];
const MAX_MESSAGES_PER_CONVERSATION = 500;
const MAX_BODY_LENGTH = 10_000;
const WHATSAPP_CLOUD_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const WHATSAPP_CLOUD_RETENTION_DAYS = 30;
const CONVERSATION_SECRET_SELECT = '+externalIdEncrypted +displayNameEncrypted +avatarUrlEncrypted +lastMessagePreviewEncrypted';
const MESSAGE_SECRET_SELECT = '+providerMessageIdEncrypted +bodyEncrypted +metadataEncrypted';

function safeDecrypt(value, json = false) {
  if (!value) return null;
  try { return decrypt(value, { json }); } catch (_error) { return null; }
}

function cloudServiceWindow(value, now = Date.now()) {
  if (value?.channel !== 'whatsapp_cloud') return null;
  const lastInboundAt = value.lastInboundAt ? new Date(value.lastInboundAt) : null;
  const persistedExpiry = value.serviceWindowExpiresAt ? new Date(value.serviceWindowExpiresAt) : null;
  const expiresAt = persistedExpiry && !Number.isNaN(persistedExpiry.getTime())
    ? persistedExpiry
    : lastInboundAt && !Number.isNaN(lastInboundAt.getTime())
      ? new Date(lastInboundAt.getTime() + WHATSAPP_CLOUD_SERVICE_WINDOW_MS)
      : null;
  const remainingMs = expiresAt ? Math.max(0, expiresAt.getTime() - Number(now)) : 0;
  return {
    open: remainingMs > 0,
    lastInboundAt,
    expiresAt,
    remainingSeconds: Math.ceil(remainingMs / 1000)
  };
}

function serializeConversation(conversation) {
  const value = conversation?.toObject ? conversation.toObject() : conversation;
  if (!value) return null;
  return {
    id: String(value._id),
    channel: value.channel,
    externalId: safeDecrypt(value.externalIdEncrypted),
    contactId: value.contact ? String(value.contact._id || value.contact) : null,
    groupId: value.group ? String(value.group._id || value.group) : null,
    isGroup: Boolean(value.isGroup),
    displayName: safeDecrypt(value.displayNameEncrypted),
    avatarUrl: safeDecrypt(value.avatarUrlEncrypted),
    lastMessage: value.lastMessageAt ? {
      preview: safeDecrypt(value.lastMessagePreviewEncrypted),
      direction: value.lastMessageDirection,
      type: value.lastMessageType,
      sentAt: value.lastMessageAt
    } : null,
    unreadCount: value.unreadCount || 0,
    messageCount: value.messageCount || 0,
    serviceWindow: cloudServiceWindow(value),
    retentionUntil: value.retentionUntil || null,
    pendingRegistration: value.channel === 'whatsapp_web' && !value.contact,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  };
}

function serializeMessage(message) {
  const value = message?.toObject ? message.toObject() : message;
  if (!value) return null;
  const body = safeDecrypt(value.bodyEncrypted);
  const metadata = safeTemplateConversationMetadata(
    safeDecrypt(value.metadataEncrypted, true),
    body
  );
  return {
    id: String(value._id),
    conversationId: String(value.conversation._id || value.conversation),
    contactId: value.contact ? String(value.contact._id || value.contact) : null,
    groupId: value.group ? String(value.group._id || value.group) : null,
    channel: value.channel,
    direction: value.direction,
    providerMessageId: safeDecrypt(value.providerMessageIdEncrypted),
    body,
    type: value.type,
    hasMedia: Boolean(value.hasMedia),
    sentAt: value.sentAt,
    metadata,
    createdAt: value.createdAt
  };
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function cloudRetentionUntil(sentAt = new Date()) {
  return new Date(normalizeDate(sentAt).getTime() + WHATSAPP_CLOUD_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

function legacyWhatsappWebRetentionUntil(now = Date.now()) {
  const days = Number(env.whatsappWebMessageRetentionDays || 90);
  return new Date(now + days * 24 * 60 * 60 * 1000);
}

function conversationAvatar(value) {
  if (!value) return null;
  const text = String(value);
  if (/^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(text)) return text.slice(0, 33_000);
  return text.slice(0, 2048);
}

function normalizeInput(input) {
  const channel = String(input.channel || '');
  if (!CHANNELS.includes(channel)) throw new ApiError(422, 'Canal de conversa invalido');
  const externalId = String(input.externalId || '').trim();
  if (!externalId) throw new ApiError(422, 'Identificador externo da conversa obrigatorio');
  const body = String(input.body || '').slice(0, MAX_BODY_LENGTH);
  const providerMessageId = input.providerMessageId === undefined || input.providerMessageId === null
    ? null
    : String(input.providerMessageId).slice(0, 1000);
  return {
    ...input,
    channel,
    externalId,
    body,
    providerMessageId,
    direction: input.direction === 'outbound' ? 'outbound' : 'inbound',
    type: String(input.type || 'text').slice(0, 80),
    sentAt: normalizeDate(input.sentAt)
  };
}

async function findOrCreateConversation(input) {
  const filter = { channel: input.channel, externalIdHash: searchHash(input.externalId) };
  const set = {};
  if (input.contactId && !input.isGroup) set.contact = input.contactId;
  if (input.groupId) set.group = input.groupId;
  if (input.displayName) set.displayNameEncrypted = encrypt(String(input.displayName).slice(0, 200));
  if (input.avatarUrl) set.avatarUrlEncrypted = encrypt(conversationAvatar(input.avatarUrl));
  if (input.isGroup !== undefined) set.isGroup = Boolean(input.isGroup);
  const update = {
    $set: set,
    $setOnInsert: {
      channel: input.channel,
      externalIdHash: filter.externalIdHash,
      externalIdEncrypted: encrypt(input.externalId)
    }
  };
  return Conversation.findOneAndUpdate(filter, update, { new: true, upsert: true, setDefaultsOnInsert: true })
    .select(CONVERSATION_SECRET_SELECT);
}

async function trimHistory(conversationId, currentCount) {
  if (currentCount <= MAX_MESSAGES_PER_CONVERSATION) return;
  const overflow = await ConversationMessage.find({ conversation: conversationId, tombstonedAt: { $exists: false } })
    .sort({ sentAt: -1, _id: -1 })
    .skip(MAX_MESSAGES_PER_CONVERSATION)
    .select('_id')
    .lean();
  if (!overflow.length) return;
  await tombstoneMessages({ _id: { $in: overflow.map((item) => item._id) } });
  await Conversation.updateOne({ _id: conversationId }, { $set: { messageCount: MAX_MESSAGES_PER_CONVERSATION } });
}

async function tombstoneMessages(filter) {
  const hashedFilter = {
    $and: [
      filter,
      { providerMessageIdHash: { $type: 'string' } },
      { tombstonedAt: { $exists: false } }
    ]
  };
  const unhashedFilter = {
    $and: [
      filter,
      {
        $or: [
          { providerMessageIdHash: { $exists: false } },
          { providerMessageIdHash: null }
        ]
      }
    ]
  };
  const tombstoned = await ConversationMessage.updateMany(hashedFilter, [{
    $set: {
      providerMessageIdEncrypted: '$$REMOVE',
      bodyEncrypted: '$$REMOVE',
      metadataEncrypted: '$$REMOVE',
      group: '$$REMOVE',
      channel: '$$REMOVE',
      direction: '$$REMOVE',
      sentAt: '$$REMOVE',
      type: '$$REMOVE',
      hasMedia: '$$REMOVE',
      tombstonedAt: '$$NOW',
      updatedAt: '$$NOW'
    }
  }]);
  const deleted = await ConversationMessage.deleteMany(unhashedFilter);
  return Number(tombstoned.modifiedCount || tombstoned.matchedCount || 0) + Number(deleted.deletedCount || 0);
}

async function tombstoneOrDeleteMessage(message, providerMessageId) {
  if (!providerMessageId) {
    await ConversationMessage.deleteOne({ _id: message._id });
    return;
  }
  await ConversationMessage.updateOne({ _id: message._id }, {
    $unset: {
      providerMessageIdEncrypted: 1,
      bodyEncrypted: 1,
      metadataEncrypted: 1,
      group: 1,
      channel: 1,
      direction: 1,
      sentAt: 1,
      type: 1,
      hasMedia: 1
    },
    $set: {
      tombstonedAt: new Date()
    }
  });
}

async function reserveConversationActivity(conversation, direction) {
  const observedHiddenAt = conversation.hiddenAt ? new Date(conversation.hiddenAt) : null;
  const filter = direction === 'inbound' && observedHiddenAt
    ? { _id: conversation._id, hiddenAt: observedHiddenAt }
    : { _id: conversation._id, hiddenAt: null };
  const update = { $inc: { activityVersion: 1 } };
  let reserved = await Conversation.findOneAndUpdate(filter, update, { new: true })
    .select(CONVERSATION_SECRET_SELECT);
  if (!reserved && direction === 'inbound' && observedHiddenAt) {
    reserved = await Conversation.findOneAndUpdate(
      { _id: conversation._id, hiddenAt: null },
      { $inc: { activityVersion: 1 } },
      { new: true }
    ).select(CONVERSATION_SECRET_SELECT);
  }
  return reserved;
}

async function hiddenGenerationDuplicate(conversation, providerMessageId) {
  if (!conversation.hiddenAt || !providerMessageId) return false;
  const duplicate = await ConversationMessage.findOne({
    conversation: conversation._id,
    providerMessageIdHash: searchHash(providerMessageId)
  }).select('activityVersion').lean();
  return Boolean(duplicate)
    && Number(duplicate.activityVersion || 0) <= Number(conversation.lastHiddenVersion || 0);
}

async function record(input) {
  const normalized = normalizeInput({ ...input, reopen: input.reopen ?? input.direction !== 'outbound' });
  const conversation = await findOrCreateConversation(normalized);
  if (await hiddenGenerationDuplicate(conversation, normalized.providerMessageId)) {
    return { conversation: serializeConversation(conversation), message: null, duplicate: true };
  }
  const reserved = await reserveConversationActivity(conversation, normalized.direction);
  if (!reserved) {
    return {
      conversation: serializeConversation(conversation),
      message: null,
      duplicate: false,
      discardedByRemoval: true
    };
  }
  const activityVersion = Number(reserved.activityVersion || 0);
  const retentionUntil = normalized.channel === 'whatsapp_cloud'
    ? cloudRetentionUntil(normalized.sentAt)
    : normalized.channel === 'whatsapp_web'
      ? legacyWhatsappWebRetentionUntil()
      : undefined;
  const messageValues = {
    conversation: conversation._id,
    contact: normalized.contactId,
    group: normalized.groupId,
    channel: normalized.channel,
    direction: normalized.direction,
    providerMessageIdEncrypted: encrypt(normalized.providerMessageId),
    providerMessageIdHash: normalized.providerMessageId ? searchHash(normalized.providerMessageId) : undefined,
    bodyEncrypted: encrypt(normalized.body),
    type: normalized.type,
    hasMedia: Boolean(normalized.hasMedia),
    sentAt: normalized.sentAt,
    retentionUntil,
    activityVersion,
    metadataEncrypted: normalized.metadata ? encrypt(normalized.metadata) : undefined
  };
  let message;
  try {
    message = await ConversationMessage.create(messageValues);
  } catch (error) {
    if (error.code === 11000) {
      return { conversation: serializeConversation(reserved), message: null, duplicate: true };
    }
    throw error;
  }
  const summaryUpdate = {
    $set: {
      lastMessagePreviewEncrypted: encrypt(normalized.body.slice(0, 240)),
      lastMessageDirection: normalized.direction,
      lastMessageType: normalized.type,
      lastMessageAt: normalized.sentAt
    },
    $inc: {
      messageCount: 1,
      unreadCount: normalized.direction === 'inbound' ? 1 : 0
    },
    ...(normalized.direction === 'inbound' ? { $unset: { hiddenAt: 1 } } : {})
  };
  if (retentionUntil && normalized.channel === 'whatsapp_cloud') {
    summaryUpdate.$max = { retentionUntil };
  } else if (retentionUntil) {
    summaryUpdate.$set.retentionUntil = retentionUntil;
  }
  if (normalized.channel === 'whatsapp_cloud' && normalized.direction === 'inbound') {
    summaryUpdate.$max = {
      ...(summaryUpdate.$max || {}),
      lastInboundAt: normalized.sentAt,
      serviceWindowExpiresAt: new Date(normalized.sentAt.getTime() + WHATSAPP_CLOUD_SERVICE_WINDOW_MS)
    };
  }
  const visibilityCondition = normalized.direction === 'inbound' && conversation.hiddenAt
    ? { $or: [{ hiddenAt: new Date(conversation.hiddenAt) }, { hiddenAt: null }] }
    : { hiddenAt: null };
  const updated = await Conversation.findOneAndUpdate({
    _id: conversation._id,
    $and: [
      visibilityCondition,
      {
        $or: [
          { lastHiddenVersion: { $exists: false } },
          { lastHiddenVersion: { $lt: activityVersion } }
        ]
      }
    ]
  }, summaryUpdate, { new: true }).select(CONVERSATION_SECRET_SELECT);
  if (!updated) {
    await tombstoneOrDeleteMessage(message, normalized.providerMessageId);
    return {
      conversation: serializeConversation(conversation),
      message: null,
      duplicate: false,
      discardedByRemoval: true
    };
  }
  await trimHistory(conversation._id, updated.messageCount || 0);
  if ((updated.messageCount || 0) > MAX_MESSAGES_PER_CONVERSATION) updated.messageCount = MAX_MESSAGES_PER_CONVERSATION;
  const result = { conversation: serializeConversation(updated), message: serializeMessage(message), duplicate: false };
  socketService.emit('conversation:message', result);
  socketService.emit('conversations:updated', { conversation: result.conversation });
  return result;
}

async function recordInbound(input) {
  return record({ ...input, direction: 'inbound' });
}

async function recordOutbound(input) {
  return record({ ...input, direction: 'outbound' });
}

async function upsertConversation(input) {
  const normalized = normalizeInput({ ...input, body: '', direction: 'inbound' });
  const conversation = await findOrCreateConversation(normalized);
  const result = serializeConversation(conversation);
  socketService.emit('conversations:updated', { conversation: result });
  return result;
}

async function attachContact(channel, externalId, contactId, profile = {}) {
  if (!contactId) throw new ApiError(422, 'Contato obrigatorio para associar conversa');
  const normalized = normalizeInput({ channel, externalId, body: '', direction: 'inbound' });
  const set = { contact: contactId };
  if (profile.displayName) set.displayNameEncrypted = encrypt(String(profile.displayName).slice(0, 200));
  if (profile.avatarUrl) set.avatarUrlEncrypted = encrypt(conversationAvatar(profile.avatarUrl));
  if (normalized.channel === 'whatsapp_web') set.retentionUntil = legacyWhatsappWebRetentionUntil();
  const conversation = await Conversation.findOneAndUpdate(
    { channel: normalized.channel, externalIdHash: searchHash(normalized.externalId) },
    { $set: set },
    { new: true }
  ).select(CONVERSATION_SECRET_SELECT);
  if (!conversation) return null;
  await ConversationMessage.updateMany(
    {
      conversation: conversation._id,
      $or: [{ contact: { $exists: false } }, { contact: null }]
    },
    { $set: { contact: contactId } }
  );
  const result = serializeConversation(conversation);
  socketService.emit('conversations:updated', { conversation: result });
  return result;
}

async function getRawById(id) {
  const conversation = await Conversation.findById(id).select(CONVERSATION_SECRET_SELECT);
  if (!conversation) throw new ApiError(404, 'Conversa nao encontrada');
  return conversation;
}

async function getById(id) {
  return serializeConversation(await getRawById(id));
}

async function requireOpenCloudServiceWindow(id, now = new Date()) {
  const conversation = await getRawById(id);
  if (conversation.channel !== 'whatsapp_cloud') {
    throw new ApiError(
      422,
      'A conversa nao pertence ao WhatsApp Cloud',
      null,
      'WHATSAPP_CLOUD_CONVERSATION_REQUIRED'
    );
  }
  const serviceWindow = cloudServiceWindow(conversation, now.getTime());
  if (!serviceWindow?.open) {
    throw new ApiError(
      409,
      'A janela de atendimento de 24 horas esta fechada; use um template oficial',
      {
        lastInboundAt: serviceWindow?.lastInboundAt || null,
        expiresAt: serviceWindow?.expiresAt || null
      },
      'WHATSAPP_CUSTOMER_SERVICE_WINDOW_CLOSED'
    );
  }
  return {
    conversation,
    serialized: serializeConversation(conversation),
    externalId: safeDecrypt(conversation.externalIdEncrypted),
    serviceWindow
  };
}

async function list(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = query.includeHidden ? {} : { hiddenAt: null };
  if (query.channel) filter.channel = query.channel;
  if (query.contactId) filter.contact = query.contactId;
  if (query.groupId) filter.group = query.groupId;
  if (query.isGroup !== undefined) filter.isGroup = query.isGroup;
  if (query.unreadOnly) filter.unreadCount = { $gt: 0 };
  const [items, total] = await Promise.all([
    Conversation.find(filter).select(CONVERSATION_SECRET_SELECT).sort({ lastMessageAt: -1, updatedAt: -1 }).skip(skip).limit(limit),
    Conversation.countDocuments(filter)
  ]);
  return pageResult(items.map(serializeConversation), total, page, limit);
}

async function listMessages(id, query = {}) {
  const conversation = await getRawById(id);
  const { page, limit, skip } = parsePagination(query);
  const filter = { conversation: id, tombstonedAt: { $exists: false } };
  const lastHiddenVersion = Number(conversation.lastHiddenVersion || 0);
  if (lastHiddenVersion > 0) filter.activityVersion = { $gt: lastHiddenVersion };
  const [items, total] = await Promise.all([
    ConversationMessage.find(filter).select(MESSAGE_SECRET_SELECT).sort({ sentAt: -1, _id: -1 }).skip(skip).limit(limit),
    ConversationMessage.countDocuments(filter)
  ]);
  return pageResult(items.map(serializeMessage), total, page, limit);
}

async function markRead(id) {
  const conversation = await Conversation.findOneAndUpdate(
    { _id: id, unreadCount: { $gt: 0 } },
    { $set: { unreadCount: 0 } },
    { new: true }
  )
    .select(CONVERSATION_SECRET_SELECT);
  if (!conversation) {
    return serializeConversation(await getRawById(id));
  }
  const result = serializeConversation(conversation);
  socketService.emit('conversations:updated', { conversation: result });
  return result;
}

async function clearHistory(id) {
  const nextVersion = { $add: [{ $ifNull: ['$activityVersion', 0] }, 1] };
  const clearedConversation = await Conversation.findOneAndUpdate(
    { _id: id },
    [{
      $set: {
        activityVersion: nextVersion,
        lastHiddenVersion: nextVersion,
        unreadCount: 0,
        messageCount: 0,
        lastMessagePreviewEncrypted: '$$REMOVE',
        lastMessageDirection: '$$REMOVE',
        lastMessageType: '$$REMOVE',
        lastMessageAt: '$$REMOVE'
      }
    }],
    { new: true }
  ).select(CONVERSATION_SECRET_SELECT);
  if (!clearedConversation) throw new ApiError(404, 'Conversa nao encontrada');
  const clearedVersion = Number(clearedConversation.lastHiddenVersion || clearedConversation.activityVersion || 0);
  const removedMessages = await tombstoneMessages({
    conversation: id,
    $or: [
      { activityVersion: { $lt: clearedVersion } },
      { activityVersion: { $exists: false } }
    ]
  });
  socketService.emit('conversation:history-removed', { conversationId: String(id) });
  return {
    id: String(id),
    historyRemoved: true,
    removedMessages,
    conversationPreserved: true,
    contactPreserved: Boolean(clearedConversation.contact),
    pendingRegistration: clearedConversation.channel === 'whatsapp_web' && !clearedConversation.contact
  };
}

async function remove(id) {
  const existing = await getRawById(id);
  const nextVersion = { $add: [{ $ifNull: ['$activityVersion', 0] }, 1] };
  const removedConversation = await Conversation.findOneAndUpdate(
    { _id: id },
    [{
      $set: {
        activityVersion: nextVersion,
        lastHiddenVersion: nextVersion,
        hiddenAt: '$$NOW',
        unreadCount: 0,
        messageCount: 0,
        lastMessagePreviewEncrypted: '$$REMOVE',
        lastMessageDirection: '$$REMOVE',
        lastMessageType: '$$REMOVE',
        lastMessageAt: '$$REMOVE'
      }
    }],
    { new: true }
  ).select(CONVERSATION_SECRET_SELECT);
  if (!removedConversation) throw new ApiError(404, 'Conversa nao encontrada');
  const hiddenVersion = Number(removedConversation?.lastHiddenVersion || removedConversation?.activityVersion || 0);
  socketService.emit('conversation:removed', { conversationId: String(id) });
  const removedMessages = await tombstoneMessages({
    conversation: id,
    $or: [
      { activityVersion: { $lt: hiddenVersion } },
      { activityVersion: { $exists: false } }
    ]
  });
  return {
    id: String(id), removed: true, hiddenUntilNextInbound: true,
    removedMessages,
    contactPreserved: Boolean(existing.contact),
    groupPreserved: Boolean(existing.group),
    pendingRegistration: existing.channel === 'whatsapp_web' && !existing.contact
  };
}

async function visibleExternalIds(channel, externalIds = []) {
  const unique = [...new Set(externalIds.map((value) => String(value || '').trim()).filter(Boolean))];
  if (!unique.length) return new Set();
  const hashToExternalId = new Map(unique.map((externalId) => [searchHash(externalId), externalId]));
  const hiddenHashes = await Conversation.find({
    channel,
    externalIdHash: { $in: [...hashToExternalId.keys()] },
    hiddenAt: { $ne: null }
  }).distinct('externalIdHash');
  const hidden = new Set(hiddenHashes);
  return new Set([...hashToExternalId].filter(([hash]) => !hidden.has(hash)).map(([, externalId]) => externalId));
}

module.exports = {
  record, recordInbound, recordOutbound, upsertConversation, attachContact, getById, list, listMessages, markRead, clearHistory, remove,
  requireOpenCloudServiceWindow, cloudServiceWindow,
  serializeConversation, serializeMessage, visibleExternalIds, MAX_MESSAGES_PER_CONVERSATION, MAX_BODY_LENGTH,
  WHATSAPP_CLOUD_SERVICE_WINDOW_MS, WHATSAPP_CLOUD_RETENTION_DAYS, cloudRetentionUntil,
  whatsappWebRetentionUntil: legacyWhatsappWebRetentionUntil, _trimHistory: trimHistory
};
