const groupsManager = require('../managers/groups.manager');

async function create(req, res) {
  res.status(201).json({ success: true, data: await groupsManager.create(req.validated.body) });
}
async function list(req, res) {
  res.json({ success: true, data: await groupsManager.list(req.validated.query) });
}
async function get(req, res) {
  res.json({ success: true, data: await groupsManager.getById(req.validated.params.id) });
}
async function update(req, res) {
  res.json({ success: true, data: await groupsManager.update(req.validated.params.id, req.validated.body) });
}
async function remove(req, res) {
  res.json({ success: true, data: await groupsManager.remove(req.validated.params.id) });
}
async function syncInvites(req, res) {
  res.json({ success: true, data: await groupsManager.syncInviteGroups(req.validated.body) });
}
async function syncInvite(req, res) {
  res.json({
    success: true,
    data: await groupsManager.syncExistingGroupInvite(
      req.validated.params.id,
      req.validated.body.inviteId
    )
  });
}

module.exports = { create, list, get, update, remove, syncInvites, syncInvite };
