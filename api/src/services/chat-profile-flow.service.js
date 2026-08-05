const crypto = require('node:crypto');
const { z } = require('zod');
const ChatEmailChallenge = require('../models/chat-email-challenge.model');
const contactsManager = require('../managers/contacts.manager');
const gmailManager = require('../managers/gmail.manager');
const settingsManager = require('../managers/settings.manager');
const { env } = require('../config/env');
const chatCommands = require('./chat-commands.service');
const {
  decrypt,
  encrypt,
  searchHash,
  timingSafeEqual
} = require('./crypto.service');
const { getRedis } = require('./redis.service');

const EMAIL_CAPTURE_TTL_SECONDS = 15 * 60;
const EMAIL_VERIFICATION_LEASE_SECONDS = 2 * 60;
const MAX_REDACTION_CODE_HASHES = 128;
const EMAIL_CAPTURE_CHANNELS = new Set(['telegram', 'whatsapp_cloud']);
const EMAIL_VERIFICATION_CODE_PLACEHOLDER = '[Codigo de verificacao de email]';
const emailSchema = z.string().trim().email().max(254)
  .transform((value) => value.toLocaleLowerCase('en-US'));
const localCaptures = new Map();

function normalizedChannel(value) {
  const channel = String(value || '').trim();
  if (!EMAIL_CAPTURE_CHANNELS.has(channel)) throw new Error('Canal de captura de email invalido');
  return channel;
}

function captureKey(contactId, channel) {
  const safeChannel = normalizedChannel(channel);
  const digest = crypto.createHash('sha256').update(String(contactId || '')).digest('hex');
  return `chat-profile:email:${safeChannel}:${digest}`;
}

function verificationSlotKey(contactId) {
  return searchHash(`chat-email-verification:${String(contactId || '')}`);
}

function verificationCodeHash(operationId, code) {
  return searchHash(`chat-email-code:${operationId}:${code}`);
}

function verificationRedactionHash(code) {
  return searchHash(`chat-email-redaction:${code}`);
}

function secureVerificationCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function providerEvidenceHashes(channel, providerEvidence = {}) {
  const hashes = {};
  if (providerEvidence.providerMessageId !== undefined
    && providerEvidence.providerMessageId !== null) {
    hashes.providerMessageReferenceHash = searchHash(
      `chat-email-message:${channel}:${String(providerEvidence.providerMessageId)}`
    );
  }
  if (providerEvidence.updateId !== undefined && providerEvidence.updateId !== null) {
    hashes.providerUpdateReferenceHash = searchHash(
      `chat-email-update:${channel}:${String(providerEvidence.updateId)}`
    );
  }
  return hashes;
}

function extractEmailCandidates(text) {
  const normalized = String(text || '').normalize('NFKC').trim();
  const exact = emailSchema.safeParse(normalized);
  if (exact.success) return [exact.data];
  const candidates = normalized.match(
    /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi
  ) || [];
  return [...new Set(candidates.flatMap((candidate) => {
    const parsed = emailSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  }))];
}

async function currentEmailChallenge(contactId, options = {}) {
  let query = ChatEmailChallenge.findOne({
    slotKey: verificationSlotKey(contactId)
  });
  if (options.secrets) {
    query = query.select(
      '+targetEmailEncrypted +targetEmailHash +codeHash +redactionCodeHashes'
    );
  } else if (options.redactionHashes) {
    query = query.select('+redactionCodeHashes');
  }
  return query.lean();
}

function verificationLeaseDeadline(challenge) {
  if (challenge?.status !== 'verifying') return 0;
  const explicit = new Date(challenge.verificationLeaseUntil || 0).getTime();
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const updatedAt = new Date(challenge.updatedAt || 0).getTime();
  return Number.isFinite(updatedAt)
    ? updatedAt + EMAIL_VERIFICATION_LEASE_SECONDS * 1000
    : 0;
}

