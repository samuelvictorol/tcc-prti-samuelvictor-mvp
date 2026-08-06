const crypto = require('node:crypto');
const mongoose = require('mongoose');
const WhatsappCloudWebhookEvent = require('../models/whatsapp-cloud-webhook-event.model');
const { encrypt, decrypt } = require('../services/crypto.service');
const { emit } = require('../services/socket.service');
const { parsePagination, pageResult } = require('../utils/pagination');
const {
  WEBHOOK_PROCESSING_STATUS,
  WEBHOOK_PROCESSING_LEASE_MS
} = require('../enums/whatsapp-cloud-webhook');
const ApiError = require('../utils/api-error');

const FILTER_PATTERN = /^[a-z0-9_.:-]{1,100}$/i;

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => (
      JSON.stringify(key) + ':' + stableStringify(value[key])
    )).join(',') + '}';
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function parseOriginalPayload(payload, rawBody) {
  if (Buffer.isBuffer(rawBody) && rawBody.length) {
    try {
      return JSON.parse(rawBody.toString('utf8'));
    } catch (_error) {
      // O body já passou pelo parser JSON; o fallback abaixo permanece seguro.
    }
  }
  return payload;
}

function payloadWithRedactedMessages(payload, messageIds, replacement) {
  const ids = new Set(Array.from(messageIds || []).map(String).filter(Boolean));
  if (!ids.size) return payload;
  const redacted = structuredClone(payload);
  for (const entry of asArray(redacted?.entry)) {
    for (const change of asArray(entry?.changes)) {
      for (const message of asArray(change?.value?.messages)) {
        if (ids.has(String(message?.id || '')) && message?.text?.body !== undefined) {
          message.text.body = replacement;
        }
      }
    }
  }
  return redacted;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, max = 160) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : null;
}

