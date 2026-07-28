const settingsManager = require('../managers/settings.manager');
const telegramManager = require('../managers/telegram.manager');
const logsManager = require('../managers/logs.manager');

const AUDIT_CHANNELS = Object.freeze({
  telegram: 'telegram',
  whatsappCloud: 'whatsapp_cloud',
  email: 'email'
});

async function enrichTelegram(configuration, options = {}) {
  const telegram = await telegramManager.status({ probe: options.probe !== false, force: Boolean(options.force) });
  return {
    ...configuration,
    telegram: { ...(configuration.telegram || {}), ...telegram }
  };
}

async function list(_req, res) {
  const configuration = await settingsManager.getStructured();
  res.json({ success: true, data: await enrichTelegram(configuration, { probe: false }) });
}

async function statuses(_req, res) {
  const channelStatuses = await settingsManager.statuses();
  res.json({ success: true, data: await enrichTelegram(channelStatuses, { probe: false }) });
}

async function reveal(req, res) {
  const channel = req.validated.params.channel;
  const data = await settingsManager.revealChannel(channel);
  await logsManager.create({
    level: 'info',
    channel: AUDIT_CHANNELS[channel] || 'system',
    action: 'settings.credentials_revealed',
    message: 'Administrador consultou credenciais salvas do canal',
    actor: req.admin.id,
    requestId: req.id,
    context: { settingsChannel: channel }
  });
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('Pragma', 'no-cache');
  res.vary('Authorization');
  res.json({ success: true, data });
}

async function update(req, res) {
  const { key } = req.validated.params;
  const data = await settingsManager.setValue(key, req.validated.body.value, req.admin.id, { sensitive: req.validated.body.sensitive });
  if (String(key).toUpperCase() !== 'TELEGRAM_BOT_TOKEN') return res.json({ success: true, data });
  telegramManager.clearIdentityCache();
  const webhook = await telegramManager.refreshWebhookRegistration();
  res.json({
    success: true,
    data: {
      ...data,
      telegram: {
        ...await telegramManager.status({ probe: true, force: true }),
        webhook
      }
    }
  });
}

async function updateBulk(req, res) {
  const data = await settingsManager.setBulk(req.validated.body, req.admin.id);
  const tokenUpdated = data.updated.includes('TELEGRAM_BOT_TOKEN');
  if (tokenUpdated) telegramManager.clearIdentityCache();
  data.configuration = await enrichTelegram(data.configuration, { probe: tokenUpdated, force: tokenUpdated });
  if (tokenUpdated) {
    data.configuration.telegram.webhook = await telegramManager.refreshWebhookRegistration();
  }
  res.json({ success: true, data });
}

async function remove(req, res) {
  const key = String(req.validated.params.key).toUpperCase();
  const data = await settingsManager.remove(key);
  if (key === 'TELEGRAM_BOT_TOKEN') telegramManager.clearIdentityCache();
  res.json({ success: true, data });
}

module.exports = { list, statuses, reveal, update, updateBulk, remove };
