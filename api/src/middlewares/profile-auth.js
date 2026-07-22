const profileManager = require('../managers/profile.manager');
const ApiError = require('../utils/api-error');

async function requireProfileAuth(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) throw new ApiError(401, 'Token Bearer do perfil obrigatorio', null, 'PROFILE_AUTH_REQUIRED');
    req.profile = await profileManager.authenticateProfileAccess(match[1]);
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { requireProfileAuth };
