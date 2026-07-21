const authManager = require('../managers/auth.manager');

async function login(req, res) {
  const data = await authManager.login(req.validated.body, { ip: req.ip, userAgent: req.get('user-agent') });
  res.cookie('refresh_token', data.refreshToken, authManager.refreshCookieOptions(data.refreshToken));
  const publicData = { ...data };
  delete publicData.refreshToken;
  res.json({ success: true, data: { ...publicData, user: publicData.admin } });
}

async function refresh(req, res) {
  const currentToken = req.validated.body.refreshToken || req.cookies?.refresh_token;
  const data = await authManager.rotate(currentToken, { ip: req.ip, userAgent: req.get('user-agent') });
  res.cookie('refresh_token', data.refreshToken, authManager.refreshCookieOptions(data.refreshToken));
  const publicData = { ...data };
  delete publicData.refreshToken;
  res.json({ success: true, data: { ...publicData, user: publicData.admin } });
}

async function logout(req, res) {
  const token = req.validated.body.refreshToken || req.cookies?.refresh_token;
  const data = token ? await authManager.logout(token) : { revoked: false };
  const clearOptions = authManager.refreshCookieOptions();
  delete clearOptions.maxAge;
  res.clearCookie('refresh_token', clearOptions);
  res.json({ success: true, data });
}

async function me(req, res) {
  res.json({ success: true, data: await authManager.current(req.admin) });
}

module.exports = { login, refresh, logout, me };
