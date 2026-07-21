const whatsappCloudManager = require('../managers/whatsapp-cloud.manager');

async function status(_req, res) { res.json({ success: true, data: await whatsappCloudManager.status() }); }
async function templatePresets(_req, res) { res.json({ success: true, data: whatsappCloudManager.templatePresets() }); }
async function verifyWebhook(req, res) {
  // express-mongo-sanitize troca pontos por underscores nas chaves da query.
  // A Meta envia `hub.*`; aceitar ambas mantém o handshake compatível após a sanitização.
  const mode = req.query['hub.mode'] ?? req.query.hub_mode;
  const verifyToken = req.query['hub.verify_token'] ?? req.query.hub_verify_token;
  const requestedChallenge = req.query['hub.challenge'] ?? req.query.hub_challenge;
  const challenge = await whatsappCloudManager.verifyChallenge(mode, verifyToken, requestedChallenge);
  res.status(200).send(challenge);
}
async function webhook(req, res) { res.json({ success: true, data: await whatsappCloudManager.webhook(req.body, req.rawBody, req.get('x-hub-signature-256')) }); }
async function send(req, res) { res.json({ success: true, data: await whatsappCloudManager.send(req.validated.body) }); }

module.exports = { status, templatePresets, verifyWebhook, webhook, send };
