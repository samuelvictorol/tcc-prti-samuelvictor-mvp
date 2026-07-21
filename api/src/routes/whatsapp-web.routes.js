const express = require('express');
const controller = require('../controllers/whatsapp-web.controller');
const validate = require('../middlewares/validate');
const asyncHandler = require('../utils/async-handler');
const { requireAuth } = require('../middlewares/auth');
const { requireWhatsappWebReady } = require('../middlewares/channel-guard');
const { whatsappWebSendSchema, whatsappWebMessagesSchema } = require('../dtos/channels.dto');
const { env } = require('../config/env');

const router = express.Router();
router.use(requireAuth);
router.get('/status', asyncHandler(controller.status));
router.get('/session', asyncHandler(controller.status));
router.post('/session', asyncHandler(controller.initialize));
router.post('/session/regenerate', asyncHandler(controller.regenerate));
router.delete('/session', asyncHandler(controller.logout));
router.post('/initialize', asyncHandler(controller.initialize));
router.post('/logout', asyncHandler(controller.logout));
router.get('/chats', requireWhatsappWebReady, asyncHandler(controller.chats));
router.get('/chats/:chatId/messages', requireWhatsappWebReady, validate(whatsappWebMessagesSchema), asyncHandler(controller.messages));
router.post('/sync', requireWhatsappWebReady, asyncHandler(controller.sync));
router.post('/send', requireWhatsappWebReady, validate(whatsappWebSendSchema), asyncHandler(controller.send));

module.exports = { basePath: env.apiPrefix + '/whatsapp-web', router };
