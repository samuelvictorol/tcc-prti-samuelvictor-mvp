const { createClient } = require('redis');
const { env } = require('../config/env');

let client;
let connected = false;

async function connectRedis() {
  if (client) return client;
  client = createClient({
    url: env.redisUrl,
    socket: {
      connectTimeout: 5_000,
      reconnectStrategy: env.redisRequired ? (retries) => Math.min(retries * 100, 3_000) : false
    }
  });
  client.on('error', (error) => {
    connected = false;
    console.error('[redis]', error.message);
  });
  client.on('ready', () => { connected = true; });
  try {
    await client.connect();
    connected = true;
  } catch (error) {
    client = undefined;
    if (env.redisRequired) throw error;
    console.warn('[redis] indisponivel; recursos de fila usarao fallback local:', error.message);
  }
  return client;
}

function getRedis() {
  return connected ? client : null;
}

async function disconnectRedis() {
  if (client?.isOpen) await client.quit();
  client = undefined;
  connected = false;
}

module.exports = { connectRedis, getRedis, disconnectRedis };
