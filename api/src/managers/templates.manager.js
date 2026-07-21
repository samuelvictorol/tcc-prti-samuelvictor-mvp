const sanitizeHtml = require('sanitize-html');
const Template = require('../models/template.model');
const ApiError = require('../utils/api-error');
const { parsePagination, pageResult } = require('../utils/pagination');
const { normalizeOfficialTemplateDefinition } = require('../utils/whatsapp-cloud-templates');

function clean(input) {
  const output = { ...input };
  const cleanHtml = (html) => sanitizeHtml(html, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
      allowedAttributes: { '*': ['class', 'style'], a: ['href', 'target', 'rel'], img: ['src', 'alt', 'width', 'height'] },
      allowedSchemes: ['http', 'https', 'mailto', 'cid'],
      allowedStyles: {
        '*': {
          color: [/^(?:#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]+)$/i],
          'background-color': [/^(?:#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]+)$/i],
          'font-family': [/^[a-z0-9\s,'"-]+$/i],
          'font-size': [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/i],
          'font-weight': [/^(?:normal|bold|[1-9]00)$/i],
          'line-height': [/^\d+(?:\.\d+)?(?:px|em|rem|%)?$/i],
          'text-align': [/^(?:left|right|center|justify)$/i],
          display: [/^(?:none|block|inline|inline-block|table|table-row|table-cell)$/i],
          width: [/^(?:auto|\d+(?:\.\d+)?(?:px|em|rem|%))$/i],
          'max-width': [/^(?:none|\d+(?:\.\d+)?(?:px|em|rem|%))$/i],
          height: [/^(?:auto|\d+(?:\.\d+)?(?:px|em|rem|%))$/i],
          margin: [/^[\d\s.%-]+(?:px|em|rem|%)?$/i],
          padding: [/^[\d\s.%-]+(?:px|em|rem|%)?$/i],
          border: [/^[\d\s.#a-z()-]+$/i],
          'border-radius': [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/i]
        }
      }
    });
  if (input.html !== undefined && input.html !== null) output.html = cleanHtml(input.html);
  if (input.variants && typeof input.variants === 'object') {
    output.variants = Object.fromEntries(Object.entries(input.variants).map(([channel, variant]) => {
      if (!variant || typeof variant !== 'object' || Array.isArray(variant)) return [channel, variant];
      return [channel, { ...variant, html: variant.html ? cleanHtml(variant.html) : variant.html }];
    }));
  }
  return output;
}

function validateTemplate(input) {
  if (input.channel === 'email' && !input.body && !input.html) throw new ApiError(422, 'Template de email exige body ou html');
  if (input.channel === 'global' && (!input.variants || typeof input.variants !== 'object')) throw new ApiError(422, 'Template global exige variants por canal');
  if (input.channel === 'whatsapp_cloud' && !input.whatsappCloudPreset) {
    throw new ApiError(
      422,
      'Selecione um dos tres modelos oficiais disponiveis para WhatsApp Cloud',
      { allowedPresets: ['order_confirmation', 'plain_text', 'hello_world'] },
      'WHATSAPP_TEMPLATE_PRESET_REQUIRED'
    );
  }
}

function normalize(input) {
  if (input.channel === 'whatsapp_cloud') {
    const normalized = normalizeOfficialTemplateDefinition(input);
    return { ...normalized, templateType: normalized.templateType || 'approved_template' };
  }
  return { ...input, templateType: input.templateType || 'text' };
}

async function create(input, actorId) {
  const normalized = normalize(input);
  validateTemplate(normalized);
  return Template.create({ ...clean(normalized), createdBy: actorId, updatedBy: actorId });
}

async function getById(id) {
  const template = await Template.findById(id).lean();
  if (!template) throw new ApiError(404, 'Template nao encontrado');
  return template;
}

async function list(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.channel) filter.channel = query.channel;
  if (query.active !== undefined) filter.active = query.active;
  if (query.search) filter.name = { $regex: String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const [items, total] = await Promise.all([
    Template.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    Template.countDocuments(filter)
  ]);
  return pageResult(items, total, page, limit);
}

async function update(id, input, actorId) {
  const existing = await getById(id);
  const merged = { ...existing, ...input };
  if (input.whatsappCloudPreset && input.whatsappCloudPreset !== existing.whatsappCloudPreset && input.body === undefined) {
    merged.body = undefined;
  }
  const normalized = normalize(merged);
  validateTemplate(normalized);
  const changed = Object.fromEntries(Object.keys(input).map((key) => [key, normalized[key]]));
  for (const derivedKey of ['templateType', 'whatsappCloudPreset', 'externalTemplateName', 'languageCode', 'body', 'payload']) {
    if (normalized[derivedKey] !== existing[derivedKey]) changed[derivedKey] = normalized[derivedKey];
  }
  const template = await Template.findByIdAndUpdate(id, { $set: { ...clean(changed), updatedBy: actorId } }, { new: true, runValidators: true }).lean();
  return template;
}

async function remove(id) {
  const result = await Template.deleteOne({ _id: id });
  if (!result.deletedCount) throw new ApiError(404, 'Template nao encontrado');
  return { id: String(id), removed: true };
}

module.exports = {
  create,
  getById,
  list,
  update,
  remove,
  normalizeTemplateInput: normalize,
  validateTemplateInput: validateTemplate
};
