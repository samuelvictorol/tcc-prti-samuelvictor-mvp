const authManager = require('../managers/auth.manager');
const ApiError = require('../utils/api-error');

async function requireAuth(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) throw new ApiError(401, 'Token Bearer obrigatorio', null, 'AUTH_REQUIRED');
    req.admin = await authManager.authenticateAccess(match[1]);
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { requireAuth };
