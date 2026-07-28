const whatsappCloudManager = require('../managers/whatsapp-cloud.manager');

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 30_000;
let initialTimer = null;
let interval = null;

async function run() {
  try {
    const result = await whatsappCloudManager.createAutomaticBackupIfDue();
    if (result?.created) {
      console.log('[whatsapp-cloud backup] snapshot automatico criado', {
        backupId: result.id,
        conversationCount: result.conversationCount,
        messageCount: result.messageCount
      });
    }
  } catch (error) {
    console.error('[whatsapp-cloud backup]', error.message);
  }
}

function start() {
  if (initialTimer || interval) return;
  initialTimer = setTimeout(() => {
    initialTimer = null;
    run();
  }, INITIAL_DELAY_MS);
  initialTimer.unref?.();
  interval = setInterval(run, CHECK_INTERVAL_MS);
  interval.unref?.();
}

function stop() {
  if (initialTimer) clearTimeout(initialTimer);
  if (interval) clearInterval(interval);
  initialTimer = null;
  interval = null;
}

module.exports = { start, stop, run, CHECK_INTERVAL_MS, INITIAL_DELAY_MS };
