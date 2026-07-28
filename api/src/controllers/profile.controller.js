const profileManager = require('../managers/profile.manager');

function requestMeta(req) {
  return { ip: req.ip, userAgent: req.get('user-agent') };
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

async function loginOverview(req, res) {
  res.json({ success: true, data: await profileManager.loginOverview(req.validated.query) });
}

module.exports = {
  requestLogin,
  exchangeLink,
  me,
  update,
  revokeConsent,
  setEmailConsent,
  activations,
  history,
  loginOverview
};
