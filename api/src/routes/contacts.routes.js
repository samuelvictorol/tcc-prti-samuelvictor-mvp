const express = require('express');
const controller = require('../controllers/contacts.controller');
const validate = require('../middlewares/validate');
const asyncHandler = require('../utils/async-handler');
const { requireAuth } = require('../middlewares/auth');
const {
  createContactSchema,
  updateContactSchema,
  contactIdSchema,
  removeContactInviteSchema,
  listContactsSchema
} = require('../dtos/contacts.dto');
const { env } = require('../config/env');

const router = express.Router();
router.use(requireAuth);
router.get('/', validate(listContactsSchema), asyncHandler(controller.list));
router.post('/', validate(createContactSchema), asyncHandler(controller.create));
router.get('/:id', validate(contactIdSchema), asyncHandler(controller.get));
router.put('/:id', validate(updateContactSchema), asyncHandler(controller.update));
router.patch('/:id', validate(updateContactSchema), asyncHandler(controller.update));
router.delete('/:id/invites/:inviteId', validate(removeContactInviteSchema), asyncHandler(controller.removeInvite));
router.delete('/:id', validate(contactIdSchema), asyncHandler(controller.remove));

module.exports = { basePath: env.apiPrefix + '/contacts', router };
