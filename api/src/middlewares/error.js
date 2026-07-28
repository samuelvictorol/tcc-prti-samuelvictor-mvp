const ApiError = require('../utils/api-error');

function requestPath(req) {
  return req.path || String(req.originalUrl || req.url || '').split('?')[0];
}

function notFound(req, _res, next) {
  next(new ApiError(404, 'Rota nao encontrada: ' + req.method + ' ' + requestPath(req), null, 'NOT_FOUND'));
}

function errorHandler(error, req, res, _next) {
  void _next;
  const status = error.statusCode || (error.name === 'CastError' ? 400 : 500);
  const expose = error.expose === true || status < 500 || process.env.NODE_ENV !== 'production';
  if (status >= 500) {
    console.error('[api:error]', {
      requestId: req.id,
      method: req.method,
      path: requestPath(req),
      status,
      code: error.code || 'INTERNAL_ERROR',
      message: String(error.message || 'Erro interno').slice(0, 500)
    });
    if (process.env.NODE_ENV !== 'production') console.error(error);
  }
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
