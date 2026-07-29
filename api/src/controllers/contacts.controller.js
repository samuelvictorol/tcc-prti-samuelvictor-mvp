const contactsManager = require('../managers/contacts.manager');
const privacyManager = require('../managers/privacy.manager');
const profileMembershipsManager = require('../managers/profile-memberships.manager');

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

async function removeInvite(req, res) {
  res.json({
    success: true,
    data: await profileMembershipsManager.removeInviteMembership(
      req.validated.params.id,
      req.validated.params.inviteId,
      {
        actorId: req.admin.id,
        requestId: req.id,
        source: 'admin_contact_dialog',
        selfService: false
      }
    )
  });
}

module.exports = { create, list, get, update, remove, removeInvite };
