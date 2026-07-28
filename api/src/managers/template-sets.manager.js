const TemplateSet = require('../models/template-set.model');
const Template = require('../models/template.model');
const Invite = require('../models/invite.model');
const ApiError = require('../utils/api-error');
const { DELIVERY_CHANNELS } = require('../enums/channels');
const { parsePagination, pageResult } = require('../utils/pagination');
const logsManager = require('./logs.manager');

const TEMPLATE_SUMMARY_FIELDS = [
  'name',
  'description',
  'channel',
  'templateType',
  'active',
  'externalTemplateName',
  'languageCode',
  'systemManaged'
].join(' ');

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function referenceId(value) {
  return value?._id ? String(value._id) : value ? String(value) : null;
}

function normalizeTemplateIds(value = {}) {
  return Object.fromEntries(
    DELIVERY_CHANNELS
      .map((channel) => [channel, referenceId(value[channel])])
      .filter(([, id]) => Boolean(id))
  );
}

function templateSummary(template, channel, fallbackId) {
  if (!template) {
    return { id: String(fallbackId), channel, missing: true };
  }
  return {
    id: String(template._id),
    name: template.name,
    description: template.description || null,
    channel: template.channel,
    templateType: template.templateType,
    active: template.active !== false,
    externalTemplateName: template.externalTemplateName || null,
    languageCode: template.languageCode || null,
    systemManaged: template.systemManaged === true
  };
}

function inviteSummary(invite, fallbackId) {
  if (!fallbackId) return null;
  if (!invite) return { id: String(fallbackId), missing: true };
  return {
    id: String(invite._id),
    title: invite.title,
    slug: invite.slug,
    active: invite.active !== false
  };
}

function serialize(set, references = {}) {
  const value = set?.toObject ? set.toObject() : set;
  const templateIds = normalizeTemplateIds(value.templates);
  const templates = Object.fromEntries(
    Object.entries(templateIds).map(([channel, id]) => [
      channel,
      templateSummary(references.templates?.get(id), channel, id)
    ])
  );
  const inviteId = referenceId(value.invite);
  const missingReferences = [
    ...Object.values(templates).filter((template) => template.missing).map((template) => ({
      type: 'template',
      id: template.id,
      channel: template.channel
    })),
    ...(inviteId && !references.invites?.get(inviteId) ? [{ type: 'invite', id: inviteId }] : [])
  ];
  return {
    id: String(value._id),
    name: value.name,
    description: value.description || null,
    inviteId,
    invite: inviteSummary(references.invites?.get(inviteId), inviteId),
    templateIds,
    templates,
    templateCount: Object.keys(templateIds).length,
    integrity: {
      valid: missingReferences.length === 0,
      missingReferences
    },
    audit: {
      createdBy: referenceId(value.createdBy),
      updatedBy: referenceId(value.updatedBy)
    },
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  };
}

async function referenceMaps(sets = []) {
  const templateIds = [...new Set(sets.flatMap((set) => Object.values(normalizeTemplateIds(set.templates))))];
  const inviteIds = [...new Set(sets.map((set) => referenceId(set.invite)).filter(Boolean))];
  const [templates, invites] = await Promise.all([
    templateIds.length
      ? Template.find({ _id: { $in: templateIds } }).select(TEMPLATE_SUMMARY_FIELDS).lean()
      : [],
    inviteIds.length
      ? Invite.find({ _id: { $in: inviteIds } }).select('title slug active').lean()
      : []
  ]);
  return {
    templates: new Map(templates.map((template) => [String(template._id), template])),
    invites: new Map(invites.map((invite) => [String(invite._id), invite]))
  };
}

async function serializeMany(sets) {
  const references = await referenceMaps(sets);
  return sets.map((set) => serialize(set, references));
}

async function assertInvite(inviteId) {
  if (!inviteId) return null;
  const invite = await Invite.findById(inviteId).select('title slug active').lean();
  if (!invite) {
    throw new ApiError(
      422,
      'Convite vinculado ao conjunto nao existe',
      { inviteId: String(inviteId) },
      'TEMPLATE_SET_INVITE_NOT_FOUND'
    );
  }
  return invite;
}

