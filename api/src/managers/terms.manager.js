const Term = require('../models/term.model');
const crypto = require('node:crypto');
const sanitizeHtml = require('sanitize-html');
const { parsePagination, pageResult } = require('../utils/pagination');
const ApiError = require('../utils/api-error');
const { INITIAL_LEGAL_VERSION, listDefaultLegalDocuments } = require('../utils/default-legal-documents');

async function enforceSinglePublished(term) {
  if (term.status !== 'published') return term;
  term.publishedAt ||= new Date();
  await Term.updateMany({ _id: { $ne: term._id }, type: term.type, status: 'published' }, { $set: { status: 'archived' } });
  return term.save();
}

function clean(input) {
  if (input.content === undefined) return { ...input };
  return {
    ...input,
    content: sanitizeHtml(input.content, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h1', 'h2', 'h3', 'h4', 'section', 'article']),
      allowedAttributes: { a: ['href', 'target', 'rel'], '*': ['class'] },
      allowedSchemes: ['http', 'https', 'mailto']
    })
  };
}

function automaticVersion(now = new Date()) {
  const timestamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return timestamp + '-' + crypto.randomBytes(3).toString('hex');
}

function createDefaults(input) {
  const status = input.status || 'published';
  const now = new Date();
  return {
    ...input,
    version: input.version || automaticVersion(now),
    status,
    effectiveAt: input.effectiveAt || (status === 'published' ? now : undefined),
    publishedAt: status === 'published' ? now : undefined
  };
}

async function create(input, actorId) {
  try {
    const prepared = createDefaults(clean(input));
    const term = await Term.create({ ...prepared, createdBy: actorId, updatedBy: actorId });
    await enforceSinglePublished(term);
    return term.toObject();
  } catch (error) {
    if (error.code === 11000) throw new ApiError(409, 'Versao ja cadastrada para este tipo');
    throw error;
  }
}

async function getById(id) {
  const term = await Term.findById(id).lean();
  if (!term) throw new ApiError(404, 'Termo nao encontrado');
  return term;
}

async function list(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.type) filter.type = query.type;
  if (query.status) filter.status = query.status;
  const [items, total] = await Promise.all([
    Term.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Term.countDocuments(filter)
  ]);
  return pageResult(items, total, page, limit);
}

async function update(id, input, actorId) {
  const term = await Term.findById(id);
  if (!term) throw new ApiError(404, 'Termo nao encontrado');
  if (term.status === 'published') {
    throw new ApiError(409, 'Termo publicado e imutavel; crie uma nova versao', null, 'PUBLISHED_TERM_IMMUTABLE');
  }
  Object.assign(term, clean(input), { updatedBy: actorId });
  if (input.status === 'published' && !term.publishedAt) term.publishedAt = new Date();
  await enforceSinglePublished(term);
  return term.toObject();
}

async function remove(id) {
  const result = await Term.deleteOne({ _id: id, status: { $ne: 'published' } });
  if (!result.deletedCount) throw new ApiError(409, 'Termo publicado nao pode ser excluido ou nao existe');
  return { id: String(id), removed: true };
}

async function getPublished(type) {
  const term = await Term.findOne({ type, status: 'published', $or: [{ effectiveAt: null }, { effectiveAt: { $lte: new Date() } }] }).sort({ publishedAt: -1 }).lean();
  if (!term) throw new ApiError(404, 'Termo publicado nao encontrado');
  return term;
}

async function ensureDefaultTerms() {
  const summary = { created: 0, adopted: 0 };

  for (const definition of listDefaultLegalDocuments()) {
    const existing = await Term.exists({ type: definition.type });
    if (existing) {
      summary.adopted += 1;
      continue;
    }

    const now = new Date();
    try {
      await Term.create({
        ...clean(definition),
        version: INITIAL_LEGAL_VERSION,
        status: 'published',
        effectiveAt: now,
        publishedAt: now
      });
      summary.created += 1;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      summary.adopted += 1;
    }
  }

  return summary;
}

module.exports = {
  create,
  getById,
  list,
  update,
  remove,
  getPublished,
  automaticVersion,
  createDefaults,
  ensureDefaultTerms
};
