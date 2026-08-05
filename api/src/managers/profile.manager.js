const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Contact = require('../models/contact.model');
const ContactGroup = require('../models/contact-group.model');
const Notification = require('../models/notification.model');
const ProfileAuthChallenge = require('../models/profile-auth-challenge.model');
const Template = require('../models/template.model');
const contactsManager = require('./contacts.manager');
const groupsManager = require('./groups.manager');
const gmailManager = require('./gmail.manager');
const whatsappCloudManager = require('./whatsapp-cloud.manager');
const telegramManager = require('./telegram.manager');
const settingsManager = require('./settings.manager');
const { env } = require('../config/env');
const { searchHash, tokenHash } = require('../services/crypto.service');
const chatCommands = require('../services/chat-commands.service');
const { getRedis } = require('../services/redis.service');
const {
  normalizeEmail,
  normalizePhone,
  normalizeWhatsappE164
} = require('../utils/normalizers');
const { parsePagination, pageResult } = require('../utils/pagination');
const { registerSecurityStrike } = require('../middlewares/security');
const ApiError = require('../utils/api-error');

const PROFILE_SCOPE = Object.freeze([
  'profile:read',
  'profile:write',
  'profile:consent:revoke',
  'profile:history'
]);
// Compatibilidade interna com desafios legados já persistidos. O fluxo público
// atual usa exclusivamente PROFILE_LINK_COMMAND e não expõe estas operações.
const PROFILE_LOGIN_COMMAND = '/gerar-codigo';
const PROFILE_LINK_COMMAND = '/login';
const PROFILE_LOGIN_MARKER_PATTERN = /^pl_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{11})$/;
const PROFILE_LOGIN_FLOW = Object.freeze({
  label: 'Link seguro de uso único',
  command: PROFILE_LINK_COMMAND,
  description: 'O contato confirma a identidade pelo WhatsApp ou email e recebe um link temporário de uso único.'
});
const CODE_REQUEST_MESSAGE = 'Abra o WhatsApp oficial e envie /gerar-codigo para receber o codigo temporario.';
const INVALID_CODE_MESSAGE = 'Codigo invalido, expirado ou sem tentativas disponiveis';
const localRequestLocks = new Set();

function normalizedIdentifier(value) {
  const raw = String(value || '').normalize('NFKC').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    const email = normalizeEmail(raw);
    return {
      type: 'email',
      value: email,
      identifierHash: searchHash('profile:email:' + email),
      contactHashes: [searchHash(email)]
    };
  }
  const phone = normalizePhone(raw);
  const digits = String(phone || '').replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(digits)) {
    throw new ApiError(422, 'Informe um email ou telefone valido', null, 'PROFILE_IDENTIFIER_INVALID');
  }
  const phoneIdentity = contactsManager.mergePhoneIdentity('whatsapp_cloud', digits);
  return {
    type: 'phone',
    value: digits,
    identifierHash: searchHash('profile:phone:' + digits),
    contactHashes: phoneIdentity?.hashes || [searchHash(digits), searchHash('+' + digits)]
  };
}

function contactLookupFilter(identifier, excludeId) {
  const base = identifier.type === 'email'
    ? {
        $or: [
          { emailHash: { $in: identifier.contactHashes } },
          { channels: { $elemMatch: { channel: 'email', addressHash: { $in: identifier.contactHashes } } } }
        ]
      }
    : {
        $or: [
          { phoneHash: { $in: identifier.contactHashes } },
          {
            channels: {
              $elemMatch: {
                channel: 'whatsapp_cloud',
                addressHash: { $in: identifier.contactHashes }
              }
            }
          }
        ]
      };
  return {
    deletedAt: null,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    ...base
  };
}

async function uniqueContactForIdentifier(identifier) {
  const contacts = await Contact.find(contactLookupFilter(identifier))
    .select(contactsManager.SECRET_SELECT)
    .limit(2);
  if (contacts.length !== 1) return null;
  if (identifier.type === 'phone') {
    const serialized = contactsManager.serialize(contacts[0], { includeInlineAvatar: false });
    const candidates = [
      serialized.phone,
      ...(serialized.channels || [])
        .filter((identity) => identity.channel === 'whatsapp_cloud')
        .map((identity) => identity.deliveryAddress)
    ].map((value) => contactsManager.mergePhoneIdentity('whatsapp_cloud', value)?.aliases || [])
      .flat();
    const requested = contactsManager.mergePhoneIdentity('whatsapp_cloud', identifier.value)?.aliases || [];
    if (!requested.some((alias) => candidates.includes(alias))) return null;
  }
  return contacts[0];
}

function profileAuthDestinations(contact) {
  const serialized = contactsManager.serialize(contact, { includeInlineAvatar: false });
  const identities = serialized?.channels || [];
  const emailIdentity = identities.find((identity) => identity.channel === 'email' && identity.address);
  const cloudIdentity = identities.find((identity) => (
    identity.channel === 'whatsapp_cloud' && identity.deliveryAddress
  ));
  const telegramIdentity = identities.find((identity) => (
    identity.channel === 'telegram'
    && identity.address
    && identity.authorized
    && identity.consentStatus === 'granted'
  ));
  const email = normalizeEmail(emailIdentity?.address || serialized?.email);
  const whatsapp = normalizeWhatsappE164(cloudIdentity?.deliveryAddress || serialized?.phone);
  return {
    email: email || null,
    whatsappCloud: whatsapp ? String(whatsapp).replace(/\D/g, '') : null,
    telegram: telegramIdentity?.address ? String(telegramIdentity.address) : null
  };
}

function codeHash(challengeId, code) {
  return crypto.createHmac('sha256', env.profileJwtSecret)
    .update('profile-code:' + challengeId + ':' + code)
    .digest('hex');
}

function safeHashEquals(left, right) {
  const a = Buffer.from(String(left || ''), 'hex');
  const b = Buffer.from(String(right || ''), 'hex');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function secureCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function issueProfileToken(contactId, expiresIn = env.profileJwtTtl) {
  return jwt.sign({
    sub: String(contactId),
    type: 'profile_access',
    scope: PROFILE_SCOPE
  }, env.profileJwtSecret, {
    expiresIn,
    issuer: 'notify-app-api',
    audience: 'notify-app-contact',
    jwtid: crypto.randomUUID()
  });
}

function normalizeBrazilianLoginPhone(value) {
  let digits = String(value || '').normalize('NFKC').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^\d{10,11}$/.test(digits)) digits = `55${digits}`;
  if (!/^55[1-9]\d{9,10}$/.test(digits)) {
    throw new ApiError(
      422,
      'Informe um telefone brasileiro com DDD, por exemplo (11) 91234-5678',
      null,
      'PROFILE_PHONE_INVALID'
    );
  }
  return digits;
}

