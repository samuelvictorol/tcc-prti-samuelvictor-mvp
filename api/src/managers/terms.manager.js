const Term = require('../models/term.model');
const sanitizeHtml = require('sanitize-html');
const { parsePagination, pageResult } = require('../utils/pagination');
const ApiError = require('../utils/api-error');

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

async function create(input, actorId) {
  try {
    const term = await Term.create({ ...clean(input), createdBy: actorId, updatedBy: actorId, publishedAt: input.status === 'published' ? new Date() : undefined, effectiveAt: input.effectiveAt || (input.status === 'published' ? new Date() : undefined) });
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

module.exports = { create, getById, list, update, remove, getPublished };
