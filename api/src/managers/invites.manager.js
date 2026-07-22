const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const Invite = require('../models/invite.model');
const InviteClick = require('../models/invite-click.model');
const Contact = require('../models/contact.model');
const { env } = require('../config/env');
const { searchHash, tokenHash } = require('../services/crypto.service');
const { parsePagination, pageResult } = require('../utils/pagination');
const ApiError = require('../utils/api-error');
const { isAllowedInviteUrl, isSafePublicHttpsUrl } = require('../utils/urls');
const settingsManager = require('./settings.manager');

const MAX_SLUG_ATTEMPTS = 200;

function slugBaseFromTitle(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 88)
    .replace(/-+$/g, '');
  return normalized.length >= 3 ? normalized : 'convite-' + (normalized || 'publico');
}

function slugCandidate(base, attempt) {
  if (attempt === 1) return base;
  const suffix = '-' + attempt;
  return base.slice(0, 100 - suffix.length).replace(/-+$/g, '') + suffix;
}

function isDuplicateSlug(error) {
  return error?.code === 11000 && (!error.keyPattern || error.keyPattern.slug || error.keyValue?.slug);
}

function telegramStartPayload(command) {
  const normalized = String(command || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || 'notify-me';
}

function telegramInviteRedirectUrl(value, permissionCommand) {
  try {
    const url = new URL(String(value || ''));
    if (!['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'].includes(url.hostname.toLowerCase())) return value;
    if (url.searchParams.get('start')) return url.toString();
    const legacyText = url.searchParams.get('text');
    if (!legacyText && [...url.searchParams.keys()].length) return value;
    url.search = '';
    url.searchParams.set('start', telegramStartPayload(legacyText || permissionCommand));
    return url.toString();
  } catch (_error) {
    return value;
  }
}

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
  const base = slugBaseFromTitle(input.title);
  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
    try {
      const invite = await Invite.create({ ...input, slug: slugCandidate(base, attempt), createdBy: actorId });
      return serialize(invite, true);
    } catch (error) {
      if (!isDuplicateSlug(error)) throw error;
    }
  }
  throw new ApiError(409, 'Nao foi possivel gerar um slug unico para este convite', null, 'INVITE_SLUG_EXHAUSTED');
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
  const existing = await Invite.findById(id).select('title');
  if (!existing) throw new ApiError(404, 'Convite nao encontrado');
  if (input.title === undefined || input.title === existing.title) {
    const invite = await Invite.findByIdAndUpdate(id, { $set: input }, { new: true, runValidators: true });
    if (!invite) throw new ApiError(404, 'Convite nao encontrado');
    return serialize(invite, true);
  }
  const base = slugBaseFromTitle(input.title);
  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
    try {
      const invite = await Invite.findByIdAndUpdate(id, {
        $set: { ...input, slug: slugCandidate(base, attempt) }
      }, { new: true, runValidators: true });
      if (!invite) throw new ApiError(404, 'Convite nao encontrado');
      return serialize(invite, true);
    } catch (error) {
      if (!isDuplicateSlug(error)) throw error;
    }
  }
  throw new ApiError(409, 'Nao foi possivel gerar um slug unico para este convite', null, 'INVITE_SLUG_EXHAUSTED');
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
    iconeUrl: isSafePublicHttpsUrl(invite.iconeUrl) ? invite.iconeUrl : null,
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
  const redirectUrl = link.channel === 'telegram'
    ? telegramInviteRedirectUrl(link.url, await settingsManager.getWhatsappPermissionCommand())
    : link.url;
  if (!isAllowedInviteUrl(redirectUrl)) throw new ApiError(400, 'Protocolo de link de convite nao permitido', null, 'UNSAFE_INVITE_URL');
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
  return { redirectUrl, channel: link.channel, attributed: Boolean(contactId) };
}

module.exports = {
  create, getById, list, update, remove, getPublic, track,
  slugBaseFromTitle, slugCandidate, telegramStartPayload, telegramInviteRedirectUrl
};