function profileLoginMarkerSignature(nonce) {
  return crypto.createHmac('sha256', env.profileJwtSecret)
    .update(`profile-login-marker:v1:${nonce}`)
    .digest()
    .subarray(0, 8)
    .toString('base64url');
}

function createProfileLoginMarker(nonce = crypto.randomBytes(12).toString('base64url')) {
  if (!/^[A-Za-z0-9_-]{16}$/.test(nonce)) {
    throw new ApiError(500, 'Nao foi possivel criar o acesso seguro', null, 'PROFILE_LOGIN_MARKER_INVALID');
  }
  return `pl_${nonce}_${profileLoginMarkerSignature(nonce)}`;
}

function parseProfileLoginInvocation(value) {
  const normalized = String(value || '').normalize('NFKC').trim();
  const match = normalized.match(/^\/login(?:\s+(\S+))?$/i);
  if (!match?.[1]) return null;
  const marker = match[1];
  const markerMatch = marker.match(PROFILE_LOGIN_MARKER_PATTERN);
  if (!markerMatch) return null;
  const expected = profileLoginMarkerSignature(markerMatch[1]);
  const actualBuffer = Buffer.from(markerMatch[2]);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length
    || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  return { command: PROFILE_LINK_COMMAND, marker };
}

function issueProfileLinkToken() {
  // Token opaco: o fragmento nao revela contactId, challengeId ou outros
  // metadados mesmo antes de ser consumido.
  return crypto.randomBytes(32).toString('base64url');
}

function publicProfileLink(token) {
  const url = new URL('/meu-perfil', env.publicAppUrl);
  // O token fica no fragmento: navegadores nao o enviam ao servidor, logs,
  // proxies ou cabecalho Referer antes da troca one-time.
  url.hash = `acesso=${encodeURIComponent(token)}`;
  return url.toString();
}

async function persistProfileLink(contactId, challenge, source) {
  const now = new Date();
  const linkExpiresAt = new Date(now.getTime() + env.profileLinkTtlSeconds * 1000);
  const linkToken = issueProfileLinkToken();
  const update = await ProfileAuthChallenge.findOneAndUpdate({
    _id: challenge._id,
    contact: contactId,
    activatedAt: null,
    revokedAt: null,
    expiresAt: { $gt: now },
    linkConsumedAt: null
  }, {
    $set: {
      flow: 'link',
      activatedAt: now,
      activationChannel: String(source || '').includes('telegram')
        ? 'telegram'
        : String(source || '').includes('email')
          ? 'email'
          : 'whatsapp_cloud',
      linkTokenHash: tokenHash(linkToken),
      linkExpiresAt,
      linkSource: String(source || 'trusted_inbound_channel').slice(0, 100)
    },
    $max: { expiresAt: linkExpiresAt }
  }, { new: true });
  if (!update) return null;
  return {
    url: publicProfileLink(linkToken),
    expiresAt: linkExpiresAt.toISOString()
  };
}

async function requestLogin(input, meta = {}) {
  const identifier = input.identifierType === 'phone'
    ? normalizedIdentifier(normalizeBrazilianLoginPhone(input.identifier))
    : normalizedIdentifier(input.identifier);
  if (identifier.type !== input.identifierType) {
    throw new ApiError(422, 'Identificador invalido para o tipo escolhido', null, 'PROFILE_IDENTIFIER_INVALID');
  }
  const releaseLock = await acquireRequestLock(identifier.identifierHash);
  try {
    await enforceRequestRate(identifier.identifierHash);
    const contact = await uniqueContactForIdentifier(identifier);
    if (!contact) {
      const identifierLabel = identifier.type === 'email' ? 'email' : 'telefone';
      throw new ApiError(
        404,
        `Nao encontramos um contato unico com esse ${identifierLabel}`,
        null,
        'PROFILE_CONTACT_NOT_FOUND'
      );
    }
    const challengeId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + env.profileCodeTtlSeconds * 1000);
    const challenge = await ProfileAuthChallenge.create({
      challengeId,
      flow: 'link',
      identifierType: identifier.type,
      identifierHash: identifier.identifierHash,
      contact: contact._id,
      maxAttempts: 1,
      requestIpHash: meta.ip ? searchHash(`profile-ip:${meta.ip}`) : undefined,
      userAgent: String(meta.userAgent || '').slice(0, 500),
      codeExpiresAt: expiresAt,
      expiresAt
    });
    if (identifier.type === 'email') {
      const link = await persistProfileLink(contact._id, challenge, 'email_login_request');
      if (!link) throw new ApiError(409, 'Nao foi possivel emitir o link de acesso', null, 'PROFILE_LINK_ISSUE_FAILED');
      try {
        await gmailManager.send({
          destination: identifier.value,
          allowUnconsented: true,
          useCase: 'profile_auth',
          subject: 'Acesso seguro ao seu perfil',
          text: `Use o link abaixo para entrar no Meu perfil. Ele pode ser usado uma vez e expira em ate 7 dias:\n\n${link.url}`
        });
      } catch (error) {
        await ProfileAuthChallenge.updateOne(
          { _id: challenge._id },
          { $set: { revokedAt: new Date() } }
        );
        throw new ApiError(
          503,
          'Nao foi possivel enviar o link por email. Tente novamente.',
          { reasonCode: error.code || 'EMAIL_DELIVERY_FAILED' },
          'PROFILE_LINK_DELIVERY_FAILED'
        );
      }
      return {
        deliveryChannel: 'email',
        expiresAt: link.expiresAt,
        expiresInSeconds: env.profileLinkTtlSeconds,
        message: 'Enviamos um link seguro para o email cadastrado. Abra-o para entrar.'
      };
    }
    const entryPoint = await profileWhatsappEntryPoint();
    const marker = createProfileLoginMarker();
    await ProfileAuthChallenge.updateOne(
      { _id: challenge._id },
      { $set: { loginMarkerHash: tokenHash(marker) } }
    );
    const url = new URL(entryPoint.url);
    url.searchParams.set('text', `${PROFILE_LINK_COMMAND} ${marker}`);
    return {
      command: PROFILE_LINK_COMMAND,
      deliveryChannel: 'whatsapp_cloud',
      whatsappUrl: url.toString(),
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: env.profileCodeTtlSeconds,
      message: 'Envie a mensagem pronta no WhatsApp. O atendimento respondera com seu link seguro de acesso.'
    };
  } finally {
    await releaseLock();
  }
}

