const whatsappWebManager = require('../managers/whatsapp-web.manager');

async function initialize(_req, res) { res.status(202).json({ success: true, data: await whatsappWebManager.initialize() }); }
async function regenerate(_req, res) { res.status(202).json({ success: true, data: await whatsappWebManager.regenerate() }); }
async function status(_req, res) { res.json({ success: true, data: await whatsappWebManager.status() }); }
async function chats(req, res) { res.json({ success: true, data: await whatsappWebManager.chats(Number(req.query.limit) || 100) }); }
async function messages(req, res) { res.json({ success: true, data: await whatsappWebManager.messages(req.validated.params.chatId, req.validated.query.limit) }); }
async function sync(_req, res) { res.json({ success: true, data: await whatsappWebManager.syncChats() }); }
async function send(req, res) { res.json({ success: true, data: await whatsappWebManager.send(req.validated.body) }); }
async function logout(_req, res) { res.json({ success: true, data: await whatsappWebManager.logout() }); }

module.exports = { initialize, regenerate, status, chats, messages, sync, send, logout };
