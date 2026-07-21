const express = require('express');
const controller = require('../controllers/auth.controller');
const validate = require('../middlewares/validate');
const asyncHandler = require('../utils/async-handler');
const { requireAuth } = require('../middlewares/auth');
const { authLimiter } = require('../middlewares/security');
const { loginSchema, refreshSchema, logoutSchema } = require('../dtos/auth.dto');
const { env } = require('../config/env');

const router = express.Router();
router.post('/login', authLimiter, validate(loginSchema), asyncHandler(controller.login));
router.post('/refresh', authLimiter, validate(refreshSchema), asyncHandler(controller.refresh));
router.post('/logout', validate(logoutSchema), asyncHandler(controller.logout));
router.get('/me', requireAuth, asyncHandler(controller.me));

module.exports = { basePath: env.apiPrefix + '/auth', router };