function challengeWaitSeconds(challenge, now = Date.now()) {
  const leaseDeadline = verificationLeaseDeadline(challenge);
  if (leaseDeadline > now) {
    return Math.max(1, Math.ceil((leaseDeadline - now) / 1000));
  }
  const resendAt = new Date(challenge?.resendAt || 0).getTime();
  const windowStartedAt = new Date(challenge?.requestWindowStartedAt || 0).getTime();
  const windowEndsAt = windowStartedAt + env.chatEmailCodeWindowSeconds * 1000;
  if (Number(challenge?.requestCount || 0) >= env.chatEmailCodeMaxRequests
    && windowEndsAt > now) {
    return Math.max(1, Math.ceil((windowEndsAt - now) / 1000));
  }
  return resendAt > now ? Math.max(1, Math.ceil((resendAt - now) / 1000)) : 0;
}

function expiredVerificationLeaseFilter(challenge, now) {
  if (challenge?.verificationLeaseUntil) {
    return { verificationLeaseUntil: { $lte: now } };
  }
  return {
    verificationLeaseUntil: { $exists: false },
    updatedAt: {
      $lte: new Date(now.getTime() - EMAIL_VERIFICATION_LEASE_SECONDS * 1000)
    }
  };
}

function preservedRedactionHashes(current, code, expiresAt, now = new Date()) {
  const entries = (current?.redactionCodeHashes || [])
    .filter((entry) => entry?.hash && new Date(entry.expiresAt) > now)
    .map((entry) => ({ hash: entry.hash, expiresAt: entry.expiresAt }));
  const hash = verificationRedactionHash(code);
  const withoutDuplicate = entries.filter((entry) => entry.hash !== hash);
  return [
    ...withoutDuplicate,
    { hash, expiresAt }
  ].slice(-MAX_REDACTION_CODE_HASHES);
}

async function claimEmailChallenge({
  contactId,
  channel,
  email,
  providerEvidence = {}
}) {
  const now = new Date();
  let current = await currentEmailChallenge(contactId, { secrets: true });
  const waitSeconds = challengeWaitSeconds(current, now.getTime());
  if (waitSeconds > 0) return { claimed: false, waitSeconds };

  if (current?.status === 'verifying') {
    const recovered = await ChatEmailChallenge.findOneAndUpdate({
      slotKey: verificationSlotKey(contactId),
      operationId: current.operationId,
      status: 'verifying',
      ...expiredVerificationLeaseFilter(current, now)
    }, {
      $set: { status: 'active' },
      $unset: { verificationLeaseId: 1, verificationLeaseUntil: 1 }
    }, { new: true });
    if (!recovered) {
      const latest = await currentEmailChallenge(contactId);
      return {
        claimed: false,
        waitSeconds: Math.max(
          1,
          challengeWaitSeconds(latest, Date.now()) || EMAIL_VERIFICATION_LEASE_SECONDS
        )
      };
    }
    current = {
      ...current,
      status: 'active',
      verificationLeaseId: null,
      verificationLeaseUntil: null
    };
  }

  const withinWindow = current?.requestWindowStartedAt
    && now.getTime() - new Date(current.requestWindowStartedAt).getTime()
      < env.chatEmailCodeWindowSeconds * 1000;
  const requestCount = withinWindow ? Number(current.requestCount || 0) + 1 : 1;
  if (requestCount > env.chatEmailCodeMaxRequests) {
    const windowEndsAt = new Date(current.requestWindowStartedAt).getTime()
      + env.chatEmailCodeWindowSeconds * 1000;
    return {
      claimed: false,
      waitSeconds: Math.max(1, Math.ceil((windowEndsAt - now.getTime()) / 1000))
    };
  }

  const code = secureVerificationCode();
  const operationId = crypto.randomUUID();
  const slotKey = verificationSlotKey(contactId);
  const resendAt = new Date(now.getTime() + env.chatEmailCodeResendSeconds * 1000);
  const codeExpiresAt = new Date(now.getTime() + env.chatEmailCodeTtlSeconds * 1000);
  const cleanupAt = new Date(now.getTime() + (
    Math.max(env.chatEmailCodeWindowSeconds, env.chatEmailCodeTtlSeconds) + 24 * 60 * 60
  ) * 1000);
  const replacement = {
    contact: contactId,
    sourceChannel: channel,
    operationId,
    targetEmailEncrypted: encrypt(email),
    targetEmailHash: searchHash(email),
    codeHash: verificationCodeHash(operationId, code),
    redactionCodeHashes: preservedRedactionHashes(current, code, cleanupAt, now),
    status: 'pending_delivery',
    attempts: 0,
    maxAttempts: env.chatEmailCodeMaxAttempts,
    resendAt,
    requestWindowStartedAt: withinWindow ? current.requestWindowStartedAt : now,
    requestCount,
    codeExpiresAt,
    cleanupAt,
    consumedAt: null,
    revokedAt: null,
    sentAt: null,
    verificationLeaseId: null,
    verificationLeaseUntil: null,
    ...providerEvidenceHashes(channel, providerEvidence)
  };

  try {
    if (current) {
      const claimed = await ChatEmailChallenge.findOneAndUpdate({
        slotKey,
        operationId: current.operationId,
        resendAt: { $lte: now },
        status: current.status
      }, { $set: replacement }, { new: true });
      if (!claimed) {
        const latest = await currentEmailChallenge(contactId);
        return {
          claimed: false,
          waitSeconds: Math.max(
            1,
            challengeWaitSeconds(latest, Date.now()) || env.chatEmailCodeResendSeconds
          )
        };
      }
    } else {
      await ChatEmailChallenge.create({ slotKey, ...replacement });
    }
  } catch (error) {
    if (error?.code === 11000) {
      const latest = await currentEmailChallenge(contactId);
      return {
        claimed: false,
        waitSeconds: Math.max(
          1,
          challengeWaitSeconds(latest, Date.now()) || env.chatEmailCodeResendSeconds
        )
      };
    }
    throw error;
  }

  return {
    claimed: true,
    code,
    operationId,
    email,
    codeExpiresAt
  };
}

