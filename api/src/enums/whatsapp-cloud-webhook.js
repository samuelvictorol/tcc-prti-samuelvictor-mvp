const WEBHOOK_PROCESSING_STATUS = Object.freeze({
  RECEIVED: 'received',
  PROCESSING: 'processing',
  PROCESSED: 'processed',
  FAILED: 'failed'
});

const WEBHOOK_PROCESSING_LEASE_MS = 2 * 60 * 1000;

module.exports = { WEBHOOK_PROCESSING_STATUS, WEBHOOK_PROCESSING_LEASE_MS };
