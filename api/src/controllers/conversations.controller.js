const conversationsManager = require('../managers/conversations.manager');

async function list(req, res) {
  res.json({ success: true, data: await conversationsManager.list(req.validated.query) });
}

async function messages(req, res) {
  res.json({ success: true, data: await conversationsManager.listMessages(req.validated.params.id, req.validated.query) });
}

async function markRead(req, res) {
  res.json({ success: true, data: await conversationsManager.markRead(req.validated.params.id) });
}

async function clearHistory(req, res) {
  res.json({ success: true, data: await conversationsManager.clearHistory(req.validated.params.id) });
}

async function remove(req, res) {
  res.json({ success: true, data: await conversationsManager.remove(req.validated.params.id) });
}

module.exports = { list, messages, markRead, clearHistory, remove };
