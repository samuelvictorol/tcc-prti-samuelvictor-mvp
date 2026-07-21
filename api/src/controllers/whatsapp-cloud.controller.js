const whatsappCloudManager = require('../managers/whatsapp-cloud.manager');

async function status(_req, res) { res.json({ success: true, data: await whatsappCloudManager.status() }); }
async function verifyWebhook(req, res) {
  const challenge = await whatsappCloudManager.verifyChallenge(req.query['hub.mode'], req.query['hub.verify_token'], req.query['hub.challenge']);
  res.status(200).send(challenge);
}
async function webhook(req, res) { res.json({ success: true, data: await whatsappCloudManager.webhook(req.body, req.rawBody, req.get('x-hub-signature-256')) }); }
async function send(req, res) { res.json({ success: true, data: await whatsappCloudManager.send(req.validated.body) }); }

module.exports = { status, verifyWebhook, webhook, send };
