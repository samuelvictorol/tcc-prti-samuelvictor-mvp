const gmailManager = require('../managers/gmail.manager');

async function status(req, res) { res.json({ success: true, data: await gmailManager.status({ probe: req.query.probe === 'true' }) }); }
async function send(req, res) { res.json({ success: true, data: await gmailManager.send(req.validated.body) }); }

module.exports = { status, send };
