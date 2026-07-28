const crypto = require('node:crypto');
const { z } = require('zod');
const contactsManager = require('../managers/contacts.manager');
const { getRedis } = require('./redis.service');

const EMAIL_CAPTURE_TTL_SECONDS = 15 * 60;
const EMAIL_CAPTURE_CHANNELS = new Set(['telegram', 'whatsapp_cloud']);
const emailSchema = z.string().trim().email().max(254);
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

function pruneLocalCaptures(now = Date.now()) {
  for (const [key, state] of localCaptures.entries()) {
    if (!state || state.expiresAt <= now) localCaptures.delete(key);
  }
}

async function beginEmailCapture(contactId, channel) {
  const key = captureKey(contactId, channel);
  const state = {
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + EMAIL_CAPTURE_TTL_SECONDS * 1000
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

async function pendingEmailCapture(contactId, channel) {
  const key = captureKey(contactId, channel);
  const redis = getRedis();
  if (redis) {
    try {
      const value = await redis.get(key);
      if (value) {
        const state = JSON.parse(value);
        return Number(state.expiresAt) > Date.now();
      }
    } catch (_error) {
      // Continua pelo fallback local.
    }
  }
  pruneLocalCaptures();
  return Boolean(localCaptures.get(key));
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
    'Responda apenas com um endereco valido, por exemplo: nome@exemplo.com.',
    'Para sair sem alterar, envie /cancelar.'
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

function exactCommand(text, command) {
  return String(text || '').normalize('NFKC').trim().toLocaleLowerCase('pt-BR')
    === String(command).toLocaleLowerCase('pt-BR');
}

async function handleInbound({ contactId, channel, text, profileUrl }) {
  const normalizedText = String(text || '').normalize('NFKC').trim();
  if (!normalizedText) return { handled: false };

  if (exactCommand(normalizedText, '/meu-perfil')) {
    const contact = await contactsManager.getById(contactId);
    return {
      handled: true,
      kind: 'profile',
      text: profileSummary(contact, profileUrl)
    };
  }

  if (exactCommand(normalizedText, '/cancelar')) {
    await clearEmailCaptures(contactId);
    return {
      handled: true,
      kind: 'email_cancelled',
      text: 'Atualizacao de email cancelada. Nenhum dado foi alterado.'
    };
  }

  const pending = await pendingEmailCapture(contactId, channel);
  if (!pending) return { handled: false };

  // Outros comandos continuam sendo tratados pelo fluxo principal do bot.
  if (normalizedText.startsWith('/')) return { handled: false };

  const parsed = emailSchema.safeParse(normalizedText);
  if (!parsed.success) {
    return {
      handled: true,
      kind: 'email_invalid',
      text: 'Esse email nao parece valido. Envie no formato nome@exemplo.com ou use /cancelar.'
    };
  }

  try {
    const contact = await contactsManager.setEmailFromChat(contactId, parsed.data, { channel });
    await clearEmailCaptures(contactId);
    return {
      handled: true,
      kind: 'email_updated',
      contact,
      text: `Email atualizado com sucesso para ${contact.email}. A permissao de notificacoes por email continua separada e pode ser ajustada no Meu perfil.`
    };
  } catch (error) {
    if ([
      'DUPLICATE_CONTACT',
      'DUPLICATE_CONTACT_IDENTIFIER',
      'EMAIL_OWNERSHIP_VERIFICATION_REQUIRED'
    ].includes(error.code)) {
      return {
        handled: true,
        kind: 'email_conflict',
        errorCode: error.code,
        text: 'Esse email ja pertence a outro perfil. Para proteger seus dados, faca a vinculacao pelo Meu perfil usando o codigo de acesso.'
      };
    }
    throw error;
  }
}

function resetLocalStateForTests() {
  localCaptures.clear();
}

module.exports = {
  EMAIL_CAPTURE_TTL_SECONDS,
  beginEmailCapture,
  pendingEmailCapture,
  clearEmailCapture,
  clearEmailCaptures,
  emailCapturePrompt,
  profileSummary,
  handleInbound,
  resetLocalStateForTests
};
