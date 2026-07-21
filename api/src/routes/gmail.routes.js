const express = require('express');
const controller = require('../controllers/gmail.controller');
const validate = require('../middlewares/validate');
const asyncHandler = require('../utils/async-handler');
const { requireAuth } = require('../middlewares/auth');
const { requireConfiguredChannel } = require('../middlewares/channel-guard');
const { channelSendSchema } = require('../dtos/channels.dto');
const { env } = require('../config/env');

const router = express.Router();
router.use(requireAuth);
router.get('/status', asyncHandler(controller.status));
router.post('/send', requireConfiguredChannel('email'), validate(channelSendSchema), asyncHandler(controller.send));

module.exports = [
  { basePath: env.apiPrefix + '/email', router },
  { basePath: env.apiPrefix + '/gmail', router }
];
