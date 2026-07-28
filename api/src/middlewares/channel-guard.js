const settingsManager = require('../managers/settings.manager');
const ApiError = require('../utils/api-error');

function requireConfiguredChannel(channel) {
  return async (_req, _res, next) => {
    try {
      if (!await settingsManager.channelConfigured(channel)) {
        throw new ApiError(503, 'Canal nao configurado: ' + channel, null, 'CHANNEL_NOT_CONFIGURED');
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { requireConfiguredChannel };
