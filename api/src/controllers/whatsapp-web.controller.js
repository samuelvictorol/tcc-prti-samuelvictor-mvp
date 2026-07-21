const whatsappWebManager = require('../managers/whatsapp-web.manager');

async function initialize(_req, res) { res.status(202).json({ success: true, data: await whatsappWebManager.initialize() }); }
async function status(_req, res) { res.json({ success: true, data: await whatsappWebManager.status() }); }
async function chats(req, res) { res.json({ success: true, data: await whatsappWebManager.chats(Number(req.query.limit) || 100) }); }
async function messages(req, res) { res.json({ success: true, data: await whatsappWebManager.messages(req.validated.params.chatId, req.validated.query.limit) }); }
async function groups(req, res) { res.json({ success: true, data: await whatsappWebManager.listGroups(req.query) }); }
async function createGroup(req, res) { res.status(201).json({ success: true, data: await whatsappWebManager.createGroupFromChats(req.validated.body) }); }
async function sync(_req, res) { res.json({ success: true, data: await whatsappWebManager.syncChats() }); }
async function send(req, res) { res.json({ success: true, data: await whatsappWebManager.send(req.validated.body) }); }
async function logout(_req, res) { res.json({ success: true, data: await whatsappWebManager.logout() }); }

module.exports = { initialize, status, chats, messages, groups, createGroup, sync, send, logout };
