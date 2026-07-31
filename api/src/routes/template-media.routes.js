const express = require('express');
const controller = require('../controllers/template-media.controller');
const { requireAuth } = require('../middlewares/auth');
const { parseTemplateMedia } = require('../middlewares/template-media-upload');
const asyncHandler = require('../utils/async-handler');
const { env } = require('../config/env');

const router = express.Router();

// A URL de leitura e uma capability assinada e opaca: a Meta consegue baixar
// sem Bearer administrativo, enquanto IDs GridFS isolados nao sao enumeraveis.
router.get('/:token', asyncHandler(controller.serve));
router.head('/:token', asyncHandler(controller.serve));
router.post('/', requireAuth, parseTemplateMedia, asyncHandler(controller.upload));
router.delete('/:id', requireAuth, asyncHandler(controller.discard));

module.exports = { basePath: env.apiPrefix + '/media', router };
