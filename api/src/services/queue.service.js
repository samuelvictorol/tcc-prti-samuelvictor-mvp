const { Queue, Worker } = require('bullmq');
const { randomUUID } = require('node:crypto');
const { env } = require('../config/env');

let queue;
let worker;
let inlineProcessor;
let recoveryProcessor;
let recoveryTimer;
let recoverySweepInFlight = false;

const RECOVERY_SWEEP_INTERVAL_MS = 60_000;

function connectionOptions(options = {}) {
  const url = new URL(env.redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname && url.pathname !== '/' ? Number(url.pathname.slice(1)) : 0,
    // Workers use a blocking connection and must wait for Redis. Producers
    // should fail quickly so the durable Mongo recovery marker can take over.
    maxRetriesPerRequest: options.blocking ? null : 1,
    connectTimeout: 5_000,
    retryStrategy: env.redisRequired ? (times) => Math.min(times * 100, 3_000) : () => null
  };
}

function registerNotificationProcessor(processor, recoverer) {
  inlineProcessor = processor;
  recoveryProcessor = recoverer;
}

function workerPayload(job, lockToken) {
  return {
    ...job.data,
    queueContext: {
      jobId: String(job.id || job.data.jobId || job.data.notificationId),
      lockToken: String(lockToken || job.token || randomUUID()),
      attemptsStarted: Number(job.attemptsStarted || 1),
      attemptsMade: Number(job.attemptsMade || 0),
      maxAttempts: Math.max(1, Number(job.opts?.attempts || 1)),
      stalledCounter: Number(job.stalledCounter || 0)
    }
  };
}

function startRecoverySweep() {
  if (!recoveryProcessor || recoveryTimer) return;
  recoveryTimer = setInterval(async () => {
    if (recoverySweepInFlight) return;
    recoverySweepInFlight = true;
    try {
      await recoveryProcessor();
    } catch (error) {
      console.error('[notification recovery]', error.message);
    } finally {
      recoverySweepInFlight = false;
    }
  }, RECOVERY_SWEEP_INTERVAL_MS);
  recoveryTimer.unref?.();
}

async function initializeQueue() {
  try {
    queue = new Queue('notifications', { connection: connectionOptions() });
    await queue.waitUntilReady();
    if (inlineProcessor) {
      worker = new Worker('notifications', (job, lockToken) => inlineProcessor(workerPayload(job, lockToken)), {
        connection: connectionOptions({ blocking: true }),
        concurrency: 5,
        maxStalledCount: 3
      });
      worker.on('error', (error) => console.error('[queue worker]', error.message));
    }
  } catch (error) {
    queue = undefined;
    if (env.redisRequired) throw error;
    console.warn('[queue] indisponivel; processando localmente:', error.message);
  }
  startRecoverySweep();
}

async function enqueueNotification(data) {
  const delay = Math.max(0, Math.min(Number(data.delayMs) || 0, 24 * 60 * 60 * 1000));
  const attempts = Math.max(1, Math.min(Number(data.attempts) || 4, 10));
  const payload = { ...data };
  delete payload.delayMs;
  delete payload.attempts;
  if (queue) {
    const job = await queue.add('dispatch', payload, {
      attempts,
      backoff: { type: 'exponential', delay: 2_000 },
      delay,
      removeOnComplete: 500,
      removeOnFail: 1000,
      jobId: data.jobId || data.notificationId
    });
    return { mode: 'queue', jobId: job.id };
  }
  if (!inlineProcessor) throw new Error('Processador de notificacoes nao registrado');
  const process = () => inlineProcessor({
    ...payload,
    queueContext: {
      jobId: String(data.jobId || data.notificationId),
      lockToken: randomUUID(),
      attemptsStarted: 1,
      attemptsMade: 0,
      maxAttempts: attempts,
      stalledCounter: 0
    }
  }).catch((error) => console.error('[inline notification]', error));
  if (delay) setTimeout(process, delay).unref?.();
  else setImmediate(process);
  return { mode: 'inline', jobId: payload.notificationId, delay };
}

async function closeQueue() {
  if (recoveryTimer) clearInterval(recoveryTimer);
  recoveryTimer = undefined;
  recoverySweepInFlight = false;
  await worker?.close();
  await queue?.close();
  worker = undefined;
  queue = undefined;
}

module.exports = {
  registerNotificationProcessor,
  initializeQueue,
  enqueueNotification,
  closeQueue,
  workerPayload,
  connectionOptions
};
