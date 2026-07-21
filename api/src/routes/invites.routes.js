const express = require('express');
const controller = require('../controllers/invites.controller');
const validate = require('../middlewares/validate');
const asyncHandler = require('../utils/async-handler');
const { requireAuth } = require('../middlewares/auth');
const { createInviteSchema, updateInviteSchema, inviteIdSchema, listInvitesSchema, publicInviteSchema, trackInviteSchema } = require('../dtos/invites.dto');
const { env } = require('../config/env');

const adminRouter = express.Router();
adminRouter.use(requireAuth);
adminRouter.get('/', validate(listInvitesSchema), asyncHandler(controller.list));
adminRouter.post('/', validate(createInviteSchema), asyncHandler(controller.create));
adminRouter.get('/:id', validate(inviteIdSchema), asyncHandler(controller.get));
adminRouter.put('/:id', validate(updateInviteSchema), asyncHandler(controller.update));
adminRouter.patch('/:id', validate(updateInviteSchema), asyncHandler(controller.update));
adminRouter.delete('/:id', validate(inviteIdSchema), asyncHandler(controller.remove));

const publicRouter = express.Router();
publicRouter.get('/:slug', validate(publicInviteSchema), asyncHandler(controller.getPublic));
publicRouter.get('/:slug/links/:linkId', validate(trackInviteSchema), asyncHandler(controller.track));

module.exports = [
  { basePath: env.apiPrefix + '/invites', router: adminRouter },
  { basePath: env.apiPrefix + '/public/invites', router: publicRouter }
];
