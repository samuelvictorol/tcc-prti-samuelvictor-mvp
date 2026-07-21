const templatesManager = require('../managers/templates.manager');

async function create(req, res) {
  res.status(201).json({ success: true, data: await templatesManager.create(req.validated.body, req.admin.id) });
}
async function list(req, res) {
  res.json({ success: true, data: await templatesManager.list(req.validated.query) });
}
async function get(req, res) {
  res.json({ success: true, data: await templatesManager.getById(req.validated.params.id) });
}
async function update(req, res) {
  res.json({ success: true, data: await templatesManager.update(req.validated.params.id, req.validated.body, req.admin.id) });
}
async function remove(req, res) {
  res.json({ success: true, data: await templatesManager.remove(req.validated.params.id) });
}

module.exports = { create, list, get, update, remove };
