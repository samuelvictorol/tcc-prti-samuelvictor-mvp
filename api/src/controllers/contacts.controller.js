const contactsManager = require('../managers/contacts.manager');
const privacyManager = require('../managers/privacy.manager');

async function create(req, res) {
  res.status(201).json({ success: true, data: await contactsManager.create(req.validated.body, req.admin.id) });
}
async function list(req, res) {
  res.json({ success: true, data: await contactsManager.list(req.validated.query) });
}
async function get(req, res) {
  res.json({ success: true, data: await contactsManager.getById(req.validated.params.id) });
}
async function update(req, res) {
  res.json({ success: true, data: await contactsManager.update(req.validated.params.id, req.validated.body, req.admin.id) });
}
async function remove(req, res) {
  res.json({ success: true, data: await privacyManager.deleteContact(req.validated.params.id) });
}

module.exports = { create, list, get, update, remove };
