const settingsManager = require('../managers/settings.manager');
const telegramManager = require('../managers/telegram.manager');

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

async function update(req, res) {
  const { key } = req.validated.params;
  const data = await settingsManager.setValue(key, req.validated.body.value, req.admin.id, { sensitive: req.validated.body.sensitive });
  if (String(key).toUpperCase() !== 'TELEGRAM_BOT_TOKEN') return res.json({ success: true, data });
  telegramManager.clearIdentityCache();
  res.json({ success: true, data: { ...data, telegram: await telegramManager.status({ probe: true, force: true }) } });
}

async function updateBulk(req, res) {
  const data = await settingsManager.setBulk(req.validated.body, req.admin.id);
  const tokenUpdated = data.updated.includes('TELEGRAM_BOT_TOKEN');
  if (tokenUpdated) telegramManager.clearIdentityCache();
  data.configuration = await enrichTelegram(data.configuration, { probe: tokenUpdated, force: tokenUpdated });
  res.json({ success: true, data });
}

async function remove(req, res) {
  const key = String(req.validated.params.key).toUpperCase();
  const data = await settingsManager.remove(key);
  if (key === 'TELEGRAM_BOT_TOKEN') telegramManager.clearIdentityCache();
  res.json({ success: true, data });
}

module.exports = { list, statuses, update, updateBulk, remove };
