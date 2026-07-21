const express = require('express');
const controller = require('../controllers/system.controller');
const asyncHandler = require('../utils/async-handler');
const { env } = require('../config/env');

const rootRouter = express.Router();
rootRouter.get('/', asyncHandler(controller.health));
const apiRouter = express.Router();
apiRouter.get('/', asyncHandler(controller.health));

module.exports = [
  { basePath: '/health', router: rootRouter },
  { basePath: env.apiPrefix + '/health', router: apiRouter }
];
