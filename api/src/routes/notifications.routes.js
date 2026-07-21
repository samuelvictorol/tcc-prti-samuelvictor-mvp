const express = require('express');
const controller = require('../controllers/notifications.controller');
const validate = require('../middlewares/validate');
const asyncHandler = require('../utils/async-handler');
const { requireAuth } = require('../middlewares/auth');
const { createNotificationSchema, notificationIdSchema, listNotificationsSchema } = require('../dtos/notifications.dto');
const { env } = require('../config/env');

const router = express.Router();
router.use(requireAuth);
router.get('/', validate(listNotificationsSchema), asyncHandler(controller.list));
router.get('/stats', asyncHandler(controller.stats));
router.post('/', validate(createNotificationSchema), asyncHandler(controller.create));
router.get('/:id', validate(notificationIdSchema), asyncHandler(controller.get));
router.post('/:id/retry', validate(notificationIdSchema), asyncHandler(controller.retry));
router.post('/:id/cancel', validate(notificationIdSchema), asyncHandler(controller.cancel));

module.exports = { basePath: env.apiPrefix + '/notifications', router };
