const Log = require('../models/log.model');
const { emit } = require('../services/socket.service');
const { parsePagination, pageResult } = require('../utils/pagination');

function redact(value) {
  if (!value || typeof value !== 'object') return value;
  const sensitive = /token|secret|password|authorization|cookie|credential/i;
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sensitive.test(key) ? '[REDACTED]' : redact(child)]));
}

async function create(input) {
  const retentionUntil = input.retentionUntil || new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
  const log = await Log.create({ ...input, context: redact(input.context), retentionUntil });
  const output = log.toObject();
  emit('log:created', output);
  return output;
}

async function list(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.level) filter.level = query.level;
  if (query.channel) filter.channel = query.channel;
  if (query.action) filter.action = query.action;
  const [items, total] = await Promise.all([
    Log.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Log.countDocuments(filter)
  ]);
  return pageResult(items, total, page, limit);
}

module.exports = { create, list, redact };
