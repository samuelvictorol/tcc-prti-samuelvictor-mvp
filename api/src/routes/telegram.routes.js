const express = require('express');
const controller = require('../controllers/telegram.controller');
const validate = require('../middlewares/validate');
const asyncHandler = require('../utils/async-handler');
const { requireAuth } = require('../middlewares/auth');
const { requireConfiguredChannel } = require('../middlewares/channel-guard');
const { channelSendSchema, registerWebhookSchema, telegramSendSchema, createTelegramGroupSchema, updateTelegramGroupSchema } = require('../dtos/channels.dto');
const { groupIdSchema } = require('../dtos/groups.dto');
const { env } = require('../config/env');

const router = express.Router();
router.use(requireAuth);
router.get('/status', asyncHandler(controller.status));
router.use(requireConfiguredChannel('telegram'));
router.get('/chats', asyncHandler(controller.chats));
router.get('/groups', asyncHandler(controller.groups));
router.post('/groups', validate(createTelegramGroupSchema), asyncHandler(controller.createGroup));
router.put('/groups/:id', validate(updateTelegramGroupSchema), asyncHandler(controller.updateGroup));
router.patch('/groups/:id', validate(updateTelegramGroupSchema), asyncHandler(controller.updateGroup));
router.delete('/groups/:id', validate(groupIdSchema), asyncHandler(controller.removeGroup));
router.post('/sync', asyncHandler(controller.sync));
router.post('/send', validate(telegramSendSchema), asyncHandler(controller.sendContract));
router.post('/dispatch', validate(channelSendSchema), asyncHandler(controller.send));
router.post('/webhook/register', validate(registerWebhookSchema), asyncHandler(controller.registerWebhook));

const webhookRouter = express.Router();
webhookRouter.post('/', asyncHandler(controller.webhook));

module.exports = [
  { basePath: env.apiPrefix + '/telegram', router },
  { basePath: env.apiPrefix + '/webhooks/telegram', router: webhookRouter }
];
