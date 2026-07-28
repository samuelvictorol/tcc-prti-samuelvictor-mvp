const express = require('express');
const controller = require('../controllers/template-sets.controller');
const validate = require('../middlewares/validate');
const asyncHandler = require('../utils/async-handler');
const { requireAuth } = require('../middlewares/auth');
const {
  createTemplateSetSchema,
  updateTemplateSetSchema,
  templateSetIdSchema,
  listTemplateSetsSchema
} = require('../dtos/template-sets.dto');
const { env } = require('../config/env');

const router = express.Router();
router.use(requireAuth);
router.get('/', validate(listTemplateSetsSchema), asyncHandler(controller.list));
router.post('/', validate(createTemplateSetSchema), asyncHandler(controller.create));
router.get('/:id', validate(templateSetIdSchema), asyncHandler(controller.get));
router.put('/:id', validate(updateTemplateSetSchema), asyncHandler(controller.update));
router.patch('/:id', validate(updateTemplateSetSchema), asyncHandler(controller.update));
router.delete('/:id', validate(templateSetIdSchema), asyncHandler(controller.remove));

module.exports = { basePath: env.apiPrefix + '/template-sets', router };
