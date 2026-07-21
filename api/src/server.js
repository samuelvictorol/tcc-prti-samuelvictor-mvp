const http = require('node:http');
const { createApp, corsOptions } = require('./app');
const { env, validateEnv } = require('./config/env');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const { connectRedis, disconnectRedis } = require('./services/redis.service');
const { initializeSocket } = require('./services/socket.service');
const queueService = require('./services/queue.service');
const authManager = require('./managers/auth.manager');
const notificationsManager = require('./managers/notifications.manager');

let server;
let shuttingDown = false;

async function start() {
  validateEnv();
  await connectDatabase();
  await authManager.bootstrapAdmins();
  await connectRedis();
  queueService.registerNotificationProcessor(notificationsManager.processJob);
  await queueService.initializeQueue();
  await notificationsManager.recoverStale();

  const app = createApp();
  server = http.createServer(app);
  const cors = corsOptions();
  initializeSocket(server, { cors: { origin: cors.origin, credentials: true } });

  await new Promise((resolve) => server.listen(env.port, '0.0.0.0', resolve));
  console.log('[api] ouvindo em 0.0.0.0:' + env.port);

  if (env.whatsappWebAutoInit) {
    const whatsappWebManager = require('./managers/whatsapp-web.manager');
    whatsappWebManager.initialize().catch((error) => console.error('[whatsapp-web auto-init]', error.message));
  }
  return server;
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[api] encerrando por ' + signal);
  if (server) await new Promise((resolve) => server.close(resolve));
  await queueService.closeQueue();
  await disconnectRedis();
  await disconnectDatabase();
}

if (require.main === module) {
  start().catch((error) => {
    console.error('[api] falha ao iniciar', error);
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => shutdown(signal).then(() => process.exit(0)).catch(() => process.exit(1)));
  }
}

module.exports = { start, shutdown };
