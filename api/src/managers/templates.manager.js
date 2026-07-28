const sanitizeHtml = require('sanitize-html');
const Template = require('../models/template.model');
const ApiError = require('../utils/api-error');
const { parsePagination, pageResult } = require('../utils/pagination');
const { normalizeOfficialTemplateDefinition } = require('../utils/whatsapp-cloud-templates');
const { listSystemTemplateDefinitions, isSystemTemplate } = require('../utils/system-templates');
const { telegramTemplateDefinition } = require('../dtos/templates.dto');
const { telegramDefinitionFromTemplate, telegramTemplateBody, extractVariables } = require('../utils/telegram-templates');

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
  if (input.channel !== 'email' && input.html) throw new ApiError(422, 'Somente templates de email aceitam HTML', null, 'HTML_EMAIL_ONLY');
  if (input.channel === 'global' && (!input.variants || typeof input.variants !== 'object')) throw new ApiError(422, 'Template global exige variants por canal');
  if (input.channel === 'global') {
    for (const [channel, variant] of Object.entries(input.variants || {})) {
      if (channel !== 'email' && variant?.html) throw new ApiError(422, 'Somente a variante de email aceita HTML', { channel }, 'HTML_EMAIL_ONLY');
    }
  }
  if (input.channel === 'telegram') {
    const keys = Object.keys(input.payload || {});
    if (keys.some((key) => key !== 'telegram')) throw new ApiError(422, 'Template Telegram aceita somente a definicao amigavel do canal', null, 'TELEGRAM_PAYLOAD_INVALID');
    const parsed = telegramTemplateDefinition.safeParse(input.payload?.telegram);
    if (!parsed.success) {
      throw new ApiError(422, 'Template Telegram invalido', {
        fields: parsed.error.issues.slice(0, 20).map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
      }, 'TELEGRAM_TEMPLATE_INVALID');
    }
  }
  if (input.channel === 'whatsapp_cloud' && !input.whatsappCloudPreset) {
    throw new ApiError(
      422,
      'Selecione um preset ou informe um template oficial personalizado',
      { allowedPresets: ['order_confirmation', 'plain_text', 'hello_world', 'custom'] },
      'WHATSAPP_TEMPLATE_PRESET_REQUIRED'
    );
  }
}

function normalize(input) {
  if (input.channel === 'whatsapp_cloud') {
    const normalized = normalizeOfficialTemplateDefinition(input);
    return { ...normalized, templateType: normalized.templateType || 'approved_template' };
  }
  if (input.channel === 'telegram') {
    const definition = telegramDefinitionFromTemplate(input);
    const parsed = telegramTemplateDefinition.safeParse(definition);
    const normalizedDefinition = parsed.success ? parsed.data : definition;
    return {
      ...input,
      subject: null,
      html: null,
      templateType: 'telegram_' + String(normalizedDefinition.kind || 'text'),
      body: telegramTemplateBody(normalizedDefinition),
      payload: { telegram: normalizedDefinition },
      variables: [...new Set([...(input.variables || []), ...extractVariables(normalizedDefinition)])]
    };
  }
  return { ...input, templateType: input.templateType || 'text' };
}

function serialize(template) {
  const value = typeof template?.toObject === 'function' ? template.toObject() : { ...template };
  const systemManaged = isSystemTemplate(value);
  return {
    ...value,
    systemManaged,
    deletable: !systemManaged
  };
}

function systemTemplateFilter(definition) {
  return {
    $or: [
      { systemKey: definition.systemKey },
      {
        channel: definition.channel,
        externalTemplateName: definition.externalTemplateName
      }
    ]
  };
}

async function markSystemTemplate(existing, definition) {
  if (existing.systemManaged === true && existing.systemKey === definition.systemKey) return false;
  await Template.updateOne(
    { _id: existing._id },
    { $set: { systemKey: definition.systemKey, systemManaged: true } }
  );
  return true;
}

async function ensureSystemTemplates() {
  const summary = { created: 0, protected: 0, existing: 0 };
  for (const definition of listSystemTemplateDefinitions()) {
    const filter = systemTemplateFilter(definition);
    let existing = await Template.findOne(filter).lean();
    if (existing) {
      if (await markSystemTemplate(existing, definition)) summary.protected += 1;
      else summary.existing += 1;
      continue;
    }
    const normalized = normalize(definition);
    validateTemplate(normalized);
    try {
      await Template.create({ ...clean(normalized), systemKey: definition.systemKey, systemManaged: true });
      summary.created += 1;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      existing = await Template.findOne(filter).lean();
      if (!existing) throw error;
      if (await markSystemTemplate(existing, definition)) summary.protected += 1;
      else summary.existing += 1;
    }
  }
  return summary;
}

function assertSystemIdentityUnchanged(existing, input) {
  if (!isSystemTemplate(existing)) return;
  const identityFields = ['channel', 'templateType', 'whatsappCloudPreset', 'externalTemplateName', 'languageCode'];
  const changedFields = identityFields.filter((field) => (
    input[field] !== undefined && String(input[field] ?? '') !== String(existing[field] ?? '')
  ));
  if (changedFields.length) {
    throw new ApiError(
      409,
      'A identidade de um template padrao do sistema nao pode ser alterada',
      { fields: changedFields },
      'SYSTEM_TEMPLATE_IDENTITY_IMMUTABLE'
    );
  }
}

async function create(input, actorId) {
  const normalized = normalize(input);
  validateTemplate(normalized);
  return serialize(await Template.create({ ...clean(normalized), createdBy: actorId, updatedBy: actorId }));
}

async function getById(id) {
  const template = await Template.findById(id).lean();
  if (!template) throw new ApiError(404, 'Template nao encontrado');
  return serialize(template);
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
  return pageResult(items.map(serialize), total, page, limit);
}

async function update(id, input, actorId) {
  const existing = await getById(id);
  assertSystemIdentityUnchanged(existing, input);
  const merged = { ...existing, ...input };
  if (input.whatsappCloudPreset && input.whatsappCloudPreset !== existing.whatsappCloudPreset && input.body === undefined) {
    merged.body = undefined;
  }
  const normalized = normalize(merged);
  validateTemplate(normalized);
  const changed = Object.fromEntries(Object.keys(input).map((key) => [key, normalized[key]]));
  for (const derivedKey of ['templateType', 'whatsappCloudPreset', 'externalTemplateName', 'languageCode', 'body', 'html', 'subject', 'payload', 'variables']) {
    if (normalized[derivedKey] !== existing[derivedKey]) changed[derivedKey] = normalized[derivedKey];
  }
  const template = await Template.findByIdAndUpdate(id, { $set: { ...clean(changed), updatedBy: actorId } }, { new: true, runValidators: true }).lean();
  return serialize(template);
}

async function remove(id) {
  const existing = await getById(id);
  if (isSystemTemplate(existing)) {
    throw new ApiError(
      409,
      'Templates padrao do sistema nao podem ser removidos',
      { templateId: String(id), externalTemplateName: existing.externalTemplateName },
      'SYSTEM_TEMPLATE_DELETE_FORBIDDEN'
    );
  }
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
  validateTemplateInput: validateTemplate,
  ensureSystemTemplates,
  serializeTemplate: serialize,
  isSystemTemplate
};
