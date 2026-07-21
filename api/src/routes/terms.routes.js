const express = require('express');
const controller = require('../controllers/terms.controller');
const validate = require('../middlewares/validate');
const asyncHandler = require('../utils/async-handler');
const { requireAuth } = require('../middlewares/auth');
const { createTermSchema, updateTermSchema, termIdSchema, listTermsSchema, publicTermSchema } = require('../dtos/terms.dto');
const { env } = require('../config/env');

const adminRouter = express.Router();
adminRouter.use(requireAuth);
adminRouter.get('/', validate(listTermsSchema), asyncHandler(controller.list));
adminRouter.post('/', validate(createTermSchema), asyncHandler(controller.create));
adminRouter.get('/:id', validate(termIdSchema), asyncHandler(controller.get));
adminRouter.put('/:id', validate(updateTermSchema), asyncHandler(controller.update));
adminRouter.patch('/:id', validate(updateTermSchema), asyncHandler(controller.update));
adminRouter.delete('/:id', validate(termIdSchema), asyncHandler(controller.remove));

const publicRouter = express.Router();
publicRouter.get('/:type', validate(publicTermSchema), asyncHandler(controller.getPublished));

module.exports = [
  { basePath: env.apiPrefix + '/terms', router: adminRouter },
  { basePath: env.apiPrefix + '/public/terms', router: publicRouter }
];