async function activateProfileLoginFromWhatsapp(input = {}) {
  if (!mongoose.isValidObjectId(input.contactId)) {
    return { activated: false, reasonCode: 'PROFILE_CHALLENGE_CONTEXT_INVALID' };
  }
  const invocation = parseProfileLoginInvocation(input.text);
  if (!invocation) return { activated: false, reasonCode: 'PROFILE_LOGIN_MARKER_INVALID' };
  const now = new Date();
  const challenge = await ProfileAuthChallenge.findOne({
    flow: 'link',
    contact: input.contactId,
    loginMarkerHash: tokenHash(invocation.marker),
    activatedAt: null,
    consumedAt: null,
    revokedAt: null,
    expiresAt: { $gt: now }
  }).select('+loginMarkerHash');
  if (!challenge) return { activated: false, reasonCode: 'PROFILE_CHALLENGE_NOT_FOUND' };
  const link = await persistProfileLink(input.contactId, challenge, 'whatsapp_login_command');
  return link
    ? { activated: true, challengeId: challenge.challengeId, ...link }
    : { activated: false, reasonCode: 'PROFILE_CHALLENGE_ALREADY_ACTIVATED' };
}

async function createDirectProfileLink(contactId, options = {}) {
  if (!mongoose.isValidObjectId(contactId)) {
    throw new ApiError(422, 'Contato invalido', null, 'PROFILE_CONTACT_INVALID');
  }
  const identifierHash = searchHash(`profile:direct:${contactId}`);
  const releaseLock = await acquireRequestLock(`direct:${identifierHash}`);
  try {
    const contact = await Contact.findOne({ _id: contactId, active: true, deletedAt: null })
      .select(contactsManager.SECRET_SELECT);
    if (!contact) throw new ApiError(404, 'Perfil indisponivel', null, 'PROFILE_UNAVAILABLE');
    const now = new Date();
    await ProfileAuthChallenge.updateMany({
      contact: contactId,
      flow: 'link',
      linkConsumedAt: null,
      revokedAt: null,
      linkExpiresAt: { $gt: now }
    }, {
      $set: { revokedAt: now }
    });
    const challenge = await ProfileAuthChallenge.create({
      challengeId: crypto.randomUUID(),
      flow: 'link',
      identifierType: 'phone',
      identifierHash,
      contact: contactId,
      maxAttempts: 1,
      expiresAt: new Date(now.getTime() + env.profileLinkTtlSeconds * 1000)
    });
    const link = await persistProfileLink(contactId, challenge, options.source || 'trusted_inbound_channel');
    if (!link) throw new ApiError(409, 'Nao foi possivel emitir o link de acesso', null, 'PROFILE_LINK_ISSUE_FAILED');
    return { challengeId: challenge.challengeId, ...link };
  } finally {
    await releaseLock();
  }
}

async function revokeProfileLink(challengeId, source = 'delivery_failed') {
  const result = await ProfileAuthChallenge.updateOne({
    challengeId,
    flow: 'link',
    linkConsumedAt: null,
    revokedAt: null
  }, {
    $set: {
      revokedAt: new Date(),
      linkSource: String(source || 'delivery_failed').slice(0, 100)
    }
  });
  return { revoked: Boolean(result.modifiedCount) };
}

async function exchangeProfileLink(input, meta = {}) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(input.token || ''))) {
    await registerSecurityStrike(meta.ip || 'unknown');
    throw new ApiError(401, 'Link de acesso invalido ou expirado', null, 'INVALID_PROFILE_LINK');
  }
  const now = new Date();
  const challenge = await ProfileAuthChallenge.findOneAndUpdate({
    flow: 'link',
    linkTokenHash: tokenHash(input.token),
    linkConsumedAt: null,
    revokedAt: null,
    linkExpiresAt: { $gt: now }
  }, {
    $set: { linkConsumedAt: now, consumedAt: now }
  }, { new: true }).select('+linkTokenHash');
  if (!challenge) {
    await registerSecurityStrike(meta.ip || 'unknown');
    throw new ApiError(401, 'Link de acesso ja utilizado, invalido ou expirado', null, 'INVALID_PROFILE_LINK');
  }
  const contactId = await resolveActiveProfileContactId(challenge.contact);
  if (!contactId) {
    throw new ApiError(401, 'Link de acesso invalido ou expirado', null, 'INVALID_PROFILE_LINK');
  }
  const accessToken = issueProfileToken(contactId, env.profileSessionTtlSeconds);
  const claims = jwt.decode(accessToken);
  return {
    accessToken,
    tokenType: 'Bearer',
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    expiresInSeconds: Math.max(0, claims.exp - Math.floor(Date.now() / 1000)),
    profile: await getOwnProfile(contactId)
  };
}

async function resolveActiveProfileContactId(candidateId) {
  let contactId = String(candidateId || '');
  for (let depth = 0; depth < 3 && mongoose.isValidObjectId(contactId); depth += 1) {
    const contact = await Contact.findById(contactId).select(contactsManager.SECRET_SELECT);
    if (!contact) return null;
    if (contact.active !== false && !contact.deletedAt) return String(contact._id);
    const mergedIntoContactId = contactsManager.serialize(contact, {
      includeInlineAvatar: false
    })?.metadata?.mergedIntoContactId;
    if (!mongoose.isValidObjectId(mergedIntoContactId)
      || String(mergedIntoContactId) === contactId) return null;
    contactId = String(mergedIntoContactId);
  }
  return null;
}

