const ContactGroup = require('../models/contact-group.model');
const Contact = require('../models/contact.model');
const mongoose = require('mongoose');
const ApiError = require('../utils/api-error');
const { encrypt, decrypt, searchHash } = require('../services/crypto.service');
const { normalizeSearch } = require('../utils/normalizers');
const { parsePagination, pageResult } = require('../utils/pagination');

const SECRET_SELECT = '+nameEncrypted +descriptionEncrypted +externalIdEncrypted +inviteLinkEncrypted +imageUrlEncrypted';

function serialize(group) {
  const value = group?.toObject ? group.toObject() : group;
  if (!value) return null;
  return {
    id: String(value._id),
    name: decrypt(value.nameEncrypted),
    description: decrypt(value.descriptionEncrypted),
    source: value.source,
    externalId: decrypt(value.externalIdEncrypted),
    chatId: value.source === 'telegram' ? decrypt(value.externalIdEncrypted) : undefined,
    inviteLink: decrypt(value.inviteLinkEncrypted),
    imageUrl: decrypt(value.imageUrlEncrypted),
    contacts: (value.contacts || []).map((item) => typeof item === 'object' && item._id ? String(item._id) : String(item)),
    contactCount: (value.contacts || []).length,
    active: value.active,
    notificationDisabled: value.notificationDisabled,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  };
}

async function assertContacts(ids = []) {
  const unique = [...new Set(ids.map(String))];
  if (!unique.length) return unique;
  const count = await Contact.countDocuments({ _id: { $in: unique }, active: true, deletedAt: null });
  if (count !== unique.length) throw new ApiError(422, 'Um ou mais contatos sao invalidos ou inativos');
  return unique;
}

function assign(group, input, creating = false) {
  if (creating || input.name !== undefined) {
    const name = String(input.name || '').trim();
    group.nameEncrypted = encrypt(name);
    group.nameHash = searchHash(normalizeSearch(name));
  }
  if (creating || input.description !== undefined) group.descriptionEncrypted = encrypt(input.description || null);
  if (input.source !== undefined) group.source = input.source;
  if (creating || input.externalId !== undefined) {
    group.externalIdEncrypted = encrypt(input.externalId || null);
    group.externalIdHash = searchHash(input.externalId || null);
  }
  if (creating || input.inviteLink !== undefined) group.inviteLinkEncrypted = encrypt(input.inviteLink || null);
  if (creating || input.imageUrl !== undefined) group.imageUrlEncrypted = encrypt(input.imageUrl || null);
  if (input.active !== undefined) group.active = input.active;
  if (input.notificationDisabled !== undefined) group.notificationDisabled = input.notificationDisabled;
}

async function create(input, options = {}) {
  if (!options.providerManaged && input.source && input.source !== 'manual') {
    throw new ApiError(403, 'Origem externa so pode ser definida pelo adaptador do canal');
  }
  const values = {};
  assign(values, input, true);
  values.contacts = await assertContacts(input.contactIds || []);
  try {
    const group = await ContactGroup.create(values);
    return getById(group._id);
  } catch (error) {
    if (error.code === 11000) throw new ApiError(409, 'Grupo externo ja cadastrado');
    throw error;
  }
}

async function getRawById(id) {
  const group = await ContactGroup.findById(id).select(SECRET_SELECT);
  if (!group) throw new ApiError(404, 'Grupo nao encontrado');
  return group;
}

async function getById(id) {
  return serialize(await getRawById(id));
}

async function list(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.source) filter.source = query.source;
  if (query.search) filter.nameHash = searchHash(normalizeSearch(query.search));
  const [items, total] = await Promise.all([
    ContactGroup.find(filter).select(SECRET_SELECT).sort({ updatedAt: -1 }).skip(skip).limit(limit),
    ContactGroup.countDocuments(filter)
  ]);
  return pageResult(items.map(serialize), total, page, limit);
}

async function update(id, input, options = {}) {
  const group = await getRawById(id);
  if (!options.providerManaged && input.source && input.source !== group.source) throw new ApiError(403, 'Origem do grupo nao pode ser alterada manualmente');
  if (!options.providerManaged && group.source !== 'manual' && (input.source !== undefined || input.externalId !== undefined)) {
    throw new ApiError(403, 'Origem e identificador externo sao gerenciados pelo adaptador do canal', null, 'PROVIDER_GROUP_MANAGED');
  }
  assign(group, input, false);
  if (input.contactIds !== undefined) group.contacts = await assertContacts(input.contactIds);
  await group.save();
  return getById(id);
}

async function remove(id) {
  const result = await ContactGroup.deleteOne({ _id: id });
  if (!result.deletedCount) throw new ApiError(404, 'Grupo nao encontrado');
  return { id: String(id), removed: true, contactsPreserved: true, notificationsStopped: true };
}

async function upsertExternal({ name, source, externalId, imageUrl, inviteLink }) {
  const externalIdHash = searchHash(externalId);
  let group = await ContactGroup.findOne({ source, externalIdHash }).select(SECRET_SELECT);
  if (!group) return create({ name, source, externalId, imageUrl, inviteLink, contactIds: [] }, { providerManaged: true });
  assign(group, { name, imageUrl, inviteLink }, false);
  await group.save();
  return serialize(group);
}

async function expandContactIds(groupIds = [], options = {}) {
  if (!groupIds.length) return [];
  const maxUnique = Number(options.maxUnique);
  if (Number.isSafeInteger(maxUnique) && maxUnique > 0) {
    const ids = groupIds.map((id) => id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id)));
    const contacts = await ContactGroup.aggregate([
      { $match: { _id: { $in: ids }, active: true, notificationDisabled: false } },
      { $unwind: '$contacts' },
      { $group: { _id: '$contacts' } },
      { $limit: maxUnique }
    ]);
    return contacts.map((item) => String(item._id));
  }
  const groups = await ContactGroup.find({ _id: { $in: groupIds }, active: true, notificationDisabled: false }).select('contacts').lean();
  return [...new Set(groups.flatMap((group) => group.contacts.map(String)))];
}

async function addContacts(id, contactIds = []) {
  const unique = await assertContacts(contactIds);
  const group = await ContactGroup.findByIdAndUpdate(id, { $addToSet: { contacts: { $each: unique } } }, { new: true }).select(SECRET_SELECT);
  if (!group) throw new ApiError(404, 'Grupo nao encontrado');
  return serialize(group);
}

async function findByExternalId(source, externalId) {
  const group = await ContactGroup.findOne({
    source,
    externalIdHash: searchHash(externalId),
    active: true,
    notificationDisabled: false
  }).select(SECRET_SELECT);
  return group ? serialize(group) : null;
}

async function setExternalActive(source, externalId, active) {
  const group = await ContactGroup.findOne({ source, externalIdHash: searchHash(externalId) }).select(SECRET_SELECT);
  if (!group) return null;
  group.active = active;
  group.notificationDisabled = !active;
  await group.save();
  return serialize(group);
}

module.exports = { create, getById, getRawById, list, update, remove, upsertExternal, expandContactIds, addContacts, findByExternalId, setExternalActive, serialize };
