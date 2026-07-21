const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const Invite = require('../models/invite.model');
const InviteClick = require('../models/invite-click.model');
const Contact = require('../models/contact.model');
const { env } = require('../config/env');
const { searchHash, tokenHash } = require('../services/crypto.service');
const { parsePagination, pageResult } = require('../utils/pagination');
const ApiError = require('../utils/api-error');
const { isAllowedInviteUrl } = require('../utils/urls');

function recipientToken(invite) {
  if (!invite.recipientContact) return null;
  return jwt.sign({ inviteId: String(invite._id), contactId: String(invite.recipientContact), type: 'invite' }, env.inviteTokenSecret, { expiresIn: '90d', issuer: 'notify-app-api' });
}

function serialize(invite, includeToken = false) {
  const value = invite?.toObject ? invite.toObject() : invite;
  const token = includeToken ? recipientToken(value) : null;
  const base = env.publicAppUrl.replace(/\/$/, '') + '/invite/' + value.slug;
  return { ...value, id: String(value._id), publicUrl: token ? base + '?token=' + encodeURIComponent(token) : base, recipientToken: token || undefined };
}

async function create(input, actorId) {
  try {
    const invite = await Invite.create({ ...input, createdBy: actorId });
    return serialize(invite, true);
  } catch (error) {
    if (error.code === 11000) throw new ApiError(409, 'Slug de convite ja utilizado');
    throw error;
  }
}

async function getById(id) {
  const invite = await Invite.findById(id);
  if (!invite) throw new ApiError(404, 'Convite nao encontrado');
  return serialize(invite, true);
}

async function list(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.active !== undefined) filter.active = query.active;
  const [items, total] = await Promise.all([
    Invite.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit),
    Invite.countDocuments(filter)
  ]);
  return pageResult(items.map((item) => serialize(item, true)), total, page, limit);
}

async function update(id, input) {
  try {
    const invite = await Invite.findByIdAndUpdate(id, { $set: input }, { new: true, runValidators: true });
    if (!invite) throw new ApiError(404, 'Convite nao encontrado');
    return serialize(invite, true);
  } catch (error) {
    if (error.code === 11000) throw new ApiError(409, 'Slug de convite ja utilizado');
    throw error;
  }
}

async function remove(id) {
  const result = await Invite.deleteOne({ _id: id });
  if (!result.deletedCount) throw new ApiError(404, 'Convite nao encontrado');
  await InviteClick.deleteMany({ invite: id });
  return { id: String(id), removed: true };
}

function parseRecipientToken(token, inviteId) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, env.inviteTokenSecret, { issuer: 'notify-app-api' });
    return decoded.type === 'invite' && decoded.inviteId === String(inviteId) ? decoded.contactId : null;
  } catch (_error) {
    return null;
  }
}

async function getPublic(slug, token) {
  const invite = await Invite.findOne({ slug: String(slug).toLowerCase(), active: true }).lean();
  if (!invite) throw new ApiError(404, 'Convite nao encontrado');
  const parsedContactId = parseRecipientToken(token, invite._id);
  const contactId = parsedContactId && String(invite.recipientContact || '') === String(parsedContactId)
    ? parsedContactId
    : null;
  return {
    slug: invite.slug,
    title: invite.title,
    description: invite.description,
    gradientStart: invite.gradientStart,
    gradientEnd: invite.gradientEnd,
    personalized: Boolean(contactId),
    links: invite.links.filter((link) => link.active).map((link) => ({
      id: String(link._id), label: link.label, channel: link.channel,
      trackingUrl: env.apiPrefix + '/public/invites/' + invite.slug + '/links/' + link._id + (token ? '?token=' + encodeURIComponent(token) : '')
    }))
  };
}

async function track(slug, linkId, token, meta = {}) {
  const invite = await Invite.findOne({ slug: String(slug).toLowerCase(), active: true });
  if (!invite) throw new ApiError(404, 'Convite nao encontrado');
  const link = invite.links.id(linkId);
  if (!link || !link.active) throw new ApiError(404, 'Link de convite nao encontrado');
  if (!isAllowedInviteUrl(link.url)) throw new ApiError(400, 'Protocolo de link de convite nao permitido', null, 'UNSAFE_INVITE_URL');
  const parsedContactId = parseRecipientToken(token, invite._id);
  let contactId = parsedContactId && String(invite.recipientContact || '') === String(parsedContactId)
    ? parsedContactId
    : null;
  if (contactId && !await Contact.exists({ _id: contactId, active: true, deletedAt: null })) contactId = null;
  const anonymousToken = token || crypto.randomUUID();
  await InviteClick.create({
    invite: invite._id, linkId: link._id, contact: contactId || undefined,
    anonymousTokenHash: tokenHash(anonymousToken),
    ipHash: meta.ip ? searchHash(meta.ip) : undefined,
    userAgentHash: meta.userAgent ? searchHash(meta.userAgent) : undefined
  });
  invite.clickCount += 1;
  await invite.save();
  if (contactId) await Contact.updateOne({ _id: contactId }, { $set: { inviteClickedAt: new Date() } });
  return { redirectUrl: link.url, channel: link.channel, attributed: Boolean(contactId) };
}

module.exports = { create, getById, list, update, remove, getPublic, track };
