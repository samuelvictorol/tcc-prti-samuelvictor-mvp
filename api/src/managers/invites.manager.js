const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const Invite = require('../models/invite.model');
const TemplateSet = require('../models/template-set.model');
const InviteClick = require('../models/invite-click.model');
const Contact = require('../models/contact.model');
const { env } = require('../config/env');
const { searchHash, tokenHash } = require('../services/crypto.service');
const { parsePagination, pageResult } = require('../utils/pagination');
const ApiError = require('../utils/api-error');
const { isAllowedInviteUrl, isSafePublicHttpsUrl } = require('../utils/urls');
const settingsManager = require('./settings.manager');
const contactsManager = require('./contacts.manager');
const groupsManager = require('./groups.manager');

const MAX_SLUG_ATTEMPTS = 200;
const ATTRIBUTION_NONCE_BYTES = 4;
const ATTRIBUTION_SIGNATURE_BYTES = 8;
const ATTRIBUTION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const LEGACY_ATTRIBUTION_MARKER_PATTERN = /^ni_([a-f\d]{24})_([A-Za-z0-9_-]{11})_([A-Za-z0-9_-]{16})$/;
const ATTRIBUTION_MARKER_PATTERN = /^([a-z0-9][a-z0-9-]{1,11})_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{6})_([A-Za-z0-9_-]{11})$/;

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

function attributionSignature(inviteId, nonce, slugPrefix = '') {
  return crypto.createHmac('sha256', env.inviteTokenSecret)
    .update(`invite-attribution:v2:${slugPrefix}:${String(inviteId).toLowerCase()}:${nonce}`)
    .digest()
    .subarray(0, ATTRIBUTION_SIGNATURE_BYTES)
    .toString('base64url');
}

function legacyAttributionSignature(inviteId, nonce) {
  return crypto.createHmac('sha256', env.inviteTokenSecret)
    .update(String(inviteId).toLowerCase() + '.' + nonce)
    .digest()
    .subarray(0, 12)
    .toString('base64url');
}

function compactInviteId(inviteId) {
  return Buffer.from(String(inviteId), 'hex').toString('base64url');
}

function expandInviteId(compactId) {
  const value = Buffer.from(compactId, 'base64url');
  return value.length === 12 ? value.toString('hex') : null;
}

function attributionSlugPrefix(slug) {
  return slugBaseFromTitle(slug || 'convite').slice(0, 12).replace(/-+$/g, '') || 'convite';
}

function createAttributionMarker(inviteId, slug = 'convite', suppliedNonce) {
  const normalizedId = String(inviteId || '').toLowerCase();
  const slugPrefix = attributionSlugPrefix(slug);
  const nonce = suppliedNonce
    || crypto.randomBytes(ATTRIBUTION_NONCE_BYTES).toString('base64url');
  if (!/^[a-f\d]{24}$/.test(normalizedId) || !/^[A-Za-z0-9_-]{6}$/.test(nonce)) {
    throw new ApiError(422, 'Convite invalido para atribuicao', null, 'INVITE_ATTRIBUTION_INVALID');
  }
  return `${slugPrefix}_${compactInviteId(normalizedId)}_${nonce}_${attributionSignature(normalizedId, nonce, slugPrefix)}`;
}

function parseAttributionMarker(value) {
  const marker = String(value || '').trim();
  const legacy = marker.match(LEGACY_ATTRIBUTION_MARKER_PATTERN);
  if (legacy) {
    const [, inviteId, nonce, signature] = legacy;
    const expected = legacyAttributionSignature(inviteId, nonce);
    const providedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (providedBuffer.length !== expectedBuffer.length
      || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) return null;
    return { marker, inviteId, version: 1 };
  }
  const match = marker.match(ATTRIBUTION_MARKER_PATTERN);
  if (!match) return null;
  const [, slugPrefix, compactId, nonce, signature] = match;
  const inviteId = expandInviteId(compactId);
  if (!inviteId) return null;
  const expected = attributionSignature(inviteId, nonce, slugPrefix);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) return null;
  return { marker, inviteId, slugPrefix, version: 2 };
}

