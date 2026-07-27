const express = require('express');
const controller = require('../controllers/groups.controller');
const validate = require('../middlewares/validate');
const asyncHandler = require('../utils/async-handler');
const { requireAuth } = require('../middlewares/auth');
const {
  createGroupSchema,
  updateGroupSchema,
  groupIdSchema,
  listGroupsSchema,
  syncInviteGroupsSchema,
  syncExistingGroupInviteSchema
} = require('../dtos/groups.dto');
const { env } = require('../config/env');

const router = express.Router();
router.use(requireAuth);
router.get('/', validate(listGroupsSchema), asyncHandler(controller.list));
router.post('/', validate(createGroupSchema), asyncHandler(controller.create));
router.post('/sync-invites', validate(syncInviteGroupsSchema), asyncHandler(controller.syncInvites));
router.post('/:id/sync-invite', validate(syncExistingGroupInviteSchema), asyncHandler(controller.syncInvite));
router.get('/:id', validate(groupIdSchema), asyncHandler(controller.get));
router.put('/:id', validate(updateGroupSchema), asyncHandler(controller.update));
router.patch('/:id', validate(updateGroupSchema), asyncHandler(controller.update));
router.delete('/:id', validate(groupIdSchema), asyncHandler(controller.remove));

module.exports = [
  { basePath: env.apiPrefix + '/contact-groups', router },
  { basePath: env.apiPrefix + '/groups', router }
];
