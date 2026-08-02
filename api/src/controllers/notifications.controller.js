const notificationsManager = require('../managers/notifications.manager');

async function create(req, res) {
  const headerKey = req.get('idempotency-key');
  const input = { ...req.validated.body, idempotencyKey: req.validated.body.idempotencyKey || (headerKey && headerKey.slice(0, 200)) };
  res.status(202).json({ success: true, data: await notificationsManager.create(input, req.admin.id) });
}
async function list(req, res) {
  res.json({ success: true, data: await notificationsManager.list(req.validated.query) });
}
async function listDeliveryIssues(req, res) {
  res.json({ success: true, data: await notificationsManager.listDeliveryIssues(req.validated.query) });
}
async function listExternalProviderIssues(req, res) {
  res.json({ success: true, data: await notificationsManager.listExternalProviderIssues(req.validated.query) });
}
async function listDeliveries(req, res) {
  res.json({
    success: true,
    data: await notificationsManager.listDeliveries(
      req.validated.params.id,
      req.validated.query
    )
  });
}
async function get(req, res) {
  res.json({ success: true, data: await notificationsManager.getById(req.validated.params.id) });
}
async function stats(_req, res) {
  res.json({ success: true, data: await notificationsManager.stats() });
}
async function retry(req, res) {
  res.status(202).json({ success: true, data: await notificationsManager.retry(req.validated.params.id) });
}
async function retryExternalDelivery(req, res) {
  res.status(202).json({
    success: true,
    data: await notificationsManager.retryExternalDelivery(
      req.validated.params.id,
      req.validated.params.deliveryId
    )
  });
}
async function retryExternalDeliveryById(req, res) {
  res.status(202).json({
    success: true,
    data: await notificationsManager.retryExternalDeliveryById(req.validated.params.deliveryId)
  });
}
async function retryExternalProviderIssue(req, res) {
  res.status(202).json({
    success: true,
    data: await notificationsManager.retryExternalProviderIssue(req.validated.params.errorCode)
  });
}
async function cancel(req, res) {
  res.json({ success: true, data: await notificationsManager.cancel(req.validated.params.id) });
}

module.exports = {
  create,
  list,
  listDeliveryIssues,
  listExternalProviderIssues,
  listDeliveries,
  get,
  stats,
  retry,
  retryExternalDelivery,
  retryExternalDeliveryById,
  retryExternalProviderIssue,
  cancel
};