function telegramInviteRedirectUrlWithAttribution(value, permissionCommand, attributionMarker) {
  if (!attributionMarker) return telegramInviteRedirectUrl(value, permissionCommand);
  try {
    const url = new URL(String(value || ''));
    if (!['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'].includes(url.hostname.toLowerCase())) return value;
    // Links com start customizado pertencem ao administrador e permanecem
    // intactos. Payloads gerados pelo proprio app (o comando atual e o
    // legado notify-me) podem ser trocados pelo marcador rastreavel.
    const existingStart = url.searchParams.get('start');
    const managedStartPayloads = new Set([
      telegramStartPayload(permissionCommand).toLocaleLowerCase('pt-BR'),
      telegramStartPayload('/notify-me').toLocaleLowerCase('pt-BR')
    ]);
    if (existingStart && !managedStartPayloads.has(existingStart.toLocaleLowerCase('pt-BR'))) {
      return url.toString();
    }
    const legacyText = url.searchParams.get('text');
    const managedLegacyTexts = new Set([
      settingsManager.normalizeWhatsappPermissionText(permissionCommand),
      settingsManager.normalizeWhatsappPermissionText('/notify-me')
    ]);
    if (legacyText && !managedLegacyTexts.has(
      settingsManager.normalizeWhatsappPermissionText(legacyText)
    )) return value;
    url.search = '';
    url.searchParams.set('start', attributionMarker);
    return url.toString();
  } catch (_error) {
    return value;
  }
}

function whatsappInviteRedirectUrl(value, permissionCommand, attributionMarker) {
  if (!attributionMarker) return value;
  try {
    const url = new URL(String(value || ''));
    const hostname = url.hostname.toLowerCase();
    const supportedHttps = ['wa.me', 'www.wa.me', 'api.whatsapp.com', 'web.whatsapp.com'].includes(hostname);
    if (!(supportedHttps || url.protocol === 'whatsapp:')) return value;
    const existingText = url.searchParams.get('text');
    const managedTexts = new Set([
      settingsManager.normalizeWhatsappPermissionText(permissionCommand),
      settingsManager.normalizeWhatsappPermissionText('/notify-me')
    ]);
    if (existingText && !managedTexts.has(
      settingsManager.normalizeWhatsappPermissionText(existingText)
    )) return value;
    url.searchParams.set('text', `${String(permissionCommand || '').trim()} ${attributionMarker}`.trim());
    return url.toString();
  } catch (_error) {
    return value;
  }
}

async function resolveAttributionMarker(value) {
  const parsed = parseAttributionMarker(value);
  if (!parsed) return null;
  const clickedAfter = new Date(Date.now() - ATTRIBUTION_MAX_AGE_MS);
  const click = await InviteClick.findOne({
    invite: parsed.inviteId,
    attributionMarkerHash: tokenHash(parsed.marker),
    clickedAt: { $gte: clickedAfter }
  }).lean();
  if (!click) return null;
  const invite = await Invite.findOne({ _id: parsed.inviteId, active: true }).lean();
  if (!invite) return null;
  return { invite, click };
}

async function resolveWhatsappInviteInvocation(text, permissionCommand) {
  const parts = String(text || '').normalize('NFKC').trim().split(/\s+/);
  if (parts.length < 2) return null;
  const marker = parts.pop();
  if (!parseAttributionMarker(marker)) return null;
  const commandText = parts.join(' ');
  if (settingsManager.normalizeWhatsappPermissionText(commandText)
    !== settingsManager.normalizeWhatsappPermissionText(permissionCommand)) return null;
  const attribution = await resolveAttributionMarker(marker);
  return attribution ? {
    ...attribution,
    attributionMarker: marker,
    command: permissionCommand,
    source: 'public_invite_link'
  } : null;
}

async function resolveTelegramInviteInvocation(text) {
  const match = String(text || '').normalize('NFKC').trim()
    .match(/^\/start(?:@[a-z0-9_]{3,32})?\s+([A-Za-z0-9_-]{1,64})$/i);
  if (!match || !parseAttributionMarker(match[1])) return null;
  const attribution = await resolveAttributionMarker(match[1]);
  return attribution ? {
    ...attribution,
    attributionMarker: match[1],
    source: 'public_invite_deep_link'
  } : null;
}

