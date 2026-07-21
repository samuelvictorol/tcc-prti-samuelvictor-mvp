const mongoose = require('mongoose');
const { getRedis } = require('../services/redis.service');
const { env } = require('../config/env');

async function health() {
  const mongodbUp = mongoose.connection.readyState === 1;
  const redisUp = Boolean(getRedis());
  const ready = mongodbUp && (!env.redisRequired || redisUp);
  return {
    status: ready ? 'ok' : 'degraded',
    ready,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    dependencies: {
      mongodb: mongodbUp ? 'up' : 'down',
      redis: redisUp ? 'up' : env.redisRequired ? 'down' : 'optional-down'
    }
  };
}

module.exports = { health };