async function deliverEmailChallenge(claim) {
  try {
    await gmailManager.send({
      destination: claim.email,
      allowUnconsented: true,
      useCase: 'chat_email_verification',
      subject: 'Codigo de verificacao do seu email',
      text: [
        `Seu codigo de verificacao no Notify Flow e: ${claim.code}`,
        '',
        `Ele expira em ${Math.ceil(env.chatEmailCodeTtlSeconds / 60)} minutos.`,
        'Se voce nao solicitou esta alteracao, ignore esta mensagem.'
      ].join('\n')
    });
    const sentAt = new Date();
    const activated = await ChatEmailChallenge.updateOne({
      operationId: claim.operationId,
      status: 'pending_delivery'
    }, {
      $set: { status: 'active', sentAt }
    });
    return activated.modifiedCount === 1;
  } catch (_error) {
    await ChatEmailChallenge.updateOne({
      operationId: claim.operationId,
      status: 'pending_delivery'
    }, {
      $set: { status: 'delivery_failed', revokedAt: new Date() }
    }).catch(() => undefined);
    return false;
  }
}

async function beginEmailVerification({
  contactId,
  channel,
  email,
  providerEvidence = {}
}) {
  const claim = await claimEmailChallenge({
    contactId,
    channel,
    email,
    providerEvidence
  });
  if (!claim.claimed) {
    return {
      kind: 'email_verification_rate_limited',
      text: `Um codigo ja foi solicitado. Aguarde ${claim.waitSeconds} segundos para pedir outro.`
    };
  }
  const delivered = await deliverEmailChallenge(claim);
  if (!delivered) {
    return {
      kind: 'email_verification_delivery_failed',
      text: 'Nao consegui enviar o codigo para esse email agora. Aguarde um pouco e envie o endereco novamente.'
    };
  }
  await clearEmailCaptures(contactId);
  return {
    kind: 'email_verification_started',
    text: [
      `Enviei um codigo de 6 digitos para ${claim.email}.`,
      `Responda neste chat com o codigo em ate ${Math.ceil(env.chatEmailCodeTtlSeconds / 60)} minutos.`,
      'Se nao encontrar a mensagem, confira tambem a caixa de spam ou lixo eletronico.',
      `Um novo codigo pode ser solicitado depois de ${Math.ceil(env.chatEmailCodeResendSeconds / 60)} minutos.`,
      'Para cancelar sem alterar seus dados, envie /cancelar.'
    ].join('\n')
  };
}

