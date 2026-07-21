const express = require('express');
const controller = require('../controllers/templates.controller');
const validate = require('../middlewares/validate');
const asyncHandler = require('../utils/async-handler');
const { requireAuth } = require('../middlewares/auth');
const { createTemplateSchema, updateTemplateSchema, templateIdSchema, listTemplatesSchema } = require('../dtos/templates.dto');
const { env } = require('../config/env');

const router = express.Router();
router.use(requireAuth);
router.get('/', validate(listTemplatesSchema), asyncHandler(controller.list));
router.post('/', validate(createTemplateSchema), asyncHandler(controller.create));
router.get('/:id', validate(templateIdSchema), asyncHandler(controller.get));
router.put('/:id', validate(updateTemplateSchema), asyncHandler(controller.update));
router.patch('/:id', validate(updateTemplateSchema), asyncHandler(controller.update));
router.delete('/:id', validate(templateIdSchema), asyncHandler(controller.remove));

module.exports = { basePath: env.apiPrefix + '/templates', router };
