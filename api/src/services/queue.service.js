const { Queue, Worker } = require('bullmq');
const { env } = require('../config/env');

let queue;
let worker;
let inlineProcessor;

function connectionOptions() {
  const url = new URL(env.redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname && url.pathname !== '/' ? Number(url.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
    connectTimeout: 5_000,
    retryStrategy: env.redisRequired ? (times) => Math.min(times * 100, 3_000) : () => null
  };
}

function registerNotificationProcessor(processor) {
  inlineProcessor = processor;
}

async function initializeQueue() {
  try {
    queue = new Queue('notifications', { connection: connectionOptions() });
    await queue.waitUntilReady();
    if (inlineProcessor) {
      worker = new Worker('notifications', (job) => inlineProcessor(job.data), {
        connection: connectionOptions(),
        concurrency: 5
      });
      worker.on('error', (error) => console.error('[queue worker]', error.message));
    }
  } catch (error) {
    queue = undefined;
    if (env.redisRequired) throw error;
    console.warn('[queue] indisponivel; processando localmente:', error.message);
  }
}

async function enqueueNotification(data) {
  if (queue) {
    const job = await queue.add('dispatch', data, {
      attempts: 4,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 500,
      removeOnFail: 1000,
      jobId: data.jobId || data.notificationId
    });
    return { mode: 'queue', jobId: job.id };
  }
  if (!inlineProcessor) throw new Error('Processador de notificacoes nao registrado');
  setImmediate(() => inlineProcessor(data).catch((error) => console.error('[inline notification]', error)));
  return { mode: 'inline', jobId: data.notificationId };
}

async function closeQueue() {
  await worker?.close();
  await queue?.close();
  worker = undefined;
  queue = undefined;
}

module.exports = { registerNotificationProcessor, initializeQueue, enqueueNotification, closeQueue };
