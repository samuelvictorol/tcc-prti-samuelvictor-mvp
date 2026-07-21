const termsManager = require('../managers/terms.manager');

async function create(req, res) {
  res.status(201).json({ success: true, data: await termsManager.create(req.validated.body, req.admin.id) });
}
async function list(req, res) {
  res.json({ success: true, data: await termsManager.list(req.validated.query) });
}
async function get(req, res) {
  res.json({ success: true, data: await termsManager.getById(req.validated.params.id) });
}
async function update(req, res) {
  res.json({ success: true, data: await termsManager.update(req.validated.params.id, req.validated.body, req.admin.id) });
}
async function remove(req, res) {
  res.json({ success: true, data: await termsManager.remove(req.validated.params.id) });
}
async function getPublished(req, res) {
  res.json({ success: true, data: await termsManager.getPublished(req.validated.params.type) });
}

module.exports = { create, list, get, update, remove, getPublished };
