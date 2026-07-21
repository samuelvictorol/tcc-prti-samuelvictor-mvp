const express = require('express');
const controller = require('../controllers/privacy.controller');
const validate = require('../middlewares/validate');
const asyncHandler = require('../utils/async-handler');
const { requireAuth } = require('../middlewares/auth');
const { contactPrivacySchema, consentSchema } = require('../dtos/privacy.dto');
const { env } = require('../config/env');

const router = express.Router();
router.use(requireAuth);
router.get('/contacts/:id/export', validate(contactPrivacySchema), asyncHandler(controller.exportContact));
router.delete('/contacts/:id', validate(contactPrivacySchema), asyncHandler(controller.deleteContact));
router.post('/contacts/:id/consents', validate(consentSchema), asyncHandler(controller.recordConsent));

module.exports = { basePath: env.apiPrefix + '/privacy', router };
