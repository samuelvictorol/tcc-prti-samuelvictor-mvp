const logsManager = require('../managers/logs.manager');

async function list(req, res) {
  res.json({ success: true, data: await logsManager.list(req.query) });
}

module.exports = { list };
