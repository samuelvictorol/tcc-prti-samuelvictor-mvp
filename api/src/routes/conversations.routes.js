const express = require('express');
const controller = require('../controllers/conversations.controller');
const validate = require('../middlewares/validate');
const asyncHandler = require('../utils/async-handler');
const { requireAuth } = require('../middlewares/auth');
const { listConversationsSchema, conversationIdSchema, listConversationMessagesSchema } = require('../dtos/conversations.dto');
const { env } = require('../config/env');

const router = express.Router();
router.use(requireAuth);
router.get('/', validate(listConversationsSchema), asyncHandler(controller.list));
router.get('/:id/messages', validate(listConversationMessagesSchema), asyncHandler(controller.messages));
router.patch('/:id/read', validate(conversationIdSchema), asyncHandler(controller.markRead));
router.delete('/:id/messages', validate(conversationIdSchema), asyncHandler(controller.clearHistory));
router.delete('/:id', validate(conversationIdSchema), asyncHandler(controller.remove));

module.exports = { basePath: env.apiPrefix + '/conversations', router };
