const express = require('express');
const controller = require('../controllers/admin-notifications.controller');
const validate = require('../middlewares/validate');
const asyncHandler = require('../utils/async-handler');
const { requireAuth } = require('../middlewares/auth');
const { listAdminNotificationsSchema, adminNotificationIdSchema } = require('../dtos/admin-notifications.dto');
const { env } = require('../config/env');

const router = express.Router();
router.use(requireAuth);
router.get('/', validate(listAdminNotificationsSchema), asyncHandler(controller.list));
router.get('/unread-count', asyncHandler(controller.unreadCount));
router.post('/read-all', asyncHandler(controller.markAllRead));
router.get('/:id', validate(adminNotificationIdSchema), asyncHandler(controller.getById));
router.post('/:id/read', validate(adminNotificationIdSchema), asyncHandler(controller.markRead));

module.exports = { basePath: env.apiPrefix + '/admin-notifications', router };
