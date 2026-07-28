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
const { searchHash } = require('../services/crypto.service');
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
const PROFILE_LOGIN_COMMAND = '/gerar-codigo';
const PROFILE_LOGIN_FLOW = Object.freeze({
  label: 'Código pela conversa oficial',
  command: PROFILE_LOGIN_COMMAND,
  description: 'O contato abre o WhatsApp oficial, envia o comando e recebe um código temporário na janela de atendimento.'
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

function issueProfileToken(contactId) {
  return jwt.sign({
    sub: String(contactId),
    type: 'profile_access',
    scope: PROFILE_SCOPE
  }, env.profileJwtSecret, {
    expiresIn: env.profileJwtTtl,
    issuer: 'notify-app-api',
    audience: 'notify-app-contact',
    jwtid: crypto.randomUUID()
  });
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
  const available = await Contact.exists({ _id: decoded.sub, active: true, deletedAt: null });
  if (!available) throw new ApiError(401, 'Perfil indisponivel', null, 'PROFILE_UNAVAILABLE');
  return {
    contactId: String(decoded.sub),
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
    throw new ApiError(429, 'Aguarde antes de solicitar outro codigo', null, 'PROFILE_CODE_RATE_LIMIT');
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
      throw new ApiError(429, 'Aguarde antes de solicitar outro codigo', null, 'PROFILE_CODE_RATE_LIMIT');
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
    throw new ApiError(429, 'Aguarde antes de solicitar outro codigo', null, 'PROFILE_CODE_RATE_LIMIT');
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
  const command = await settingsManager.getWhatsappPermissionCommand();
  const [telegramStatus, whatsappNumber] = await Promise.all([
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
    command: PROFILE_LOGIN_COMMAND,
    flow: 'whatsapp_service_window'
  };
}

async function loginOverview(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.identifierType) filter.identifierType = query.identifierType;
  if (query.deliveryChannel) filter['deliveries.channel'] = query.deliveryChannel;
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
        command: PROFILE_LOGIN_COMMAND,
        flow: 'whatsapp_service_window',
        description: PROFILE_LOGIN_FLOW.description,
        editable: false,
        approvalConfirmed: templateAvailability.approvalConfirmed,
        found: templateAvailability.found,
        status: templateAvailability.status,
        languages: templateAvailability.languages,
        checkedAt: templateAvailability.checkedAt,
        statusReasonCode: templateAvailability.reasonCode,
        prerequisite: 'Configure o numero publico do WhatsApp Cloud. O contato inicia a conversa e o sistema responde dentro da janela de 24 horas.'
      },
      providers: {
        email: { configured: Boolean(gmailStatus.configured) },
        whatsapp_cloud: {
          configured: Boolean(cloudStatus.sendConfigured || cloudStatus.configured),
          serviceWindowFlow: true,
          command: PROFILE_LOGIN_COMMAND
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
      deliveries: (challenge.deliveries || []).map((delivery) => ({
        channel: delivery.channel,
        status: delivery.status,
        errorCode: delivery.errorCode || null,
        attemptedAt: delivery.attemptedAt
      })),
      expiresAt: challengeCodeExpiry(challenge),
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
  issueProfileToken
};