async function cancelEmailVerification(contactId) {
  const slotKey = verificationSlotKey(contactId);
  const now = new Date();
  const cancelled = await ChatEmailChallenge.updateOne({
    slotKey,
    status: { $in: ['pending_delivery', 'active'] }
  }, {
    $set: { status: 'revoked', revokedAt: now },
    $unset: { verificationLeaseId: 1, verificationLeaseUntil: 1 }
  });
  if (cancelled.modifiedCount === 1) {
    return { cancelled: true, inProgress: false };
  }

  const current = await currentEmailChallenge(contactId);
  if (current?.status !== 'verifying') {
    return { cancelled: false, inProgress: false };
  }
  if (verificationLeaseDeadline(current) > now.getTime()) {
    return { cancelled: false, inProgress: true };
  }

  const staleCancelled = await ChatEmailChallenge.updateOne({
    slotKey,
    operationId: current.operationId,
    status: 'verifying',
    ...expiredVerificationLeaseFilter(current, now)
  }, {
    $set: { status: 'revoked', revokedAt: now },
    $unset: { verificationLeaseId: 1, verificationLeaseUntil: 1 }
  });
  if (staleCancelled.modifiedCount === 1) {
    return { cancelled: true, inProgress: false };
  }

  const latest = await currentEmailChallenge(contactId);
  return {
    cancelled: false,
    inProgress: latest?.status === 'verifying'
      && verificationLeaseDeadline(latest) > Date.now()
  };
}

