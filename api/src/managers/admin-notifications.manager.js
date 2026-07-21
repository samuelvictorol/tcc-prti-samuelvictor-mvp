const AdminNotification = require('../models/admin-notification.model');
const ApiError = require('../utils/api-error');
const { emit } = require('../services/socket.service');
const { redact } = require('./logs.manager');
const { parsePagination, pageResult } = require('../utils/pagination');

function unreadFilter(adminId) {
  return { reads: { $not: { $elemMatch: { admin: adminId } } } };
}

function serialize(item, adminId) {
  const value = item?.toObject ? item.toObject() : item;
  const contactId = value.contact ? String(value.contact._id || value.contact) : null;
  return {
    id: String(value._id),
    kind: value.kind,
    channel: value.channel,
    title: value.title,
    message: value.message,
    contactId,
    contactPath: contactId ? '/contacts/' + contactId : null,
    context: value.context || {},
    read: adminId ? (value.reads || []).some((read) => String(read.admin?._id || read.admin) === String(adminId)) : false,
    createdAt: value.createdAt
  };
}

async function create(input) {
  const notification = await AdminNotification.create({
    kind: String(input.kind).slice(0, 80),
    channel: String(input.channel || 'system').slice(0, 80),
    title: String(input.title).slice(0, 200),
    message: String(input.message).slice(0, 1000),
    contact: input.contactId,
    context: redact(input.context || {}),
    retentionUntil: input.retentionUntil || new Date(Date.now() + 180 * 24 * 60 * 60 * 1000)
  });
  const output = serialize(notification);
  emit('admin_notification:created', output);
  return output;
}

async function list(query = {}, adminId) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.channel) filter.channel = query.channel;
  if (query.kind) filter.kind = query.kind;
  if (query.unread === true) Object.assign(filter, unreadFilter(adminId));
  const [items, total, unread] = await Promise.all([
    AdminNotification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AdminNotification.countDocuments(filter),
    AdminNotification.countDocuments(unreadFilter(adminId))
  ]);
  return { ...pageResult(items.map((item) => serialize(item, adminId)), total, page, limit), unread };
}

async function unreadCount(adminId) {
  return { unread: await AdminNotification.countDocuments(unreadFilter(adminId)) };
}

async function markRead(id, adminId) {
  const notification = await AdminNotification.findById(id);
  if (!notification) throw new ApiError(404, 'Notificacao administrativa nao encontrada');
  if (!(notification.reads || []).some((read) => String(read.admin) === String(adminId))) {
    notification.reads.push({ admin: adminId, readAt: new Date() });
    await notification.save();
  }
  return serialize(notification, adminId);
}

async function markAllRead(adminId) {
  const result = await AdminNotification.updateMany(
    unreadFilter(adminId),
    { $push: { reads: { admin: adminId, readAt: new Date() } } }
  );
  return { marked: result.modifiedCount || 0, unread: 0 };
}

module.exports = { create, list, unreadCount, markRead, markAllRead, serialize, unreadFilter };
