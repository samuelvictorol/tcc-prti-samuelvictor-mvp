const CHANNELS = Object.freeze({
  TELEGRAM: 'telegram',
  WHATSAPP_CLOUD: 'whatsapp_cloud',
  EMAIL: 'email',
  GLOBAL: 'global'
});

const DELIVERY_CHANNELS = Object.freeze([
  CHANNELS.TELEGRAM,
  CHANNELS.WHATSAPP_CLOUD,
  CHANNELS.EMAIL
]);

// Aceito somente nos schemas de persistência para que documentos criados por
// versões anteriores continuem legíveis/editáveis sem reativar o canal removido.
const STORED_CHANNELS = Object.freeze([...DELIVERY_CHANNELS, 'whatsapp_web']);

module.exports = { CHANNELS, DELIVERY_CHANNELS, STORED_CHANNELS };
