const express = require('express');
const controller = require('../controllers/logs.controller');
const asyncHandler = require('../utils/async-handler');
const { requireAuth } = require('../middlewares/auth');
const { env } = require('../config/env');

const router = express.Router();
router.get('/', requireAuth, asyncHandler(controller.list));
module.exports = { basePath: env.apiPrefix + '/logs', router };
