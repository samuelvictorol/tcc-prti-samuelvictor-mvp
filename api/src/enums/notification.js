const NOTIFICATION_STATUS = Object.freeze({
  DRAFT: 'draft',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  PARTIAL: 'partial',
  SENT: 'sent',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
});

const DELIVERY_STATUS = Object.freeze({
  QUEUED: 'queued',
  PROCESSING: 'processing',
  SENT: 'sent',
  DELIVERED: 'delivered',
  READ: 'read',
  FAILED: 'failed',
  SKIPPED: 'skipped'
});

module.exports = { NOTIFICATION_STATUS, DELIVERY_STATUS };