async function verifyEmailCode({
  contactId,
  channel,
  code,
  providerEvidence = {}
}) {
  const challenge = await currentEmailChallenge(contactId, { secrets: true });
  if (!challenge || !['active', 'verifying'].includes(challenge.status)) {
    return { handled: false };
  }
  const now = new Date();
  if (new Date(challenge.codeExpiresAt) <= now) {
    await ChatEmailChallenge.updateOne({
      operationId: challenge.operationId,
      status: { $in: ['active', 'verifying'] }
    }, {
      $set: { status: 'revoked', revokedAt: now }
    });
    return {
      handled: true,
      kind: 'email_verification_expired',
      text: 'Esse codigo expirou. Envie o endereco de email novamente para receber um novo.'
    };
  }
  const valid = timingSafeEqual(
    challenge.codeHash,
    verificationCodeHash(challenge.operationId, code)
  );
  if (!valid) {
    const updated = await ChatEmailChallenge.findOneAndUpdate({
      operationId: challenge.operationId,
      status: 'active',
      attempts: { $lt: challenge.maxAttempts },
      codeExpiresAt: { $gt: now }
    }, {
      $inc: { attempts: 1 }
    }, { new: true });
    if (!updated) {
      return {
        handled: true,
        kind: 'email_verification_invalid',
        text: 'Codigo invalido ou sem tentativas disponiveis. Envie o email novamente para recomecar.'
      };
    }
    if (updated.attempts >= updated.maxAttempts) {
      await ChatEmailChallenge.updateOne({
        operationId: challenge.operationId,
        status: 'active'
      }, {
        $set: { status: 'revoked', revokedAt: now }
      });
    }
    return {
      handled: true,
      kind: 'email_verification_invalid',
      text: updated.attempts >= updated.maxAttempts
        ? 'Codigo invalido. O limite de tentativas foi atingido; envie o email novamente mais tarde.'
        : 'Codigo invalido. Confira os 6 digitos enviados ao seu email e tente novamente.'
    };
  }

  const verificationLeaseId = crypto.randomUUID();
  const verificationLeaseUntil = new Date(
    now.getTime() + EMAIL_VERIFICATION_LEASE_SECONDS * 1000
  );
  const claimed = challenge.status === 'verifying'
    ? await ChatEmailChallenge.findOneAndUpdate({
      operationId: challenge.operationId,
      status: 'verifying',
      codeExpiresAt: { $gt: now },
      codeHash: challenge.codeHash,
      ...expiredVerificationLeaseFilter(challenge, now)
    }, {
      $set: { verificationLeaseId, verificationLeaseUntil }
    }, { new: true })
    : await ChatEmailChallenge.findOneAndUpdate({
      operationId: challenge.operationId,
      status: 'active',
      attempts: { $lt: challenge.maxAttempts },
      codeExpiresAt: { $gt: now },
      codeHash: challenge.codeHash
    }, {
      $set: {
        status: 'verifying',
        verificationLeaseId,
        verificationLeaseUntil
      },
      $inc: { attempts: 1 }
    }, { new: true });
  if (!claimed) {
    return {
      handled: true,
      kind: challenge.status === 'verifying'
        ? 'email_verification_in_progress'
        : 'email_verification_invalid',
      text: challenge.status === 'verifying'
        ? 'A verificacao desse email ja esta sendo concluida. Aguarde alguns instantes.'
        : 'Esse codigo nao esta mais disponivel. Envie o email novamente para recomecar.'
    };
  }

  const leaseConfirmedAt = new Date();
  const leaseConfirmedUntil = new Date(
    leaseConfirmedAt.getTime() + EMAIL_VERIFICATION_LEASE_SECONDS * 1000
  );
  const leaseConfirmed = await ChatEmailChallenge.updateOne({
    operationId: challenge.operationId,
    status: 'verifying',
    verificationLeaseId,
    verificationLeaseUntil: { $gt: leaseConfirmedAt }
  }, {
    $set: { verificationLeaseUntil: leaseConfirmedUntil }
  });
  if (leaseConfirmed.modifiedCount !== 1) {
    return {
      handled: true,
      kind: 'email_verification_in_progress',
      text: 'A verificacao mudou enquanto era processada. Envie o email novamente se precisar.'
    };
  }

  const email = decrypt(challenge.targetEmailEncrypted);
  try {
    const contact = await contactsManager.setEmailFromChat(contactId, email, {
      channel,
      operationId: challenge.operationId,
      verificationMethod: 'chat_email_code',
      ...providerEvidence
    });
    await ChatEmailChallenge.updateOne({
      operationId: challenge.operationId,
      status: 'verifying',
      verificationLeaseId
    }, {
      $set: { status: 'consumed', consumedAt: new Date() },
      $unset: { verificationLeaseId: 1, verificationLeaseUntil: 1 }
    }).catch(() => undefined);
    await clearEmailCaptures(contactId);
    return {
      handled: true,
      kind: 'email_updated',
      contact,
      text: `Email ${contact.email} verificado, salvo e autorizado para receber notificacoes. Voce pode revogar essa permissao quando quiser no Meu perfil.`
    };
  } catch (error) {
    const ownershipConflict = [
      'DUPLICATE_CONTACT',
      'DUPLICATE_CONTACT_IDENTIFIER',
      'EMAIL_OWNERSHIP_VERIFICATION_REQUIRED'
    ].includes(error.code);
    await ChatEmailChallenge.updateOne({
      operationId: challenge.operationId,
      status: 'verifying',
      verificationLeaseId
    }, {
      $set: ownershipConflict
        ? { status: 'revoked', revokedAt: new Date() }
        : { status: 'active' },
      $unset: { verificationLeaseId: 1, verificationLeaseUntil: 1 }
    }).catch(() => undefined);
    if (ownershipConflict) {
      return {
        handled: true,
        kind: 'email_conflict',
        errorCode: error.code,
        text: 'Esse email ja esta vinculado a outro perfil. Para proteger seus dados, a alteracao nao foi aplicada.'
      };
    }
    return {
      handled: true,
      kind: 'email_update_failed',
      errorCode: error.code || 'EMAIL_UPDATE_FAILED',
      text: 'O email foi validado, mas nao consegui salvar a alteracao agora. Tente o mesmo codigo novamente em instantes.'
    };
  }
}

function pruneLocalCaptures(now = Date.now()) {
  for (const [key, state] of localCaptures.entries()) {
    if (!state || state.expiresAt <= now) localCaptures.delete(key);
  }
}

async function beginEmailCapture(contactId, channel) {
  const key = captureKey(contactId, channel);
  const state = {
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + EMAIL_CAPTURE_TTL_SECONDS * 1000,
    operationId: crypto.randomUUID()
  };
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(key, JSON.stringify(state), { EX: EMAIL_CAPTURE_TTL_SECONDS });
      localCaptures.delete(key);
      return state;
    } catch (_error) {
      // A captura e apenas uma conveniencia de conversa; o fallback local
      // evita interromper o webhook quando o Redis oscila.
    }
  }
  pruneLocalCaptures();
  localCaptures.set(key, state);
  return state;
}

