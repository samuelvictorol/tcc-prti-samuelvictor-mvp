const profileManager = require('../managers/profile.manager');
const profileMembershipsManager = require('../managers/profile-memberships.manager');

function requestMeta(req) {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}

async function accessConfig(_req, res) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('Pragma', 'no-cache');
  res.json({ success: true, data: await profileManager.publicAccessConfig() });
}

async function requestLogin(req, res) {
  const data = await profileManager.requestLogin(req.validated.body, requestMeta(req));
  res.status(202).json({ success: true, data });
}

async function exchangeLink(req, res) {
  const data = await profileManager.exchangeProfileLink(req.validated.body, requestMeta(req));
  res.json({ success: true, data });
}

async function me(req, res) {
  res.json({ success: true, data: await profileManager.getOwnProfile(req.profile.contactId) });
}

async function update(req, res) {
  res.json({ success: true, data: await profileManager.updateOwnProfile(req.profile.contactId, req.validated.body) });
}

async function revokeConsent(req, res) {
  res.json({ success: true, data: await profileManager.revokeOwnConsent(req.profile.contactId, req.validated.body) });
}

async function setEmailConsent(req, res) {
  res.json({ success: true, data: await profileManager.setOwnEmailConsent(req.profile.contactId, req.validated.body) });
}

async function activations(req, res) {
  res.json({ success: true, data: await profileManager.activationLinks(req.profile.contactId) });
}

async function history(req, res) {
  res.json({ success: true, data: await profileManager.deliveryHistory(req.profile.contactId, req.validated.query) });
}

async function memberships(req, res) {
  res.json({
    success: true,
    data: await profileMembershipsManager.listOwn(req.profile.contactId)
  });
}

async function groupMembership(req, res) {
  res.json({
    success: true,
    data: await profileMembershipsManager.ownGroupDetails(
      req.profile.contactId,
      req.validated.params.id
    )
  });
}

async function removeGroupMembership(req, res) {
  res.json({
    success: true,
    data: await profileMembershipsManager.removeOwnGroupMembership(
      req.profile.contactId,
      req.validated.params.id,
      { requestId: req.id }
    )
  });
}

async function removeInviteMembership(req, res) {
  res.json({
    success: true,
    data: await profileMembershipsManager.removeInviteMembership(
      req.profile.contactId,
      req.validated.params.id,
      {
        requestId: req.id,
        source: 'profile_self_service',
        selfService: true
      }
    )
  });
}

async function loginOverview(req, res) {
  res.json({ success: true, data: await profileManager.loginOverview(req.validated.query) });
}

module.exports = {
  accessConfig,
  requestLogin,
  exchangeLink,
  me,
  update,
  revokeConsent,
  setEmailConsent,
  activations,
  history,
  memberships,
  groupMembership,
  removeGroupMembership,
  removeInviteMembership,
  loginOverview
};