async function authenticateProfileAccess(token) {
  let decoded;
  try {
    decoded = jwt.verify(token, env.profileJwtSecret, {
      issuer: 'notify-app-api',
      audience: 'notify-app-contact'
    });
  } catch (_error) {
    throw new ApiError(401, 'Sessao do perfil invalida ou expirada', null, 'INVALID_PROFILE_TOKEN');
  }
  if (decoded.type !== 'profile_access' || !Array.isArray(decoded.scope)
    || !PROFILE_SCOPE.every((scope) => decoded.scope.includes(scope))) {
    throw new ApiError(403, 'Escopo de perfil invalido', null, 'INVALID_PROFILE_SCOPE');
  }
  const contactId = await resolveActiveProfileContactId(decoded.sub);
  if (!contactId) throw new ApiError(401, 'Perfil indisponivel', null, 'PROFILE_UNAVAILABLE');
  return {
    contactId,
    scope: decoded.scope,
    expiresAt: new Date(decoded.exp * 1000).toISOString()
  };
}

function deliveryResult(channel, settled) {
  if (settled.status === 'fulfilled') {
    if (settled.value?.notAvailable) {
      return { channel, status: 'not_available', errorCode: settled.value.errorCode || 'DESTINATION_UNAVAILABLE' };
    }
    return { channel, status: 'sent' };
  }
  return {
    channel,
    status: 'failed',
    errorCode: String(settled.reason?.code || 'DELIVERY_FAILED').slice(0, 100)
  };
}

async function enforceRequestRate(identifierHash) {
  const since = new Date(Date.now() - env.profileCodeWindowSeconds * 1000);
  const [count, latest] = await Promise.all([
    ProfileAuthChallenge.countDocuments({ identifierHash, createdAt: { $gte: since } }),
    ProfileAuthChallenge.findOne({ identifierHash }).select('createdAt').sort({ createdAt: -1 }).lean()
  ]);
  const tooSoon = latest?.createdAt
    && Date.now() - new Date(latest.createdAt).getTime() < env.profileCodeResendSeconds * 1000;
  if (count >= env.profileCodeMaxRequests || tooSoon) {
    throw new ApiError(429, 'Aguarde antes de solicitar outro acesso', null, 'PROFILE_CODE_RATE_LIMIT');
  }
}

function challengeCodeExpiry(challenge) {
  return challenge?.codeExpiresAt || challenge?.expiresAt || null;
}

function activeCodeWindow(now = new Date()) {
  return {
    $or: [
      { codeExpiresAt: { $gt: now } },
      { codeExpiresAt: { $exists: false }, expiresAt: { $gt: now } }
    ]
  };
}

async function acquireRequestLock(identifierHash) {
  const key = `profile:code-request:${identifierHash}`;
  const token = crypto.randomUUID();
  const redis = getRedis();
  if (!redis && env.redisRequired) {
    throw new ApiError(
      503,
      'Nao foi possivel iniciar a verificacao com seguranca. Tente novamente.',
      null,
      'PROFILE_CODE_LOCK_UNAVAILABLE'
    );
  }
  if (redis) {
    let acquired;
    try {
      acquired = await redis.set(key, token, { NX: true, EX: 15 });
    } catch (_error) {
      throw new ApiError(
        503,
        'Nao foi possivel iniciar a verificacao com seguranca. Tente novamente.',
        null,
        'PROFILE_CODE_LOCK_UNAVAILABLE'
      );
    }
    if (!acquired) {
      throw new ApiError(429, 'Aguarde antes de solicitar outro acesso', null, 'PROFILE_CODE_RATE_LIMIT');
    }
    return async () => {
      try {
        await redis.eval(
          'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end',
          { keys: [key], arguments: [token] }
        );
      } catch (_error) {
        // O TTL curto libera o lock mesmo se o Redis oscilar durante o cleanup.
      }
    };
  }
  if (localRequestLocks.has(key)) {
    throw new ApiError(429, 'Aguarde antes de solicitar outro acesso', null, 'PROFILE_CODE_RATE_LIMIT');
  }
  localRequestLocks.add(key);
  return async () => { localRequestLocks.delete(key); };
}

async function profileWhatsappEntryPoint() {
  const configured = await settingsManager.getValue('WHATSAPP_CLOUD_DISPLAY_PHONE_NUMBER');
  const digits = String(configured || env.whatsappCloudDisplayPhoneNumber || '').replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(digits)) {
    throw new ApiError(
      503,
      'Configure o numero publico do WhatsApp Cloud antes de habilitar o login pelo chat',
      null,
      'PROFILE_WHATSAPP_PUBLIC_NUMBER_REQUIRED'
    );
  }
  const url = new URL('https://wa.me/' + digits);
  url.searchParams.set('text', PROFILE_LOGIN_COMMAND);
  return { digits, url: url.toString() };
}

async function publicAccessConfig() {
  const configured = await settingsManager.getValue('WHATSAPP_CLOUD_DISPLAY_PHONE_NUMBER');
  const digits = String(configured || env.whatsappCloudDisplayPhoneNumber || '').replace(/\D/g, '');
  const validPhoneNumber = /^[1-9]\d{7,14}$/.test(digits);
  let loginUrl = null;

  if (validPhoneNumber) {
    const url = new URL('https://wa.me/' + digits);
    url.searchParams.set('text', PROFILE_LINK_COMMAND);
    loginUrl = url.toString();
  }

  return {
    profilePath: '/meu-perfil',
    whatsapp: {
      configured: validPhoneNumber,
      loginUrl
    }
  };
}

