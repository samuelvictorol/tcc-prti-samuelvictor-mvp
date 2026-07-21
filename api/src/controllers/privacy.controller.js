const privacyManager = require('../managers/privacy.manager');

async function exportContact(req, res) {
  res.json({ success: true, data: await privacyManager.exportContact(req.validated.params.id) });
}
async function deleteContact(req, res) {
  res.json({ success: true, data: await privacyManager.deleteContact(req.validated.params.id) });
}
async function recordConsent(req, res) {
  res.status(201).json({ success: true, data: await privacyManager.recordConsent(req.validated.params.id, req.validated.body, req.admin.id) });
}

module.exports = { exportContact, deleteContact, recordConsent };
