const express = require('express');
const controller = require('../controllers/whatsapp-cloud.controller');
const validate = require('../middlewares/validate');
const asyncHandler = require('../utils/async-handler');
const { requireAuth } = require('../middlewares/auth');
const { requireConfiguredChannel } = require('../middlewares/channel-guard');
const { channelSendSchema } = require('../dtos/channels.dto');
const {
  conversationIdSchema,
  listConversationMessagesSchema,
  listCloudConversationsSchema,
  cloudConversationMessageSchema,
  conversationBackupIdSchema,
  listConversationBackupsSchema
} = require('../dtos/conversations.dto');
const { env } = require('../config/env');

const router = express.Router();
router.use('/webhook-events', controller.preventWebhookEventCaching);
router.use(requireAuth);
router.get('/status', asyncHandler(controller.status));
router.get('/template-presets', asyncHandler(controller.templatePresets));
router.get('/webhook-events', asyncHandler(controller.webhookEvents));
router.get('/webhook-events/:id', asyncHandler(controller.webhookEvent));
router.get('/conversations', validate(listCloudConversationsSchema), asyncHandler(controller.conversations));
router.post('/conversations/backup', asyncHandler(controller.backupConversations));
router.get('/conversations/backups', validate(listConversationBackupsSchema), asyncHandler(controller.conversationBackups));
router.get(
  '/conversations/backups/:backupId/download',
  validate(conversationBackupIdSchema),
  asyncHandler(controller.downloadConversationBackup)
);
router.get('/conversations/:id', validate(conversationIdSchema), asyncHandler(controller.conversation));
router.get('/conversations/:id/messages', validate(listConversationMessagesSchema), asyncHandler(controller.conversationMessages));
router.patch('/conversations/:id/read', validate(conversationIdSchema), asyncHandler(controller.markConversationRead));
router.delete('/conversations/:id/messages', validate(conversationIdSchema), asyncHandler(controller.clearConversation));
router.post(
  '/conversations/:id/messages',
  requireConfiguredChannel('whatsapp_cloud'),
  validate(cloudConversationMessageSchema),
  asyncHandler(controller.sendConversationMessage)
);
router.post(
  '/conversations/:id/consent-request',
  requireConfiguredChannel('whatsapp_cloud'),
  validate(conversationIdSchema),
  asyncHandler(controller.sendConsentRequest)
);
router.post('/send', requireConfiguredChannel('whatsapp_cloud'), validate(channelSendSchema), asyncHandler(controller.send));

const webhookRouter = express.Router();
webhookRouter.get('/', asyncHandler(controller.verifyWebhook));
webhookRouter.post('/', asyncHandler(controller.webhook));

module.exports = [
  { basePath: env.apiPrefix + '/whatsapp-cloud', router },
  { basePath: env.apiPrefix + '/webhooks/whatsapp-cloud', router: webhookRouter }
];
