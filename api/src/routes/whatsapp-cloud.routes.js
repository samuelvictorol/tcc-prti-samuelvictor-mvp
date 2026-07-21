const express = require('express');
const controller = require('../controllers/whatsapp-cloud.controller');
const validate = require('../middlewares/validate');
const asyncHandler = require('../utils/async-handler');
const { requireAuth } = require('../middlewares/auth');
const { requireConfiguredChannel } = require('../middlewares/channel-guard');
const { channelSendSchema } = require('../dtos/channels.dto');
const { env } = require('../config/env');

const router = express.Router();
router.use(requireAuth);
router.get('/status', asyncHandler(controller.status));
router.get('/template-presets', asyncHandler(controller.templatePresets));
router.post('/send', requireConfiguredChannel('whatsapp_cloud'), validate(channelSendSchema), asyncHandler(controller.send));

const webhookRouter = express.Router();
webhookRouter.get('/', asyncHandler(controller.verifyWebhook));
webhookRouter.post('/', asyncHandler(controller.webhook));

module.exports = [
  { basePath: env.apiPrefix + '/whatsapp-cloud', router },
  { basePath: env.apiPrefix + '/webhooks/whatsapp-cloud', router: webhookRouter }
];
