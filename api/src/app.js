const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const morgan = require('morgan');
const { env } = require('./config/env');
const loadRoutes = require('./routes/loader');
const { requestContext, ipBlock, apiLimiter, webhookLimiter, mediaLimiter } = require('./middlewares/security');
const { notFound, errorHandler } = require('./middlewares/error');
const { safeRequestPath } = require('./utils/request-path');

morgan.token('safe-path', safeRequestPath);

function corsOptions() {
  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
      const error = new Error('Origem CORS nao permitida');
      error.statusCode = 403;
      return callback(error);
    }
  };
}

function isPublicMediaDownload(req) {
  return ['GET', 'HEAD'].includes(req.method)
    && String(req.path || '').startsWith('/media/');
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.trustProxy);
  app.use(requestContext);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors(corsOptions()));
  app.use(ipBlock);
  app.use(env.apiPrefix + '/webhooks', webhookLimiter);
  app.use(env.apiPrefix, (req, res, next) => (
    isPublicMediaDownload(req) ? mediaLimiter(req, res, next) : apiLimiter(req, res, next)
  ));
  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({
    limit: '2mb',
    verify(req, _res, buffer) { req.rawBody = Buffer.from(buffer); }
  }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(mongoSanitize({ replaceWith: '_' }));
  app.use(hpp());
  app.use(morgan(':remote-addr - :method :safe-path :status :res[content-length] - :response-time ms'));
  loadRoutes(app);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp, corsOptions, isPublicMediaDownload };