async function attributeContactFromMarker(contactId, marker, channel) {
  const attribution = await resolveAttributionMarker(marker);
  if (!attribution) return null;
  if (attribution.click.contact && String(attribution.click.contact) !== String(contactId)) return null;
  const claimed = await InviteClick.updateOne(
    {
      _id: attribution.click._id,
      $or: [
        { contact: { $exists: false } },
        { contact: null },
        { contact: contactId }
      ]
    },
    { $set: { contact: contactId } }
  );
  if (!claimed.matchedCount) {
    // Outro webhook pode ter tentado consumir o mesmo clique entre a leitura e
    // o update. O replay so e idempotente para o mesmo contato; nunca deixa o
    // marcador atribuir um convite a duas pessoas diferentes.
    const currentClick = await InviteClick.findById(attribution.click._id).select('contact').lean();
    if (!currentClick?.contact || String(currentClick.contact) !== String(contactId)) return null;
  }
  const contact = await contactsManager.attachInviteOrigin(contactId, attribution.invite, { channel });
  await groupsManager.addContactForInvite(attribution.invite._id, contactId);
  return {
    contact,
    invite: {
      id: String(attribution.invite._id),
      title: attribution.invite.title,
      slug: attribution.invite.slug
    }
  };
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
    await refreshInviteSnapshots(invite);
    return serialize(invite, true);
  }
  const base = slugBaseFromTitle(input.title);
  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
    try {
      const invite = await Invite.findByIdAndUpdate(id, {
        $set: { ...input, slug: slugCandidate(base, attempt) }
      }, { new: true, runValidators: true });
      if (!invite) throw new ApiError(404, 'Convite nao encontrado');
      await refreshInviteSnapshots(invite);
      return serialize(invite, true);
    } catch (error) {
      if (!isDuplicateSlug(error)) throw error;
    }
  }
  throw new ApiError(409, 'Nao foi possivel gerar um slug unico para este convite', null, 'INVITE_SLUG_EXHAUSTED');
}

async function refreshInviteSnapshots(invite) {
  if (Contact.db.readyState === 0) return;
  await Promise.all([
    Contact.updateMany(
      { 'inviteOrigins.invite': invite._id },
      {
        $set: {
          'inviteOrigins.$[origin].title': invite.title,
          'inviteOrigins.$[origin].slug': invite.slug
        }
      },
      { arrayFilters: [{ 'origin.invite': invite._id }] }
    ),
    groupsManager.refreshInviteSnapshot(invite)
  ]);
}

async function remove(id) {
  const linkedSet = await TemplateSet.findOne({ invite: id }).select('_id name').lean();
  if (linkedSet) {
    throw new ApiError(
      409,
      'Convite vinculado a um conjunto de templates nao pode ser removido',
      { inviteId: String(id), templateSetId: String(linkedSet._id), templateSetName: linkedSet.name },
      'INVITE_IN_USE_BY_TEMPLATE_SET'
    );
  }
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
  const permissionCommand = await settingsManager.getWhatsappPermissionCommand();
  const supportsAttribution = ['telegram', 'whatsapp_cloud'].includes(link.channel);
  const attributionMarker = supportsAttribution ? createAttributionMarker(invite._id, invite.slug) : null;
  const redirectUrl = link.channel === 'telegram'
    ? telegramInviteRedirectUrlWithAttribution(link.url, permissionCommand, attributionMarker)
    : link.channel === 'whatsapp_cloud'
      ? whatsappInviteRedirectUrl(link.url, permissionCommand, attributionMarker)
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
    attributionMarkerHash: attributionMarker ? tokenHash(attributionMarker) : undefined,
    ipHash: meta.ip ? searchHash(meta.ip) : undefined,
    userAgentHash: meta.userAgent ? searchHash(meta.userAgent) : undefined
  });
  invite.clickCount += 1;
  await invite.save();
  if (contactId) {
    await contactsManager.attachInviteOrigin(contactId, invite, {
      channel: link.channel,
      usedAt: new Date()
    });
    await groupsManager.addContactForInvite(invite._id, contactId);
  }
  return { redirectUrl, channel: link.channel, attributed: Boolean(contactId) };
}

module.exports = {
  create, getById, list, update, remove, getPublic, track,
  slugBaseFromTitle, slugCandidate, telegramStartPayload, telegramInviteRedirectUrl,
  createAttributionMarker, parseAttributionMarker, resolveAttributionMarker,
  resolveWhatsappInviteInvocation, resolveTelegramInviteInvocation,
  telegramInviteRedirectUrlWithAttribution, whatsappInviteRedirectUrl,
  attributeContactFromMarker
};
