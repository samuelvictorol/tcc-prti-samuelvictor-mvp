const express = require('express');
const controller = require('../controllers/profile.controller');
const validate = require('../middlewares/validate');
const asyncHandler = require('../utils/async-handler');
const { requireAuth } = require('../middlewares/auth');
const { requireProfileAuth } = require('../middlewares/profile-auth');
const { profileCodeRequestLimiter, profileCodeVerifyLimiter } = require('../middlewares/security');
const {
  requestProfileLoginSchema,
  exchangeProfileLinkSchema,
  updateOwnProfileSchema,
  revokeOwnConsentSchema,
  setOwnEmailConsentSchema,
  profileHistorySchema,
  ownGroupMembershipSchema,
  removeOwnGroupMembershipSchema,
  removeOwnInviteMembershipSchema,
  profileLoginLogsSchema
} = require('../dtos/profile.dto');
const { env } = require('../config/env');

const profileRouter = express.Router();
profileRouter.get('/access-config', asyncHandler(controller.accessConfig));
profileRouter.post('/request-login', profileCodeRequestLimiter, validate(requestProfileLoginSchema), asyncHandler(controller.requestLogin));
profileRouter.post('/exchange-link', profileCodeVerifyLimiter, validate(exchangeProfileLinkSchema), asyncHandler(controller.exchangeLink));
profileRouter.use(requireProfileAuth);
profileRouter.get('/', asyncHandler(controller.me));
profileRouter.patch('/', validate(updateOwnProfileSchema), asyncHandler(controller.update));
profileRouter.post('/consents/revoke', validate(revokeOwnConsentSchema), asyncHandler(controller.revokeConsent));
profileRouter.post('/consents/email', validate(setOwnEmailConsentSchema), asyncHandler(controller.setEmailConsent));
profileRouter.get('/activation-links', asyncHandler(controller.activations));
profileRouter.get('/history', validate(profileHistorySchema), asyncHandler(controller.history));
profileRouter.get('/memberships', asyncHandler(controller.memberships));
profileRouter.get('/groups/:id', validate(ownGroupMembershipSchema), asyncHandler(controller.groupMembership));
profileRouter.delete('/groups/:id', validate(removeOwnGroupMembershipSchema), asyncHandler(controller.removeGroupMembership));
profileRouter.delete('/invites/:id', validate(removeOwnInviteMembershipSchema), asyncHandler(controller.removeInviteMembership));

const adminRouter = express.Router();
adminRouter.use(requireAuth);
adminRouter.get('/', validate(profileLoginLogsSchema), asyncHandler(controller.loginOverview));

module.exports = [
  { basePath: env.apiPrefix + '/my-profile', router: profileRouter },
  { basePath: env.apiPrefix + '/profile-logins', router: adminRouter }
];
