const ApiError = require('../utils/api-error');

function notFound(req, _res, next) {
  next(new ApiError(404, 'Rota nao encontrada: ' + req.method + ' ' + req.originalUrl, null, 'NOT_FOUND'));
}

function errorHandler(error, req, res, _next) {
  void _next;
  const status = error.statusCode || (error.name === 'CastError' ? 400 : 500);
  const expose = error.expose === true || status < 500 || process.env.NODE_ENV !== 'production';
  if (status >= 500) console.error(error);
  res.status(status).json({
    success: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: expose ? error.message : 'Erro interno',
      details: expose ? error.details : undefined,
      requestId: req.id
    }
  });
}

module.exports = { notFound, errorHandler };