function safeDiagnosticText(value, max) {
  const normalized = cleanText(value, max);
  if (!normalized) return null;
  return normalized
    .replace(/(bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:token|secret|password|authorization|cookie)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isUnsupportedMessage(message = {}) {
  const type = String(message.type || '').toLowerCase();
  return ['unsupported', 'unknown'].includes(type)
    || providerErrorsFor(message).some((error) => Number(error?.code) === 131051);
}

function safeProviderError(error = {}) {
  const rawCode = error.code;
  const code = Number.isFinite(Number(rawCode))
    ? Number(rawCode)
    : cleanText(rawCode, 100);
  const details = cleanText(error.error_data?.details ?? error.details, 500);
  return {
    code: code ?? null,
    title: safeDiagnosticText(error.title, 160),
    message: safeDiagnosticText(error.message, 300),
    details: safeDiagnosticText(details, 500)
  };
}

function rawProviderErrorsFor(value = {}) {
  const found = [];
  const seen = new WeakSet();
  const visitedErrors = new WeakSet();

  function add(error) {
    if (!error || typeof error !== 'object' || visitedErrors.has(error)) return;
    visitedErrors.add(error);
    found.push(error);
  }

  function visit(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 12 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      const normalizedKey = String(key).toLowerCase();
      if (normalizedKey === 'errors' && Array.isArray(child)) {
        for (const error of child) add(error);
      } else if (
        normalizedKey === 'error'
        && child
        && typeof child === 'object'
        && ('code' in child || 'title' in child || 'message' in child || 'error_data' in child)
      ) {
        add(child);
      }
      visit(child, depth + 1);
    }
  }

  visit(value);
  return found;
}

function providerErrorsFor(value = {}) {
  const uniqueErrors = new Map();
  for (const error of rawProviderErrorsFor(value).map(safeProviderError)) {
    const key = stableStringify(error);
    if (!uniqueErrors.has(key)) uniqueErrors.set(key, error);
  }
  return [...uniqueErrors.values()];
}

function eventTypeFor(field, value = {}) {
  if (field !== 'messages') return field || 'unknown';
  const messages = asArray(value.messages);
  const hasMessages = messages.length > 0;
  const hasStatuses = Array.isArray(value.statuses) && value.statuses.length > 0;
  const hasErrors = providerErrorsFor(value).length > 0;
  if (hasMessages && hasStatuses) return 'message_and_status';
  if (hasMessages && messages.every(isUnsupportedMessage)) return 'unsupported_message';
  if (hasMessages) return 'message';
  if (hasStatuses) return 'status';
  if (hasErrors) return 'error';
  return 'messages';
}

function eventTypesFor(field, value = {}) {
  if (field !== 'messages') return [field || 'unknown'];
  const types = unique([
    ...asArray(value.messages).map((message) => 'message:' + cleanText(message?.type || 'unknown', 40)),
    ...asArray(value.statuses).map((status) => 'status:' + cleanText(status?.status || 'unknown', 40)),
    ...providerErrorsFor(value).flatMap((error) => [
      'error',
      'error:' + cleanText(error.code || 'unknown', 40)
    ])
  ]);
  return types.length ? types : ['messages'];
}

function asTimestamp(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date;
}

function occurredAtFor(value = {}, fallback) {
  const candidates = [
    ...asArray(value.messages).map((item) => item?.timestamp),
    ...asArray(value.statuses).map((item) => item?.timestamp),
    value.timestamp,
    value.event_time
  ];
  return candidates.map(asTimestamp).find(Boolean) || fallback;
}

function humanizeField(field) {
  return cleanText(field || 'unknown', 100).replace(/[_.:-]+/g, ' ');
}

function buildSummary(field, value = {}) {
  const messages = Array.isArray(value.messages) ? value.messages : [];
  const statuses = Array.isArray(value.statuses) ? value.statuses : [];
  const contacts = Array.isArray(value.contacts) ? value.contacts : [];
  const providerErrors = providerErrorsFor(value);
  const unsupportedMessages = messages.filter(isUnsupportedMessage);
  const messageTypes = unique(messages.map((message) => cleanText(message?.type || 'unknown', 40)));
  const statusTypes = unique(statuses.map((status) => cleanText(status?.status || 'unknown', 40)));
  const parts = [];
  if (unsupportedMessages.length) {
    parts.push(unsupportedMessages.length + (unsupportedMessages.length === 1
      ? ' mensagem nao suportada'
      : ' mensagens nao suportadas'));
  } else if (messages.length) {
    parts.push(messages.length + (messages.length === 1 ? ' mensagem' : ' mensagens'));
  }
  if (statuses.length) parts.push(statuses.length + (statuses.length === 1 ? ' status' : ' status'));
  if (contacts.length) parts.push(contacts.length + (contacts.length === 1 ? ' contato' : ' contatos'));
  if (providerErrors.length) parts.push(providerErrors.length + (providerErrors.length === 1 ? ' erro informado' : ' erros informados'));
  const primaryError = providerErrors[0];
  if (primaryError) {
    const code = primaryError.code === null ? null : 'META_' + primaryError.code;
    const diagnostic = unique([primaryError.title, primaryError.message, primaryError.details]).join(' - ');
    if (code || diagnostic) parts.push([code, diagnostic].filter(Boolean).join(': '));
  }
  if (!parts.length) parts.push('Atualização recebida da Meta');
  return {
    title: 'WhatsApp Cloud · ' + humanizeField(field),
    description: parts.join(' · '),
    messageCount: messages.length,
    statusCount: statuses.length,
    contactCount: contacts.length,
    errorCount: providerErrors.length,
    unsupportedCount: unsupportedMessages.length,
    unsupportedTypes: unique(unsupportedMessages.map((message) => (
      cleanText(message?.unsupported?.raw_type ?? message?.unsupported?.type ?? 'unknown', 80)
    ))),
    providerErrors,
    messageTypes,
    statusTypes
  };
}

function scopedEventValue(value, property, item) {
  const scoped = { ...value };
  delete scoped.messages;
  delete scoped.statuses;
  delete scoped.errors;
  scoped[property] = [item];
  return scoped;
}

function descriptorsForChange({ object, businessAccountId, field, value, source }) {
  const base = { object, businessAccountId, field, source };
  if (field !== 'messages') return [{ ...base, kind: 'generic', value }];

  const descriptors = [
    ...asArray(value.messages).map((message, index) => ({
      ...base,
      source: source + '.messages.' + index,
      kind: 'message',
      providerEventId: cleanText(message?.id, 500),
      value: scopedEventValue(value, 'messages', message)
    })),
    ...asArray(value.statuses).map((status, index) => ({
      ...base,
      source: source + '.statuses.' + index,
      kind: 'status',
      providerEventId: cleanText(status?.id, 500),
      providerState: cleanText(status?.status, 100) || 'unknown',
      value: scopedEventValue(value, 'statuses', status)
    })),
    ...asArray(value.errors).map((error, index) => ({
      ...base,
      source: source + '.errors.' + index,
      kind: 'error',
      value: scopedEventValue(value, 'errors', error)
    }))
  ];
  return descriptors.length ? descriptors : [{ ...base, kind: 'generic', value }];
}

function extractEvents(payload) {
  const events = [];
  const object = cleanText(payload?.object, 100) || 'whatsapp_business_account';
  for (const [entryIndex, entry] of asArray(payload?.entry).entries()) {
    for (const [changeIndex, change] of asArray(entry?.changes).entries()) {
      const field = cleanText(change?.field, 100) || 'unknown';
      const value = change?.value && typeof change.value === 'object' ? change.value : {};
      events.push(...descriptorsForChange({
        object,
        businessAccountId: cleanText(entry?.id, 200),
        field,
        value,
        source: 'entry.' + entryIndex + '.changes.' + changeIndex
      }));
    }
  }
  if (events.length) return events;

  if (payload?.sample && typeof payload.sample === 'object') {
    const field = cleanText(payload.sample.field, 100) || 'sample';
    const value = payload.sample.value && typeof payload.sample.value === 'object'
      ? payload.sample.value
      : payload.sample;
    return descriptorsForChange({
      object,
      businessAccountId: cleanText(payload.entry?.[0]?.id, 200),
      field,
      value,
      source: 'sample'
    });
  }

  const field = cleanText(payload?.field, 100) || 'unknown';
  const value = payload?.value && typeof payload.value === 'object' ? payload.value : payload || {};
  return descriptorsForChange({
    object,
    businessAccountId: cleanText(payload?.entry?.[0]?.id, 200),
    field,
    value,
    source: 'payload'
  });
}

function dedupeIdentityFor(descriptor) {
  const base = {
    object: descriptor.object,
    businessAccountId: descriptor.businessAccountId || null,
    field: descriptor.field
  };
  if (descriptor.kind === 'message' && descriptor.providerEventId) {
    return { ...base, kind: 'message', providerEventId: descriptor.providerEventId };
  }
  if (descriptor.kind === 'status' && descriptor.providerEventId) {
    return {
      ...base,
      kind: 'status',
      providerEventId: descriptor.providerEventId,
      state: descriptor.providerState
    };
  }
  return { ...base, value: descriptor.value };
}

function dedupeKeyFor(descriptor) {
  return sha256(stableStringify(dedupeIdentityFor(descriptor)));
}

function plain(record) {
  return typeof record?.toObject === 'function' ? record.toObject() : record;
}

function toListItem(record) {
  const item = plain(record) || {};
  return {
    id: String(item._id || item.id),
    object: item.object,
    businessAccountId: item.businessAccountId || null,
    field: item.field,
    eventType: item.eventType,
    eventTypes: item.eventTypes || [],
    summary: item.summary || {},
    processingStatus: item.processingStatus,
    processingError: item.processingError?.message ? {
      code: item.processingError.code || 'PROCESSING_ERROR',
      message: item.processingError.message
    } : null,
    duplicateCount: Math.max(0, Number(item.receiptCount || 1) - 1),
    occurredAt: item.occurredAt,
    receivedAt: item.receivedAt,
    lastReceivedAt: item.lastReceivedAt,
    processedAt: item.processedAt || null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

async function upsertEvent(input) {
  let result;
  try {
    result = await WhatsappCloudWebhookEvent.updateOne(
      { dedupeKey: input.dedupeKey },
      {
        $setOnInsert: input.document,
        $set: { lastReceivedAt: input.receivedAt },
        $inc: { receiptCount: 1 }
      },
      { upsert: true }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    result = await WhatsappCloudWebhookEvent.updateOne(
      { dedupeKey: input.dedupeKey },
      { $set: { lastReceivedAt: input.receivedAt }, $inc: { receiptCount: 1 } }
    );
  }
  const record = await WhatsappCloudWebhookEvent.findOne({ dedupeKey: input.dedupeKey }).lean();
  return { record, created: Boolean(result?.upsertedCount) };
}

async function persistPayload(payload, rawBody, options = {}) {
  const receivedAt = new Date();
  const originalPayload = parseOriginalPayload(payload, rawBody);
  const canonicalPayload = stableStringify(originalPayload);
  const payloadHash = sha256(canonicalPayload);
  const redactedMessageIds = new Set(options.redactedMessageIds || []);
  const storedPayload = payloadWithRedactedMessages(
    originalPayload,
    redactedMessageIds,
    options.redactionText || '[Codigo de verificacao de email]'
  );
  const payloadEncrypted = encrypt({ payload: storedPayload });
  const descriptors = extractEvents(originalPayload);
  const persisted = [];
  const workItems = [];

  for (const descriptor of descriptors) {
    const eventType = eventTypeFor(descriptor.field, descriptor.value);
    const dedupeKey = dedupeKeyFor(descriptor);
    const result = await upsertEvent({
      dedupeKey,
      receivedAt,
      document: {
        dedupeKey,
        payloadHash,
        payloadEncrypted,
        object: descriptor.object,
        businessAccountId: descriptor.businessAccountId,
        field: descriptor.field,
        eventType,
        eventTypes: eventTypesFor(descriptor.field, descriptor.value),
        summary: buildSummary(descriptor.field, descriptor.value),
        processingStatus: WEBHOOK_PROCESSING_STATUS.RECEIVED,
        receivedAt,
        occurredAt: occurredAtFor(descriptor.value, receivedAt)
      }
    });
    // Um retry de um evento legado pode encontrar um registro criado antes da
    // protecao de OTP. Nesse caso, substitua somente o payload criptografado;
    // hash, dedupe e metadados diagnosticos continuam derivados do original.
    if (redactedMessageIds.size && !result.created) {
      await WhatsappCloudWebhookEvent.updateOne(
        { dedupeKey },
        { $set: { payloadEncrypted } }
      );
    }
    const item = toListItem(result.record);
    persisted.push({ ...item, created: result.created });
    workItems.push({ eventId: item.id, descriptor });
    emit('whatsapp_cloud:webhook_event', item);
  }

  return {
    events: persisted,
    workItems,
    createdCount: persisted.filter((event) => event.created).length,
    duplicateCount: persisted.filter((event) => !event.created).length
  };
}

function safeProcessingError(error) {
  const safeMessage = (cleanText(error?.message, 500) || 'Falha ao processar o webhook')
    .replace(/(bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:token|secret|password|authorization|cookie)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
  return {
    code: cleanText(error?.code, 100) || 'PROCESSING_ERROR',
    message: safeMessage
  };
}

async function claimEvent(eventId, options = {}) {
  const now = options.now || new Date();
  const leaseMs = Math.max(1, Number(options.leaseMs) || WEBHOOK_PROCESSING_LEASE_MS);
  const leaseUntil = new Date(now.getTime() + leaseMs);
  const token = crypto.randomBytes(24).toString('base64url');
  const record = await WhatsappCloudWebhookEvent.findOneAndUpdate(
    {
      _id: eventId,
      processingStatus: {
        $in: [
          WEBHOOK_PROCESSING_STATUS.RECEIVED,
          WEBHOOK_PROCESSING_STATUS.PROCESSING,
          WEBHOOK_PROCESSING_STATUS.FAILED
        ]
      },
      $or: [
        { processingLeaseUntil: { $exists: false } },
        { processingLeaseUntil: null },
        { processingLeaseUntil: { $lte: now } }
      ]
    },
    {
      $set: {
        processingStatus: WEBHOOK_PROCESSING_STATUS.PROCESSING,
        processingToken: token,
        processingStartedAt: now,
        processingLeaseUntil: leaseUntil
      },
      $inc: { processingAttempts: 1 },
      $unset: { processingError: 1, processedAt: 1 }
    },
    { new: true }
  ).lean();
  if (!record) return null;
  emit('whatsapp_cloud:webhook_event', toListItem(record));
  return { id: String(record._id || eventId), token, leaseUntil };
}

async function markProcessed(claim) {
  if (!claim?.id || !claim?.token) return false;
  const processedAt = new Date();
  const record = await WhatsappCloudWebhookEvent.findOneAndUpdate(
    {
      _id: claim.id,
      processingStatus: WEBHOOK_PROCESSING_STATUS.PROCESSING,
      processingToken: claim.token
    },
    {
      $set: { processingStatus: WEBHOOK_PROCESSING_STATUS.PROCESSED, processedAt },
      $unset: {
        processingError: 1,
        processingToken: 1,
        processingLeaseUntil: 1
      }
    },
    { new: true }
  ).lean();
  if (!record) return false;
  emit('whatsapp_cloud:webhook_event', toListItem(record));
  return true;
}

async function markFailed(claim, error) {
  if (!claim?.id || !claim?.token) return false;
  const record = await WhatsappCloudWebhookEvent.findOneAndUpdate(
    {
      _id: claim.id,
      processingStatus: WEBHOOK_PROCESSING_STATUS.PROCESSING,
      processingToken: claim.token
    },
    {
      $set: {
        processingStatus: WEBHOOK_PROCESSING_STATUS.FAILED,
        processingError: safeProcessingError(error)
      },
      $unset: {
        processingToken: 1,
        processingLeaseUntil: 1
      }
    },
    { new: true }
  ).lean();
  if (!record) return false;
  emit('whatsapp_cloud:webhook_event', toListItem(record));
  return true;
}

function filterValue(query, key) {
  if (query[key] === undefined || query[key] === '') return null;
  const value = String(query[key]).trim();
  if (!FILTER_PATTERN.test(value)) {
    throw new ApiError(422, 'Filtro ' + key + ' inválido', null, 'INVALID_WEBHOOK_EVENT_FILTER');
  }
  return value;
}

async function list(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  const field = filterValue(query, 'field');
  const eventType = filterValue(query, 'eventType');
  const processingStatus = filterValue(query, 'processingStatus');
  if (field) filter.field = field;
  if (eventType) filter.eventType = eventType;
  if (processingStatus) {
    if (!Object.values(WEBHOOK_PROCESSING_STATUS).includes(processingStatus)) {
      throw new ApiError(422, 'Status de processamento inválido', null, 'INVALID_WEBHOOK_EVENT_STATUS');
    }
    filter.processingStatus = processingStatus;
  }
  const [records, total] = await Promise.all([
    WhatsappCloudWebhookEvent.find(filter)
      .sort({ receivedAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    WhatsappCloudWebhookEvent.countDocuments(filter)
  ]);
  return pageResult(records.map(toListItem), total, page, limit);
}

async function getById(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw new ApiError(400, 'Identificador de evento inválido', null, 'INVALID_WEBHOOK_EVENT_ID');
  }
  const record = await WhatsappCloudWebhookEvent.findById(id).select('+payloadEncrypted').lean();
  if (!record) throw new ApiError(404, 'Evento de webhook não encontrado', null, 'WEBHOOK_EVENT_NOT_FOUND');
  let payload;
  try {
    payload = decrypt(record.payloadEncrypted, { json: true })?.payload;
  } catch (_error) {
    throw new ApiError(500, 'Não foi possível abrir os detalhes do webhook', null, 'WEBHOOK_EVENT_DECRYPTION_FAILED');
  }
  return { ...toListItem(record), payload };
}

module.exports = {
  persistPayload,
  claimEvent,
  markProcessed,
  markFailed,
  list,
  getById,
  extractEvents,
  buildSummary,
  eventTypeFor,
  eventTypesFor,
  dedupeIdentityFor,
  dedupeKeyFor,
  stableStringify,
  payloadWithRedactedMessages,
  providerErrorsFor,
  toListItem
};
