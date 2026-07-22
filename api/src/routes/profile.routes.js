const express = require('express');
const controller = require('../controllers/profile.controller');
const validate = require('../middlewares/validate');
const asyncHandler = require('../utils/async-handler');
const { requireAuth } = require('../middlewares/auth');
const { requireProfileAuth } = require('../middlewares/profile-auth');
const { profileCodeRequestLimiter, profileCodeVerifyLimiter } = require('../middlewares/security');
const {
  requestProfileCodeSchema,
  verifyProfileCodeSchema,
  updateOwnProfileSchema,
  revokeOwnConsentSchema,
  setOwnEmailConsentSchema,
  profileHistorySchema,
  profileLoginLogsSchema
} = require('../dtos/profile.dto');
const { env } = require('../config/env');

const profileRouter = express.Router();
profileRouter.post('/request-code', profileCodeRequestLimiter, validate(requestProfileCodeSchema), asyncHandler(controller.requestCode));
profileRouter.post('/verify-code', profileCodeVerifyLimiter, validate(verifyProfileCodeSchema), asyncHandler(controller.verifyCode));
profileRouter.use(requireProfileAuth);
profileRouter.get('/', asyncHandler(controller.me));
profileRouter.patch('/', validate(updateOwnProfileSchema), asyncHandler(controller.update));
profileRouter.post('/consents/revoke', validate(revokeOwnConsentSchema), asyncHandler(controller.revokeConsent));
profileRouter.post('/consents/email', validate(setOwnEmailConsentSchema), asyncHandler(controller.setEmailConsent));
profileRouter.get('/activation-links', asyncHandler(controller.activations));
profileRouter.get('/history', validate(profileHistorySchema), asyncHandler(controller.history));

const adminRouter = express.Router();
adminRouter.use(requireAuth);
adminRouter.get('/', validate(profileLoginLogsSchema), asyncHandler(controller.loginOverview));

module.exports = [
  { basePath: env.apiPrefix + '/my-profile', router: profileRouter },
  { basePath: env.apiPrefix + '/profile-logins', router: adminRouter }
];
