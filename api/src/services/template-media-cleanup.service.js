const mediaManager = require('../managers/template-media.manager');

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
let interval = null;
let running = false;

async function run() {
  if (running) return { removed: 0, skipped: true };
  running = true;
  let removed = 0;
  try {
    let hasMore = true;
    while (hasMore) {
      const result = await mediaManager.cleanupExpired({ limit: 100 });
      removed += Number(result.removed || 0);
      hasMore = Number(result.scanned || 0) >= 100 && Number(result.removed || 0) > 0;
    }
    if (removed) console.log('[template-media] uploads expirados removidos:', removed);
    return { removed };
  } finally {
    running = false;
  }
}

function start() {
  if (interval) return;
  run().catch((error) => console.error('[template-media cleanup]', error.message));
  interval = setInterval(() => {
    run().catch((error) => console.error('[template-media cleanup]', error.message));
  }, CHECK_INTERVAL_MS);
  interval.unref?.();
}

function stop() {
  if (!interval) return;
  clearInterval(interval);
  interval = null;
}

module.exports = { start, stop, run, CHECK_INTERVAL_MS };
