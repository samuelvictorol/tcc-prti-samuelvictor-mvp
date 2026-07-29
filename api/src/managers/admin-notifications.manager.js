const AdminNotification = require('../models/admin-notification.model');
const ApiError = require('../utils/api-error');
const { emit } = require('../services/socket.service');
const { redact } = require('./logs.manager');
const { parsePagination, pageResult } = require('../utils/pagination');

const ADMIN_NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function unreadFilter(adminId) {
  return { reads: { $not: { $elemMatch: { admin: adminId } } } };
}

function readFilter(adminId) {
  return { reads: { $elemMatch: { admin: adminId } } };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function historyCutoff(now = new Date()) {
  return new Date(now.getTime() - ADMIN_NOTIFICATION_RETENTION_MS);
}

function createdAtFilter(query = {}, now = new Date()) {
  const cutoff = historyCutoff(now);
  const from = query.dateFrom instanceof Date ? query.dateFrom : (query.dateFrom ? new Date(query.dateFrom) : null);
  const to = query.dateTo instanceof Date ? query.dateTo : (query.dateTo ? new Date(query.dateTo) : null);
  return {
    $gte: from && from > cutoff ? from : cutoff,
    $lte: to && to < now ? to : now
  };
}

function listFilter(query = {}, adminId, now = new Date()) {
  const filter = { createdAt: createdAtFilter(query, now) };
  if (query.channel) filter.channel = query.channel;
  if (query.kind || query.type) filter.kind = query.kind || query.type;
  if (query.read === true) Object.assign(filter, readFilter(adminId));
  if (query.read === false || (query.read === undefined && query.unread === true)) {
    Object.assign(filter, unreadFilter(adminId));
  }
  if (query.search) {
    const expression = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [
      { title: expression },
      { message: expression },
      { kind: expression },
      { channel: expression }
    ];
  }
  return filter;
}

function serialize(item, adminId) {
  const value = item?.toObject ? item.toObject() : item;
  const contactId = value.contact ? String(value.contact._id || value.contact) : null;
  const currentRead = adminId
    ? (value.reads || []).find((read) => String(read.admin?._id || read.admin) === String(adminId))
    : null;
  return {
    id: String(value._id),
    kind: value.kind,
    channel: value.channel,
    title: value.title,
    message: value.message,
    contactId,
    contactPath: contactId ? '/contacts/' + contactId : null,
    context: redact(value.context || {}),
    read: Boolean(currentRead),
    readAt: currentRead?.readAt || null,
    createdAt: value.createdAt,
    expiresAt: value.retentionUntil || null
  };
}

async function create(input) {
  const retentionUntil = new Date(Date.now() + ADMIN_NOTIFICATION_RETENTION_MS);
  const notification = await AdminNotification.create({
    kind: String(input.kind).slice(0, 80),
    channel: String(input.channel || 'system').slice(0, 80),
    title: String(input.title).slice(0, 200),
    message: String(input.message).slice(0, 1000),
    contact: input.contactId,
    context: redact(input.context || {}),
    retentionUntil
  });
  const output = serialize(notification);
  emit('admin_notification:created', output);
  return output;
}

async function list(query = {}, adminId) {
  const { page, limit, skip } = parsePagination(query);
  const now = new Date();
  const filter = listFilter(query, adminId, now);
  const activeFilter = { createdAt: createdAtFilter({}, now) };
  const [items, total, unread, channels, kinds] = await Promise.all([
    AdminNotification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AdminNotification.countDocuments(filter),
    AdminNotification.countDocuments({ ...activeFilter, ...unreadFilter(adminId) }),
    AdminNotification.distinct('channel', activeFilter),
    AdminNotification.distinct('kind', activeFilter)
  ]);
  return {
    ...pageResult(items.map((item) => serialize(item, adminId)), total, page, limit),
    unread,
    filters: {
      channels: channels.filter(Boolean).sort(),
      kinds: kinds.filter(Boolean).sort()
    }
  };
}

async function unreadCount(adminId) {
  return {
    unread: await AdminNotification.countDocuments({
      createdAt: createdAtFilter({}),
      ...unreadFilter(adminId)
    })
  };
}

function isInsideHistoryWindow(notification, now = new Date()) {
  if (!notification?.createdAt) return true;
  const createdAt = new Date(notification.createdAt);
  return createdAt >= historyCutoff(now) && createdAt <= now;
}

async function getById(id, adminId) {
  const notification = await AdminNotification.findById(id);
  if (!notification || !isInsideHistoryWindow(notification)) {
    throw new ApiError(404, 'Notificacao administrativa nao encontrada');
  }
  return serialize(notification, adminId);
}

async function markRead(id, adminId) {
  const notification = await AdminNotification.findById(id);
  if (!notification || !isInsideHistoryWindow(notification)) {
    throw new ApiError(404, 'Notificacao administrativa nao encontrada');
  }
  if (!(notification.reads || []).some((read) => String(read.admin) === String(adminId))) {
    notification.reads.push({ admin: adminId, readAt: new Date() });
    await notification.save();
  }
  return serialize(notification, adminId);
}

async function markAllRead(adminId) {
  const result = await AdminNotification.updateMany(
    { createdAt: createdAtFilter({}), ...unreadFilter(adminId) },
    { $push: { reads: { admin: adminId, readAt: new Date() } } }
  );
  return { marked: result.modifiedCount || 0, unread: 0 };
}

async function enforceRetentionPolicy(now = new Date()) {
  const cutoff = historyCutoff(now);
  const deleted = await AdminNotification.deleteMany({ createdAt: { $lt: cutoff } });
  const migrated = await AdminNotification.updateMany(
    {
      createdAt: { $gte: cutoff },
      $expr: {
        $ne: ['$retentionUntil', { $add: ['$createdAt', ADMIN_NOTIFICATION_RETENTION_MS] }]
      }
    },
    [{ $set: { retentionUntil: { $add: ['$createdAt', ADMIN_NOTIFICATION_RETENTION_MS] } } }]
  );
  return {
    deleted: deleted.deletedCount || 0,
    migrated: migrated.modifiedCount || 0
  };
}

module.exports = {
  ADMIN_NOTIFICATION_RETENTION_MS,
  create,
  list,
  unreadCount,
  getById,
  markRead,
  markAllRead,
  enforceRetentionPolicy,
  serialize,
  unreadFilter,
  readFilter,
  createdAtFilter,
  listFilter
};
