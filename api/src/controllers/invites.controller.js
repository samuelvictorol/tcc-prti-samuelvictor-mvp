const invitesManager = require('../managers/invites.manager');

async function create(req, res) {
  res.status(201).json({ success: true, data: await invitesManager.create(req.validated.body, req.admin.id) });
}
async function list(req, res) {
  res.json({ success: true, data: await invitesManager.list(req.validated.query) });
}
async function get(req, res) {
  res.json({ success: true, data: await invitesManager.getById(req.validated.params.id) });
}
async function update(req, res) {
  res.json({ success: true, data: await invitesManager.update(req.validated.params.id, req.validated.body) });
}
async function remove(req, res) {
  res.json({ success: true, data: await invitesManager.remove(req.validated.params.id) });
}
async function getPublic(req, res) {
  res.json({ success: true, data: await invitesManager.getPublic(req.validated.params.slug, req.validated.query.token) });
}
async function track(req, res) {
  const data = await invitesManager.track(req.validated.params.slug, req.validated.params.linkId, req.validated.query.token, { ip: req.ip, userAgent: req.get('user-agent') });
  res.redirect(302, data.redirectUrl);
}

module.exports = { create, list, get, update, remove, getPublic, track };
