const ApiError = require('../utils/api-error');

function validate(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse({ body: req.body, query: req.query, params: req.params });
    if (!result.success) {
      return next(new ApiError(422, 'Dados invalidos', result.error.flatten(), 'VALIDATION_ERROR'));
    }
    req.validated = result.data;
    return next();
  };
}

module.exports = validate;