async function emailCaptureState(contactId, channel) {
  const key = captureKey(contactId, channel);
  const redis = getRedis();
  if (redis) {
    try {
      const value = await redis.get(key);
      if (value) {
        const state = JSON.parse(value);
        return Number(state.expiresAt) > Date.now() ? state : null;
      }
    } catch (_error) {
      // Continua pelo fallback local.
    }
  }
  pruneLocalCaptures();
  return localCaptures.get(key) || null;
}

async function pendingEmailCapture(contactId, channel) {
  return Boolean(await emailCaptureState(contactId, channel));
}

async function clearEmailCapture(contactId, channel) {
  const key = captureKey(contactId, channel);
  localCaptures.delete(key);
  const redis = getRedis();
  if (redis) {
    try { await redis.del(key); } catch (_error) { /* sem efeito na entrega do webhook */ }
  }
}

async function clearEmailCaptures(contactId) {
  await Promise.all(
    [...EMAIL_CAPTURE_CHANNELS].map((channel) => clearEmailCapture(contactId, channel))
  );
}

function emailCapturePrompt() {
  return [
    'Quer cadastrar ou atualizar seu email?',
    'Responda apenas com um endereço válido, por exemplo: nome@exemplo.com.',
    'A permissão pode ser revogada quando quiser no Meu perfil.',
  ].join('\n');
}

function permissionLabel(identity) {
  if (!identity) return 'nao vinculado';
  return identity.authorized && identity.consentStatus === 'granted'
    ? 'permitido'
    : identity.consentStatus === 'revoked'
      ? 'desativado'
      : identity.consentStatus === 'denied'
        ? 'negado'
        : 'aguardando permissao';
}

function effectiveChannelIdentity(identities, channel) {
  const matching = (identities || []).filter((identity) => identity.channel === channel);
  const granted = matching.find((identity) => (
    identity.authorized && identity.consentStatus === 'granted'
  ));
  if (granted) return granted;
  return [...matching].sort((left, right) => (
    new Date(right.consentChangedAt || right.interactedAt || 0)
      - new Date(left.consentChangedAt || left.interactedAt || 0)
  ))[0];
}

function profileSummary(contact, profileUrl) {
  const identities = contact.channels || [];
  const lines = [
    'Seus dados no Notify Flow',
    '',
    `Nome: ${contact.displayName || 'nao informado'}`,
    `Email: ${contact.email || 'nao informado'}`,
    `Telefone: ${contact.phone ? `+${String(contact.phone).replace(/^\+/, '')}` : 'nao informado'}`,
    `Telegram: ${contact.telegramUsername ? `@${String(contact.telegramUsername).replace(/^@/, '')}` : 'nao informado'}`,
    '',
    'Permissoes de notificacao:',
    `WhatsApp: ${permissionLabel(effectiveChannelIdentity(identities, 'whatsapp_cloud'))}`,
    `Telegram: ${permissionLabel(effectiveChannelIdentity(identities, 'telegram'))}`,
    `Email: ${permissionLabel(effectiveChannelIdentity(identities, 'email'))}`,
    '',
    'Por seguranca, somente o email pode ser cadastrado ou atualizado por este chat.'
  ];
  if (profileUrl) lines.push(`Edite os demais dados e permissoes em: ${profileUrl}`);
  else lines.push('O link do Meu perfil ainda nao esta disponivel. Tente novamente mais tarde.');
  return lines.join('\n');
}

function exactCommand(text, command, channel) {
  const candidate = String(text || '').normalize('NFKC').trim().toLocaleLowerCase('pt-BR');
  const expected = String(command || '').normalize('NFKC').trim().toLocaleLowerCase('pt-BR');
  if (candidate === expected) return true;
  if (channel !== 'telegram' || expected.includes(' ')) return false;
  return candidate.startsWith(`${expected}@`)
    && /^[a-z0-9_]{3,32}$/i.test(candidate.slice(expected.length + 1));
}

