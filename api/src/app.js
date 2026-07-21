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
const { requestContext, ipBlock, apiLimiter } = require('./middlewares/security');
const { notFound, errorHandler } = require('./middlewares/error');

morgan.token('safe-path', (req) => req.path || '/');

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

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.trustProxy);
  app.use(requestContext);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors(corsOptions()));
  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({
    limit: '2mb',
    verify(req, _res, buffer) { req.rawBody = Buffer.from(buffer); }
  }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(mongoSanitize({ replaceWith: '_' }));
  app.use(hpp());
  app.use(morgan(env.nodeEnv === 'production'
    ? ':remote-addr - :method :safe-path :status :res[content-length] - :response-time ms'
    : 'dev'));
  app.use(ipBlock);
  app.use(env.apiPrefix, apiLimiter);
  loadRoutes(app);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp, corsOptions };
