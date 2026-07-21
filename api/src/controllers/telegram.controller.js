const telegramManager = require('../managers/telegram.manager');

async function status(req, res) { res.json({ success: true, data: await telegramManager.status({ probe: req.query.probe !== 'false' }) }); }
async function webhook(req, res) { res.json({ success: true, data: await telegramManager.webhook(req.body, req.get('x-telegram-bot-api-secret-token')) }); }
async function send(req, res) { res.json({ success: true, data: await telegramManager.send(req.validated.body) }); }
async function sendContract(req, res) { res.json({ success: true, data: await telegramManager.sendFromContract(req.validated.body) }); }
async function registerWebhook(req, res) { res.json({ success: true, data: await telegramManager.registerWebhook(req.validated.body.url, req.admin.id) }); }
async function chats(req, res) { res.json({ success: true, data: await telegramManager.listChats(req.query) }); }
async function sync(_req, res) { res.json({ success: true, data: await telegramManager.sync() }); }
async function groups(req, res) { res.json({ success: true, data: await telegramManager.listGroups(req.query) }); }
async function createGroup(req, res) { res.status(201).json({ success: true, data: await telegramManager.createGroup(req.validated.body) }); }
async function updateGroup(req, res) { res.json({ success: true, data: await telegramManager.updateGroup(req.validated.params.id, req.validated.body) }); }
async function removeGroup(req, res) { res.json({ success: true, data: await telegramManager.removeGroup(req.params.id) }); }

module.exports = { status, webhook, send, sendContract, registerWebhook, chats, sync, groups, createGroup, updateGroup, removeGroup };