async function handleInbound({ contactId, channel, text, profileUrl, providerEvidence = {} }) {
  const normalizedText = String(text || '').normalize('NFKC').trim();
  if (!normalizedText) return { handled: false };
  const safeChannel = normalizedChannel(channel);

  if (exactCommand(normalizedText, chatCommands.FIXED_CHAT_COMMANDS.help, safeChannel)) {
    const permissionCommands = await settingsManager.getValidatedPermissionCommands()
      .catch(() => ({}));
    return {
      handled: true,
      kind: 'help',
      text: chatCommands.helpMessage(safeChannel, permissionCommands)
    };
  }

  if (exactCommand(normalizedText, '/meu-perfil', safeChannel)) {
    const contact = await contactsManager.getById(contactId);
    return {
      handled: true,
      kind: 'profile',
      text: profileSummary(contact, profileUrl)
    };
  }

  if (exactCommand(normalizedText, '/cancelar', safeChannel)) {
    await clearEmailCaptures(contactId);
    const cancellation = await cancelEmailVerification(contactId);
    if (cancellation.inProgress) {
      return {
        handled: true,
        kind: 'email_verification_in_progress',
        text: 'A verificacao desse email ja esta sendo concluida. Aguarde alguns instantes antes de tentar outra alteracao.'
      };
    }
    return {
      handled: true,
      kind: 'email_cancelled',
      text: 'Atualizacao de email cancelada. Nenhum dado foi alterado.'
    };
  }

  // Comandos do bot sempre permanecem reservados para seus fluxos proprios.
  if (normalizedText.startsWith('/')) return { handled: false };

  const emailCandidates = extractEmailCandidates(normalizedText);
  if (emailCandidates.length > 1) {
    return {
      handled: true,
      kind: 'email_ambiguous',
      text: 'Encontrei mais de um email. Envie apenas um endereco por vez para fazer a verificacao.'
    };
  }
  if (emailCandidates.length === 1) {
    const verification = await beginEmailVerification({
      contactId,
      channel: safeChannel,
      email: emailCandidates[0],
      providerEvidence
    });
    return { handled: true, ...verification };
  }

  if (/^\d{6}$/.test(normalizedText)) {
    const verification = await verifyEmailCode({
      contactId,
      channel: safeChannel,
      code: normalizedText,
      providerEvidence
    });
    if (verification.handled) return verification;
  }

  const pending = await emailCaptureState(contactId, channel);
  if (!pending) return { handled: false };

  return {
    handled: true,
    kind: 'email_invalid',
    text: 'Esse email nao parece valido. Envie no formato nome@exemplo.com ou use /cancelar.'
  };
}

async function shouldRedactEmailVerificationCode(contactId, text) {
  const candidate = String(text || '').normalize('NFKC').trim();
  if (!/^\d{6}$/.test(candidate)) return false;
  const challenge = await currentEmailChallenge(contactId, { redactionHashes: true });
  if (!challenge) return false;
  const candidateHash = verificationRedactionHash(candidate);
  const now = Date.now();
  return (challenge.redactionCodeHashes || []).some((entry) => (
    new Date(entry.expiresAt).getTime() > now
    && timingSafeEqual(entry.hash, candidateHash)
  ));
}

async function safeInboundText(contactId, text) {
  return await shouldRedactEmailVerificationCode(contactId, text)
    ? EMAIL_VERIFICATION_CODE_PLACEHOLDER
    : text;
}

function resetLocalStateForTests() {
  localCaptures.clear();
}

module.exports = {
  EMAIL_CAPTURE_TTL_SECONDS,
  beginEmailCapture,
  emailCaptureState,
  pendingEmailCapture,
  clearEmailCapture,
  clearEmailCaptures,
  emailCapturePrompt,
  profileSummary,
  chatHelpMessage: chatCommands.helpMessage,
  handleInbound,
  beginEmailVerification,
  verifyEmailCode,
  shouldRedactEmailVerificationCode,
  safeInboundText,
  EMAIL_VERIFICATION_CODE_PLACEHOLDER,
  resetLocalStateForTests
};
