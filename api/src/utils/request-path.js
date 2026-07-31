const { env } = require('../config/env');

function safeRequestPath(req) {
  const value = req.path || String(req.originalUrl || req.url || '').split('?')[0] || '/';
  const mediaPrefix = env.apiPrefix + '/media/';
  if (value.startsWith(mediaPrefix)) return mediaPrefix + ':token';
  return value;
}

module.exports = { safeRequestPath };
