const adminNotificationsManager = require('../managers/admin-notifications.manager');

async function list(req, res) {
  res.json({ success: true, data: await adminNotificationsManager.list(req.validated.query, req.admin.id) });
}

async function unreadCount(req, res) {
  res.json({ success: true, data: await adminNotificationsManager.unreadCount(req.admin.id) });
}

async function getById(req, res) {
  res.json({
    success: true,
    data: await adminNotificationsManager.getById(req.validated.params.id, req.admin.id)
  });
}

async function markRead(req, res) {
  res.json({ success: true, data: await adminNotificationsManager.markRead(req.validated.params.id, req.admin.id) });
}

async function markAllRead(req, res) {
  res.json({ success: true, data: await adminNotificationsManager.markAllRead(req.admin.id) });
}

module.exports = { list, unreadCount, getById, markRead, markAllRead };
