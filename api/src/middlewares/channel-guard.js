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

function requireWhatsappWebReady(req, res, next) {
  const whatsappWeb = require('../managers/whatsapp-web.manager');
  return whatsappWeb.status().then((status) => {
    if (!status.ready) throw new ApiError(503, 'Sessao do WhatsApp Web nao autenticada', null, 'WHATSAPP_WEB_NOT_READY');
    next();
  }).catch(next);
}

module.exports = { requireConfiguredChannel, requireWhatsappWebReady };
