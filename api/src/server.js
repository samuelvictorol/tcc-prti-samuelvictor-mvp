const http = require('node:http');
const { createApp, corsOptions } = require('./app');
const { env, validateEnv } = require('./config/env');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const { connectRedis, disconnectRedis } = require('./services/redis.service');
const { initializeSocket } = require('./services/socket.service');
const queueService = require('./services/queue.service');
const authManager = require('./managers/auth.manager');
const notificationsManager = require('./managers/notifications.manager');
const adminNotificationsManager = require('./managers/admin-notifications.manager');
const telegramManager = require('./managers/telegram.manager');
const contactsManager = require('./managers/contacts.manager');
const templatesManager = require('./managers/templates.manager');
const termsManager = require('./managers/terms.manager');
const conversationBackupScheduler = require('./services/conversation-backup-scheduler.service');
const templateMediaCleanup = require('./services/template-media-cleanup.service');

let server;
let shuttingDown = false;

async function start() {
  validateEnv();
  await connectDatabase();
  await adminNotificationsManager.enforceRetentionPolicy();
  const templateSeed = await templatesManager.ensureSystemTemplates();
  if (templateSeed.created || templateSeed.protected) {
    console.log('[templates] modelos padrao verificados', templateSeed);
  }
  const legalSeed = await termsManager.ensureDefaultTerms();
  if (legalSeed.created) {
    console.log('[terms] documentos legais padrao verificados', legalSeed);
  }
  const phoneRepair = await contactsManager.repairLegacyWhatsappPhones();
  if (phoneRepair.repaired || phoneRepair.cleared) {
    console.log('[contacts] telefones legados corrigidos', phoneRepair);
  }
  await authManager.bootstrapAdmins();
  await connectRedis();
  queueService.registerNotificationProcessor(notificationsManager.processJob, notificationsManager.recoverStale);
  await queueService.initializeQueue();
  await notificationsManager.recoverStale();

  const app = createApp();
  server = http.createServer(app);
  const cors = corsOptions();
  initializeSocket(server, { cors: { origin: cors.origin, credentials: true } });

  await new Promise((resolve) => server.listen(env.port, '0.0.0.0', resolve));
  console.log('[api] ouvindo em 0.0.0.0:' + env.port);

  telegramManager.refreshWebhookRegistration()
    .catch((error) => console.error('[telegram webhook refresh]', error.message));
  conversationBackupScheduler.start();
  templateMediaCleanup.start();
  return server;
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[api] encerrando por ' + signal);
  conversationBackupScheduler.stop();
  templateMediaCleanup.stop();
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