async function requestCode(input, meta = {}) {
  const identifier = normalizedIdentifier(input.identifier);
  const releaseLock = await acquireRequestLock(identifier.identifierHash);
  try {
    const now = new Date();
    const activeChallenge = await ProfileAuthChallenge.findOne({
      identifierHash: identifier.identifierHash,
      consumedAt: null,
      revokedAt: null,
      $and: [activeCodeWindow(now)]
    }).select('_id').lean();
    // Nunca devolvemos o challengeId de outra solicitacao. Quem conhece apenas
    // o email/telefone nao pode recuperar o desafio e consumir suas tentativas.
    if (activeChallenge) {
      throw new ApiError(429, 'Aguarde antes de solicitar outro codigo', null, 'PROFILE_CODE_RATE_LIMIT');
    }
    await enforceRequestRate(identifier.identifierHash);
    const contact = await uniqueContactForIdentifier(identifier);
    if (!contact) {
      throw new ApiError(
        404,
        'Contato nao encontrado para o identificador informado',
        null,
        'PROFILE_CONTACT_NOT_FOUND'
      );
    }
    const whatsappEntryPoint = await profileWhatsappEntryPoint();
    const challengeId = crypto.randomUUID();
    const codeExpiresAt = new Date(now.getTime() + env.profileCodeTtlSeconds * 1000);
    const expiresAt = new Date(
      now.getTime() + Math.max(env.profileCodeWindowSeconds, env.profileCodeTtlSeconds) * 1000
    );
    await ProfileAuthChallenge.create({
      challengeId,
      identifierType: identifier.type,
      identifierHash: identifier.identifierHash,
      contact: contact._id,
      maxAttempts: env.profileCodeMaxAttempts,
      requestIpHash: meta.ip ? searchHash('profile-ip:' + meta.ip) : undefined,
      userAgent: String(meta.userAgent || '').slice(0, 500),
      codeExpiresAt,
      expiresAt
    });

    return {
      challengeId,
      expiresInSeconds: env.profileCodeTtlSeconds,
      expiresAt: codeExpiresAt.toISOString(),
      command: PROFILE_LOGIN_COMMAND,
      whatsappUrl: whatsappEntryPoint.url,
      message: CODE_REQUEST_MESSAGE,
      awaitingWhatsapp: true
    };
  } finally {
    await releaseLock();
  }
}

async function activatePendingCodeFromWhatsapp(input = {}) {
  if (!mongoose.isValidObjectId(input.contactId) || !input.conversationId) {
    return { activated: false, reasonCode: 'PROFILE_CHALLENGE_CONTEXT_INVALID' };
  }
  const now = new Date();
  const challenge = await ProfileAuthChallenge.findOne({
    contact: input.contactId,
    consumedAt: null,
    revokedAt: null,
    $and: [activeCodeWindow(now)]
  }).select('+identifierHash +codeHash').sort({ createdAt: -1 });
  if (!challenge) {
    return { activated: false, reasonCode: 'PROFILE_CHALLENGE_NOT_FOUND' };
  }

  const code = secureCode();
  const resendBefore = new Date(now.getTime() - env.profileCodeResendSeconds * 1000);
  const codeExpiresAt = new Date(now.getTime() + env.profileCodeTtlSeconds * 1000);
  const cleanupExpiresAt = new Date(
    now.getTime() + Math.max(env.profileCodeWindowSeconds, env.profileCodeTtlSeconds) * 1000
  );
  const claimed = await ProfileAuthChallenge.findOneAndUpdate({
    _id: challenge._id,
    consumedAt: null,
    revokedAt: null,
    $and: [
      activeCodeWindow(now),
      {
        $or: [
          { activatedAt: null },
          { activatedAt: { $exists: false } },
          { activatedAt: { $lte: resendBefore } }
        ]
      },
      {
        $or: [
          { activationCount: { $exists: false } },
          { activationCount: { $lt: env.profileCodeMaxRequests } }
        ]
      }
    ]
  }, {
    $set: {
      codeHash: codeHash(challenge.challengeId, code),
      codeExpiresAt,
      activatedAt: now,
      activationChannel: 'whatsapp_cloud',
      attempts: 0,
      deliveries: []
    },
    $inc: { activationCount: 1 },
    $max: { expiresAt: cleanupExpiresAt }
  }, { new: true });
  if (!claimed) {
    return { activated: false, reasonCode: 'PROFILE_CHALLENGE_ALREADY_ACTIVATED' };
  }

  const contact = await Contact.findById(input.contactId).select(contactsManager.SECRET_SELECT);
  if (!contact) {
    await ProfileAuthChallenge.updateOne({ _id: claimed._id }, { $set: { revokedAt: new Date() } });
    return { activated: false, reasonCode: 'PROFILE_CONTACT_NOT_FOUND' };
  }
  const destinations = profileAuthDestinations(contact);
  const ttlMinutes = Math.max(1, Math.ceil(env.profileCodeTtlSeconds / 60));
  const unavailable = async (errorCode) => ({ notAvailable: true, errorCode });
  const whatsappText = `Seu código de acesso ao Meu perfil é *“${code}”*. Ele expira em ${ttlMinutes} minutos.`;
  const commonText = `Seu código de acesso ao Meu perfil é “${code}”. Ele expira em ${ttlMinutes} minutos.`;
  const sends = [
    destinations.email
      ? gmailManager.send({
          destination: destinations.email,
          allowUnconsented: true,
          useCase: 'profile_auth',
          subject: 'Código de acesso ao seu perfil',
          text: commonText
        })
      : unavailable('EMAIL_DESTINATION_UNAVAILABLE'),
    whatsappCloudManager.sendConversationText(
      input.conversationId,
      whatsappText,
      { useCase: 'profile_auth' }
    ),
    destinations.telegram
      ? telegramManager.send({
          contactId: String(contact._id),
          useCase: 'profile_auth',
          text: commonText
        })
      : unavailable('TELEGRAM_DESTINATION_UNAVAILABLE')
  ];
  const settled = await Promise.allSettled(sends);
  const deliveries = [
    deliveryResult('email', settled[0]),
    deliveryResult('whatsapp_cloud', settled[1]),
    deliveryResult('telegram', settled[2])
  ];
  const delivered = deliveries.some((delivery) => delivery.status === 'sent');
  await ProfileAuthChallenge.updateOne(
    { _id: claimed._id },
    { $set: { deliveries, ...(!delivered ? { revokedAt: new Date() } : {}) } }
  );
  return {
    activated: delivered,
    challengeId: claimed.challengeId,
    deliveries,
    expiresAt: challengeCodeExpiry(claimed),
    reasonCode: delivered ? null : 'PROFILE_CODE_DELIVERY_FAILED'
  };
}

