const whatsappCloudManager = require('../managers/whatsapp-cloud.manager');
const webhookEventsManager = require('../managers/whatsapp-cloud-webhook-events.manager');

async function status(_req, res) { res.json({ success: true, data: await whatsappCloudManager.status() }); }
async function templatePresets(_req, res) { res.json({ success: true, data: whatsappCloudManager.templatePresets() }); }
async function webhookEvents(req, res) { res.json({ success: true, data: await webhookEventsManager.list(req.query) }); }
async function webhookEvent(req, res) { res.json({ success: true, data: await webhookEventsManager.getById(req.params.id) }); }
function preventWebhookEventCaching(_req, res, next) {
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.set('Pragma', 'no-cache');
  res.vary('Authorization');
  next();
}
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
async function conversations(req, res) { res.json({ success: true, data: await whatsappCloudManager.listConversations(req.validated.query) }); }
async function conversation(req, res) { res.json({ success: true, data: await whatsappCloudManager.getConversation(req.validated.params.id) }); }
async function conversationMessages(req, res) {
  res.json({
    success: true,
    data: await whatsappCloudManager.listConversationMessages(req.validated.params.id, req.validated.query)
  });
}
async function markConversationRead(req, res) {
  res.json({ success: true, data: await whatsappCloudManager.markConversationRead(req.validated.params.id) });
}
async function clearConversation(req, res) {
  res.json({ success: true, data: await whatsappCloudManager.clearConversation(req.validated.params.id) });
}
async function backupConversations(_req, res) {
  const snapshot = await whatsappCloudManager.createStoredBackup('manual');
  const generated = snapshot.export;
  const date = generated.generatedAt.slice(0, 10);
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.set('Pragma', 'no-cache');
  res.vary('Authorization');
  res.attachment(`notify-flow-whatsapp-cloud-${date}.json`);
  res.type('application/json').send(JSON.stringify(generated, null, 2));
}
async function conversationBackups(req, res) {
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.json({
    success: true,
    data: await whatsappCloudManager.listStoredBackups(req.validated.query)
  });
}
async function downloadConversationBackup(req, res) {
  const stored = await whatsappCloudManager.getStoredBackupExport(req.validated.params.backupId);
  const date = new Date(stored.backup.generatedAt).toISOString().slice(0, 10);
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.set('Pragma', 'no-cache');
  res.vary('Authorization');
  res.attachment(`notify-flow-whatsapp-cloud-${stored.backup.trigger}-${date}.json`);
  res.type('application/json').send(JSON.stringify(stored.export, null, 2));
}
async function sendConversationMessage(req, res) {
  res.json({
    success: true,
    data: await whatsappCloudManager.sendConversationText(req.validated.params.id, req.validated.body.text)
  });
}
async function sendConsentRequest(req, res) {
  res.json({ success: true, data: await whatsappCloudManager.sendConsentRequest(req.validated.params.id) });
}

module.exports = {
  status,
  templatePresets,
  webhookEvents,
  webhookEvent,
  preventWebhookEventCaching,
  verifyWebhook,
  webhook,
  send,
  conversations,
  conversation,
  conversationMessages,
  markConversationRead,
  clearConversation,
  backupConversations,
  conversationBackups,
  downloadConversationBackup,
  sendConversationMessage,
  sendConsentRequest
};
