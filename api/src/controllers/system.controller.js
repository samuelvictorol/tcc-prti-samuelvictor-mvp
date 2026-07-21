const systemManager = require('../managers/system.manager');

async function health(_req, res) {
  const data = await systemManager.health();
  res.status(data.status === 'ok' ? 200 : 503).json({ success: data.status === 'ok', data });
}

module.exports = { health };