async function verifyCode(input, meta = {}) {
  const challenge = await ProfileAuthChallenge.findOne({ challengeId: input.challengeId })
    .select('+codeHash +identifierHash');
  const now = new Date();
  const unavailable = !challenge
    || challenge.revokedAt
    || challenge.consumedAt
    || !challenge.activatedAt
    || !challenge.codeHash
    || challengeCodeExpiry(challenge) <= now
    || challenge.attempts >= challenge.maxAttempts;
  if (unavailable) {
    await registerSecurityStrike(meta.ip || 'unknown');
    throw new ApiError(401, INVALID_CODE_MESSAGE, null, 'INVALID_PROFILE_CODE');
  }

  const valid = safeHashEquals(challenge.codeHash, codeHash(challenge.challengeId, input.code));
  const generationFilter = {
    codeHash: challenge.codeHash,
    activatedAt: challenge.activatedAt,
    ...(challenge.codeExpiresAt
      ? { codeExpiresAt: challenge.codeExpiresAt }
      : { expiresAt: challenge.expiresAt })
  };
  if (!valid || !challenge.contact) {
    await ProfileAuthChallenge.updateOne(
      {
        _id: challenge._id,
        consumedAt: null,
        revokedAt: null,
        attempts: { $lt: challenge.maxAttempts },
        ...generationFilter
      },
      { $inc: { attempts: 1 } }
    );
    await registerSecurityStrike(meta.ip || 'unknown');
    throw new ApiError(401, INVALID_CODE_MESSAGE, null, 'INVALID_PROFILE_CODE');
  }

  const claimed = await ProfileAuthChallenge.findOneAndUpdate({
    _id: challenge._id,
    consumedAt: null,
    revokedAt: null,
    $and: [activeCodeWindow(now)],
    attempts: { $lt: challenge.maxAttempts },
    ...generationFilter
  }, {
    $set: { consumedAt: now },
    $inc: { attempts: 1 }
  }, { new: true });
  if (!claimed) throw new ApiError(401, INVALID_CODE_MESSAGE, null, 'INVALID_PROFILE_CODE');

  const contact = await Contact.exists({ _id: challenge.contact, active: true, deletedAt: null });
  if (!contact) throw new ApiError(401, 'Perfil indisponivel', null, 'PROFILE_UNAVAILABLE');
  const accessToken = issueProfileToken(challenge.contact);
  const tokenClaims = jwt.decode(accessToken);
  const tokenExpiresAt = new Date(tokenClaims.exp * 1000);
  return {
    accessToken,
    tokenType: 'Bearer',
    expiresAt: tokenExpiresAt.toISOString(),
    expiresInSeconds: Math.max(0, Math.floor((tokenExpiresAt.getTime() - Date.now()) / 1000)),
    profile: await getOwnProfile(String(challenge.contact))
  };
}

function permissionState(contact, channel) {
  const identities = (contact.channels || []).filter((identity) => identity.channel === channel);
  const authorized = identities.some((identity) => identity.authorized && identity.consentStatus === 'granted');
  const pending = (contact.pendingWhatsappConsents || []).find((item) => item.channel === channel);
  const latest = [...identities].sort((left, right) => (
    new Date(right.consentChangedAt || right.interactedAt || 0) - new Date(left.consentChangedAt || left.interactedAt || 0)
  ))[0];
  return {
    channel,
    authorized,
    consentStatus: authorized ? 'granted' : pending?.status || latest?.consentStatus || 'unknown',
    pending: Boolean(pending?.status === 'granted' && !identities.length),
    consentSource: latest?.consentSource || pending?.source || null,
    consentCommand: latest?.consentCommand || pending?.command || null,
    consentChangedAt: latest?.consentChangedAt || pending?.changedAt || pending?.createdAt || null
  };
}

function publicProfile(contact) {
  return {
    id: contact.id,
    displayName: contact.displayName,
    email: contact.email,
    phone: contact.phone,
    phoneSource: contact.phoneSource,
    phoneUnavailableReason: contact.phoneUnavailableReason,
    telegramUsername: contact.telegramUsername,
    avatarUrl: contact.avatarUrl,
    permissions: ['telegram', 'whatsapp_cloud', 'email']
      .map((channel) => permissionState(contact, channel)),
    updatedAt: contact.updatedAt
  };
}

async function getOwnProfile(contactId) {
  return publicProfile(await contactsManager.getById(contactId));
}

async function assertUniqueProfileIdentifiers(contactId, input) {
  for (const field of ['email', 'phone']) {
    if (input[field] === undefined || input[field] === null) continue;
    const identifier = normalizedIdentifier(input[field]);
    if (identifier.type !== field) {
      throw new ApiError(422, `${field === 'email' ? 'Email' : 'Telefone'} invalido`, null, 'PROFILE_IDENTIFIER_INVALID');
    }
    const duplicate = await Contact.exists(contactLookupFilter(identifier, contactId));
    if (duplicate) {
      throw new ApiError(409, 'Email ou telefone ja pertence a outro contato', null, 'DUPLICATE_CONTACT_IDENTIFIER');
    }
  }
}

async function updateOwnProfile(contactId, input) {
  const current = await contactsManager.getById(contactId);
  const mergedEmail = input.email === undefined ? current.email : input.email;
  const mergedPhone = input.phone === undefined ? current.phone : input.phone;
  if (!mergedEmail && !mergedPhone) {
    throw new ApiError(422, 'Mantenha ao menos um email ou telefone para acessar o perfil', null, 'PROFILE_LOGIN_IDENTIFIER_REQUIRED');
  }
  if (input.phone) {
    const inputDigits = normalizeWhatsappE164(input.phone);
    if (!inputDigits) {
      throw new ApiError(
        422,
        'Informe um telefone E.164 real; LID/chat_id nao pode ser usado como telefone',
        null,
        'PROFILE_PHONE_PROVIDER_IDENTIFIER_INVALID'
      );
    }
  }
  await assertUniqueProfileIdentifiers(contactId, input);
  return publicProfile(await contactsManager.update(contactId, input));
}

async function revokeOwnConsent(contactId, input) {
  const contact = await contactsManager.setChannelConsent(contactId, input.channel, 'revoked', {
    source: 'self_service_profile',
    purpose: 'notification_delivery',
    evidence: { confirmed: true, selfService: true }
  });
  return publicProfile(contact);
}

async function setOwnEmailConsent(contactId, input) {
  const status = input.enabled ? 'granted' : 'revoked';
  if (status === 'granted') await contactsManager.ensureEmailIdentity(contactId);
  const contact = await contactsManager.setChannelConsent(contactId, 'email', status, {
    source: 'self_service_profile_email',
    purpose: 'notification_delivery',
    evidence: { confirmed: true, selfService: true, enabled: input.enabled }
  });
  return publicProfile(contact);
}

