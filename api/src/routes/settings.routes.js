const express = require('express');
const controller = require('../controllers/settings.controller');
const validate = require('../middlewares/validate');
const asyncHandler = require('../utils/async-handler');
const { requireAuth } = require('../middlewares/auth');
const { settingsRevealLimiter } = require('../middlewares/security');
const {
  updateSettingSchema,
  deleteSettingSchema,
  revealSettingsSchema,
  bulkSettingsSchema
} = require('../dtos/settings.dto');
const { env } = require('../config/env');

const router = express.Router();
router.use(requireAuth);
router.get('/', asyncHandler(controller.list));
router.get('/status', asyncHandler(controller.statuses));
router.get('/reveal/:channel', settingsRevealLimiter, validate(revealSettingsSchema), asyncHandler(controller.reveal));
router.put('/', validate(bulkSettingsSchema), asyncHandler(controller.updateBulk));
router.put('/:key', validate(updateSettingSchema), asyncHandler(controller.update));
router.delete('/:key', validate(deleteSettingSchema), asyncHandler(controller.remove));

module.exports = { basePath: env.apiPrefix + '/settings', router };