async function assertTemplates(templateIds) {
  const normalized = normalizeTemplateIds(templateIds);
  const entries = Object.entries(normalized);
  if (!entries.length) {
    throw new ApiError(
      422,
      'O conjunto exige ao menos um template',
      null,
      'TEMPLATE_SET_EMPTY'
    );
  }
  const documents = await Template.find({ _id: { $in: entries.map(([, id]) => id) } }).lean();
  const byId = new Map(documents.map((template) => [String(template._id), template]));
  for (const [channel, id] of entries) {
    const template = byId.get(id);
    if (!template) {
      throw new ApiError(
        422,
        'Um template vinculado ao conjunto nao existe',
        { templateId: id, channel },
        'TEMPLATE_SET_TEMPLATE_NOT_FOUND'
      );
    }
    if (template.channel !== channel) {
      throw new ApiError(
        422,
        'O canal do template nao corresponde ao campo do conjunto',
        { templateId: id, expectedChannel: channel, actualChannel: template.channel },
        'TEMPLATE_SET_CHANNEL_MISMATCH'
      );
    }
    if (template.active === false) {
      throw new ApiError(
        422,
        'Template inativo nao pode ser vinculado ao conjunto',
        { templateId: id, channel },
        'TEMPLATE_SET_TEMPLATE_INACTIVE'
      );
    }
  }
  return {
    templateIds: normalized,
    templates: Object.fromEntries(entries.map(([channel, id]) => [channel, byId.get(id)]))
  };
}

async function audit(action, message, set, actorId, context = {}) {
  await logsManager.create({
    channel: 'global',
    action,
    message,
    actor: actorId,
    context: {
      templateSetId: String(set._id || set.id),
      ...context
    }
  }).catch(() => undefined);
}

async function create(input, actorId) {
  const [{ templateIds }, invite] = await Promise.all([
    assertTemplates(input.templateIds),
    assertInvite(input.inviteId)
  ]);
  const set = await TemplateSet.create({
    name: input.name,
    description: input.description || undefined,
    invite: invite?._id,
    templates: templateIds,
    createdBy: actorId,
    updatedBy: actorId
  });
  await audit('template_set.created', 'Conjunto de templates criado', set, actorId, {
    inviteId: referenceId(set.invite),
    templateIds
  });
  return getById(set._id);
}

async function getRawById(id) {
  const set = await TemplateSet.findById(id).lean();
  if (!set) throw new ApiError(404, 'Conjunto de templates nao encontrado', null, 'TEMPLATE_SET_NOT_FOUND');
  return set;
}

async function getById(id) {
  const set = await getRawById(id);
  return (await serializeMany([set]))[0];
}

async function list(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.inviteId) filter.invite = query.inviteId;
  if (query.templateId) {
    filter.$or = DELIVERY_CHANNELS.map((channel) => ({ [`templates.${channel}`]: query.templateId }));
  }
  if (query.search) {
    const expression = new RegExp(escapeRegex(query.search), 'i');
    const matchingInvites = await Invite.find({
      $or: [{ title: expression }, { slug: expression }]
    }).select('_id').limit(500).lean();
    const searchFilter = {
      $or: [
        { name: expression },
        { description: expression },
        { invite: { $in: matchingInvites.map((invite) => invite._id) } }
      ]
    };
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, searchFilter];
      delete filter.$or;
    } else {
      Object.assign(filter, searchFilter);
    }
  }
  const [sets, total] = await Promise.all([
    TemplateSet.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    TemplateSet.countDocuments(filter)
  ]);
  return pageResult(await serializeMany(sets), total, page, limit);
}

async function update(id, input, actorId) {
  const set = await TemplateSet.findById(id);
  if (!set) throw new ApiError(404, 'Conjunto de templates nao encontrado', null, 'TEMPLATE_SET_NOT_FOUND');
  const finalTemplateIds = input.templateIds === undefined
    ? normalizeTemplateIds(set.templates)
    : input.templateIds;
  const finalInviteId = input.inviteId === undefined ? referenceId(set.invite) : input.inviteId;
  const [{ templateIds }, invite] = await Promise.all([
    assertTemplates(finalTemplateIds),
    assertInvite(finalInviteId)
  ]);
  if (input.name !== undefined) set.name = input.name;
  if (input.description !== undefined) set.description = input.description || undefined;
  set.invite = invite?._id;
  set.templates = templateIds;
  set.updatedBy = actorId;
  await set.save();
  await audit('template_set.updated', 'Conjunto de templates atualizado', set, actorId, {
    changedFields: Object.keys(input).sort(),
    inviteId: referenceId(set.invite),
    templateIds
  });
  return getById(set._id);
}

async function remove(id, actorId) {
  const set = await TemplateSet.findByIdAndDelete(id).lean();
  if (!set) throw new ApiError(404, 'Conjunto de templates nao encontrado', null, 'TEMPLATE_SET_NOT_FOUND');
  await audit('template_set.deleted', 'Conjunto de templates removido', set, actorId, {
    inviteId: referenceId(set.invite),
    templateIds: normalizeTemplateIds(set.templates)
  });
  return { id: String(set._id), removed: true };
}

async function resolveForNotification(id) {
  const set = await getRawById(id);
  const { templateIds, templates } = await assertTemplates(set.templates);
  if (set.invite) await assertInvite(set.invite);
  return {
    templateSet: set,
    templateIds,
    templates
  };
}

module.exports = {
  create,
  getById,
  list,
  update,
  remove,
  resolveForNotification,
  assertTemplates,
  serializeTemplateSet: serialize,
  normalizeTemplateIds
};
