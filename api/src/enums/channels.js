const CHANNELS = Object.freeze({
  TELEGRAM: 'telegram',
  WHATSAPP_WEB: 'whatsapp_web',
  WHATSAPP_CLOUD: 'whatsapp_cloud',
  EMAIL: 'email',
  GLOBAL: 'global'
});

const DELIVERY_CHANNELS = Object.freeze([
  CHANNELS.TELEGRAM,
  CHANNELS.WHATSAPP_WEB,
  CHANNELS.WHATSAPP_CLOUD,
  CHANNELS.EMAIL
]);

module.exports = { CHANNELS, DELIVERY_CHANNELS };