function digitsOnly(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

async function businessWhatsappNumber(contact) {
  const runtimeConfigured = digitsOnly(await settingsManager.getValue('WHATSAPP_CLOUD_DISPLAY_PHONE_NUMBER'));
  if (runtimeConfigured) return runtimeConfigured;
  const configured = digitsOnly(env.whatsappCloudDisplayPhoneNumber);
  if (configured) return configured;
  const metadataNumber = (contact.channels || [])
    .filter((identity) => identity.channel === 'whatsapp_cloud')
    .map((identity) => digitsOnly(identity.metadata?.displayPhoneNumber))
    .find(Boolean);
  if (metadataNumber) return metadataNumber;

  const [accessToken, phoneNumberId, version] = await Promise.all([
    settingsManager.getValue('WHATSAPP_CLOUD_ACCESS_TOKEN'),
    settingsManager.getValue('WHATSAPP_CLOUD_PHONE_NUMBER_ID'),
    settingsManager.getValue('WHATSAPP_CLOUD_API_VERSION')
  ]);
  if (!accessToken || !phoneNumberId) return null;
  try {
    const response = await fetch(
      `https://graph.facebook.com/${version || env.whatsappCloudApiVersion}/${phoneNumberId}?fields=display_phone_number`,
      { headers: { authorization: 'Bearer ' + accessToken }, signal: AbortSignal.timeout(8_000) }
    );
    if (!response.ok) return null;
    return digitsOnly((await response.json()).display_phone_number);
  } catch (_error) {
    return null;
  }
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

async function activationLinks(contactId) {
  const contact = await contactsManager.getById(contactId);
  const [command, telegramPermissionCommand, telegramStatus, whatsappNumber] = await Promise.all([
    settingsManager.getWhatsappPermissionCommand(),
    settingsManager.getTelegramPermissionCommand(),
    telegramManager.status({ probe: true }).catch(() => ({ configured: false })),
    businessWhatsappNumber(contact)
  ]);
  const telegramUsername = String(env.telegramBotUsername || telegramStatus.bot?.username || '')
    .replace(/^@/, '').trim();
  const telegramPayload = telegramStartPayload(command);
  const telegramUrl = telegramUsername
    ? `https://t.me/${encodeURIComponent(telegramUsername)}?start=${encodeURIComponent(telegramPayload)}`
    : null;
  const whatsappUrl = whatsappNumber
    ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(command)}`
    : null;
  return {
    telegram: {
      command,
      permissionCommand: telegramPermissionCommand,
      deepLinkCommand: `/start ${telegramPayload}`,
      deepLinkPayload: telegramPayload,
      url: telegramUrl,
      explanation: `O Telegram converte o comando ${command} no deep-link permitido /start ${telegramPayload}.`,
      unavailableReason: telegramUrl ? null : 'Bot do Telegram ainda nao identificado'
    },
    whatsapp: {
      command,
      url: whatsappUrl,
      appliesTo: ['whatsapp_cloud'],
      unavailableReason: whatsappUrl ? null : 'Numero empresarial do WhatsApp ainda nao identificado'
    },
    helpCommands: {
      whatsapp: chatCommands.commandCatalog('whatsapp_cloud', {
        whatsapp: command,
        telegram: telegramPermissionCommand
      }),
      telegram: chatCommands.commandCatalog('telegram', {
        whatsapp: command,
        telegram: telegramPermissionCommand
      })
    }
  };
}

function objectId(value) {
  return value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(String(value));
}

async function deliveryHistory(contactId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const contactObjectId = objectId(contactId);
  const [facet] = await Notification.aggregate([
    { $match: { 'deliveries.contact': contactObjectId } },
    { $unwind: '$deliveries' },
    { $match: { 'deliveries.contact': contactObjectId } },
    {
      $set: {
        historyDate: {
          $ifNull: ['$deliveries.updatedAt', { $ifNull: ['$deliveries.createdAt', '$createdAt'] }]
        }
      }
    },
    { $sort: { historyDate: -1, _id: -1, 'deliveries._id': -1 } },
    {
      $facet: {
        items: [
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              id: '$deliveries._id',
              notificationId: '$_id',
              channel: '$deliveries.channel',
              status: '$deliveries.status',
              attempts: { $ifNull: ['$deliveries.attempts', 0] },
              errorCode: { $ifNull: ['$deliveries.errorCode', null] },
              errorMessage: { $ifNull: ['$deliveries.errorMessage', null] },
              sentAt: { $ifNull: ['$deliveries.sentAt', null] },
              deliveryCreatedAt: { $ifNull: ['$deliveries.createdAt', '$createdAt'] },
              deliveryUpdatedAt: '$historyDate',
              notificationKind: '$kind',
              notificationChannel: '$channel',
              notificationStatus: '$status',
              notificationCreatedAt: '$createdAt',
              notificationCompletedAt: { $ifNull: ['$completedAt', null] },
              template: '$template',
              templates: '$templates',
              recipientGroups: '$recipientGroups'
            }
          }
        ],
        metadata: [{ $count: 'total' }]
      }
    }
  ]);
  const rawItems = facet?.items || [];
  const groupIds = [...new Set(rawItems.flatMap((item) => (item.recipientGroups || []).map(String)))];
  const templateIds = [...new Set(rawItems.flatMap((item) => {
    const selected = item.template ? [item.template] : [];
    if (item.templates && typeof item.templates === 'object') selected.push(...Object.values(item.templates).filter(Boolean));
    return selected.map(String);
  }))];
  const [groups, templates] = await Promise.all([
    groupIds.length
      ? ContactGroup.find({ _id: { $in: groupIds } }).select(groupsManager.SECRET_SELECT)
      : [],
    templateIds.length
      ? Template.find({ _id: { $in: templateIds } }).select('name channel externalTemplateName languageCode').lean()
      : []
  ]);
  const groupsById = new Map(groups.map((group) => [String(group._id), groupsManager.serialize(group)]));
  const templatesById = new Map(templates.map((template) => [String(template._id), {
    id: String(template._id),
    name: template.name,
    channel: template.channel,
    externalTemplateName: template.externalTemplateName || null,
    languageCode: template.languageCode || null
  }]));
  const items = rawItems.map((item) => {
    const selectedTemplateId = item.template
      || (item.templates && item.templates[item.channel]);
    const recipientGroups = (item.recipientGroups || [])
      .map((id) => groupsById.get(String(id)))
      .filter(Boolean)
      .map((group) => ({ id: group.id, name: group.name }));
    return {
      id: String(item.id),
      notificationId: String(item.notificationId),
      channel: item.channel,
      status: item.status,
      attempts: item.attempts,
      errorCode: item.errorCode,
      errorMessage: item.errorMessage,
      sentAt: item.sentAt,
      createdAt: item.deliveryCreatedAt,
      updatedAt: item.deliveryUpdatedAt,
      notification: {
        kind: item.notificationKind,
        channel: item.notificationChannel,
        status: item.notificationStatus,
        createdAt: item.notificationCreatedAt,
        completedAt: item.notificationCompletedAt,
        scope: item.notificationKind === 'global' ? 'global' : recipientGroups.length ? 'group' : 'individual',
        viaGroup: recipientGroups.length > 0
      },
      template: selectedTemplateId ? templatesById.get(String(selectedTemplateId)) || null : null,
      groups: recipientGroups
    };
  });
  return pageResult(items, Number(facet?.metadata?.[0]?.total || 0), page, limit);
}

function challengeStatus(challenge, now = new Date()) {
  if (challenge.consumedAt) return 'verified';
  if (challenge.revokedAt) return 'revoked';
  if (challenge.flow === 'link') {
    const expiry = challenge.linkExpiresAt || challenge.expiresAt;
    if (expiry <= now) return 'expired';
    return challenge.activatedAt ? 'active' : 'awaiting_whatsapp';
  }
  if (challengeCodeExpiry(challenge) <= now) return 'expired';
  if (challenge.attempts >= challenge.maxAttempts) return 'blocked';
  if (!challenge.activatedAt) return 'awaiting_whatsapp';
  return 'pending';
}

async function profileTemplateAvailability() {
  return {
    found: true,
    approvalConfirmed: true,
    status: 'active',
    languages: [],
    checkedAt: new Date().toISOString(),
    reasonCode: null,
    command: PROFILE_LINK_COMMAND,
    flow: 'one_time_profile_link'
  };
}

async function loginOverview(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.identifierType) filter.identifierType = query.identifierType;
  if (query.deliveryChannel) {
    filter.$or = [
      { 'deliveries.channel': query.deliveryChannel },
      { flow: 'link', activationChannel: query.deliveryChannel }
    ];
  }
  const [items, total, gmailStatus, cloudStatus, telegramStatus, templateAvailability] = await Promise.all([
    ProfileAuthChallenge.find(filter)
      .select('-identifierHash -codeHash -requestIpHash')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ProfileAuthChallenge.countDocuments(filter),
    gmailManager.status().catch((error) => ({ configured: false, errorCode: error.code || 'STATUS_FAILED' })),
    whatsappCloudManager.status().catch((error) => ({ configured: false, errorCode: error.code || 'STATUS_FAILED' })),
    telegramManager.status().catch((error) => ({ configured: false, errorCode: error.code || 'STATUS_FAILED' })),
    profileTemplateAvailability()
  ]);
  return {
    configuration: {
      template: {
        label: PROFILE_LOGIN_FLOW.label,
        name: null,
        languageCode: null,
        bodyParameter: null,
        command: PROFILE_LINK_COMMAND,
        flow: 'one_time_profile_link',
        description: PROFILE_LOGIN_FLOW.description,
        editable: false,
        approvalConfirmed: templateAvailability.approvalConfirmed,
        found: templateAvailability.found,
        status: templateAvailability.status,
        languages: templateAvailability.languages,
        checkedAt: templateAvailability.checkedAt,
        statusReasonCode: templateAvailability.reasonCode,
        prerequisite: 'Configure o numero publico do WhatsApp Cloud e/ou Gmail. O link e assinado, de uso unico e valido por no maximo 7 dias.'
      },
      providers: {
        email: { configured: Boolean(gmailStatus.configured) },
        whatsapp_cloud: {
          configured: Boolean(cloudStatus.sendConfigured || cloudStatus.configured),
          serviceWindowFlow: true,
          command: PROFILE_LINK_COMMAND
        },
        telegram: { configured: Boolean(telegramStatus.configured) }
      }
    },
    ...pageResult(items.map((challenge) => ({
      id: String(challenge._id),
      challengeId: challenge.challengeId,
      contactId: challenge.contact ? String(challenge.contact) : null,
      identifierType: challenge.identifierType,
      status: challengeStatus(challenge),
      attempts: challenge.attempts,
      maxAttempts: challenge.maxAttempts,
      activationChannel: challenge.activationChannel || null,
      linkSource: challenge.linkSource || null,
      deliveries: (challenge.deliveries || []).map((delivery) => ({
        channel: delivery.channel,
        status: delivery.status,
        errorCode: delivery.errorCode || null,
        attemptedAt: delivery.attemptedAt
      })),
      expiresAt: challenge.flow === 'link'
        ? challenge.linkExpiresAt || challenge.expiresAt
        : challengeCodeExpiry(challenge),
      activatedAt: challenge.activatedAt || null,
      createdAt: challenge.createdAt,
      consumedAt: challenge.consumedAt
    })), total, page, limit)
  };
}

module.exports = {
  PROFILE_SCOPE,
  PROFILE_LOGIN_COMMAND,
  PROFILE_LOGIN_FLOW,
  normalizedIdentifier,
  requestCode,
  activatePendingCodeFromWhatsapp,
  verifyCode,
  authenticateProfileAccess,
  getOwnProfile,
  updateOwnProfile,
  revokeOwnConsent,
  setOwnEmailConsent,
  activationLinks,
  telegramStartPayload,
  deliveryHistory,
  loginOverview,
  profileTemplateAvailability,
  issueProfileToken,
  PROFILE_LINK_COMMAND,
  normalizeBrazilianLoginPhone,
  createProfileLoginMarker,
  parseProfileLoginInvocation,
  requestLogin,
  activateProfileLoginFromWhatsapp,
  createDirectProfileLink,
  revokeProfileLink,
  exchangeProfileLink,
  resolveActiveProfileContactId,
  publicAccessConfig
};
