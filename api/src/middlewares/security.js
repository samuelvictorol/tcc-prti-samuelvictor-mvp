const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');
const { env } = require('../config/env');
const ApiError = require('../utils/api-error');
const { getRedis } = require('../services/redis.service');

const localStrikes = new Map();

function requestContext(req, res, next) {
  req.id = req.get('x-request-id') || crypto.randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
}

async function ipBlock(req, _res, next) {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const redis = getRedis();
    const blocked = redis ? await redis.get('security:block:' + ip) : localStrikes.get(ip)?.blockedUntil > Date.now();
    if (blocked) return next(new ApiError(429, 'IP temporariamente bloqueado', null, 'IP_BLOCKED'));
    return next();
  } catch (error) {
    return next(error);
  }
}

async function registerSecurityStrike(ip) {
  const redis = getRedis();
  if (redis) {
    const key = 'security:strikes:' + ip;
    const strikes = await redis.incr(key);
    if (strikes === 1) await redis.expire(key, env.ipBlockSeconds);
    if (strikes >= env.ipBlockAfter) {
      await redis.set('security:block:' + ip, '1', { EX: env.ipBlockSeconds });
      await redis.del(key);
    }
    return;
  }
  const current = localStrikes.get(ip) || { count: 0, blockedUntil: 0 };
  current.count += 1;
  if (current.count >= env.ipBlockAfter) {
    current.blockedUntil = Date.now() + env.ipBlockSeconds * 1000;
    current.count = 0;
  }
  localStrikes.set(ip, current);
}

const apiLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: env.rateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => String(req.originalUrl || '').startsWith(env.apiPrefix + '/webhooks/')
});

const webhookLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: env.webhookRateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});

const mediaLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: env.mediaRateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: env.authRateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

const profileCodeRequestLimiter = rateLimit({
  windowMs: env.profileCodeWindowSeconds * 1000,
  limit: env.profileCodeMaxRequests,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});

const profileCodeVerifyLimiter = rateLimit({
  windowMs: env.profileCodeWindowSeconds * 1000,
  limit: Math.max(10, env.profileCodeMaxRequests * env.profileCodeMaxAttempts),
  standardHeaders: 'draft-7',
  legacyHeaders: false
});

const settingsRevealLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: Math.max(3, Math.min(10, env.authRateLimitMax)),
  keyGenerator: (req) => String(req.admin?.id || 'authenticated-admin'),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler(_req, _res, next) {
    next(new ApiError(429, 'Muitas consultas de credenciais. Tente novamente mais tarde.', null, 'SETTINGS_REVEAL_RATE_LIMITED'));
  }
});

module.exports = {
  requestContext, ipBlock, registerSecurityStrike, apiLimiter, webhookLimiter, mediaLimiter, authLimiter,
  profileCodeRequestLimiter, profileCodeVerifyLimiter, settingsRevealLimiter
};
