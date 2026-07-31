const path = require('node:path');
const crypto = require('node:crypto');
const dotenv = require('dotenv');
const { isSafePublicHttpsUrl } = require('../utils/urls');

dotenv.config({ path: process.env.DOTENV_PATH || path.resolve(process.cwd(), '.env') });

const number = (name, fallback) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const boolean = (name, fallback = false) => {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const csv = (name, fallback = []) => {
  if (!process.env[name]) return fallback;
  return process.env[name].split(',').map((item) => item.trim()).filter(Boolean);
};

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: number('PORT', 3000),
  apiPrefix: process.env.API_PREFIX || '/api',
  publicAppUrl: process.env.PUBLIC_APP_URL || 'http://localhost:9000',
  corsOrigins: csv('CORS_ORIGINS', ['http://localhost:9000']),
  trustProxy: number('TRUST_PROXY', 1),
  cookieSecure: boolean('COOKIE_SECURE', String(process.env.PUBLIC_APP_URL || '').startsWith('https://')),
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/notify_app',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  redisRequired: boolean('REDIS_REQUIRED'),
  createIndexes: boolean('MONGODB_ENSURE_INDEXES', boolean('CREATE_INDEXES', true)),
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || 'development-access-secret-change-me-now',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'development-refresh-secret-change-me-now',
  jwtAccessTtl: process.env.JWT_ACCESS_TTL || '15m',
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL || '30d',
  encryptionKey: process.env.ENCRYPTION_KEY || 'development-encryption-key-change-me',
  searchHashKey: process.env.SEARCH_HASH_KEY || 'development-search-key-change-me-now',
  inviteTokenSecret: process.env.INVITE_TOKEN_SECRET || 'development-invite-key-change-me-now',
  rateLimitWindowMs: number('RATE_LIMIT_WINDOW_MS', 60_000),
  rateLimitMax: number('RATE_LIMIT_MAX', 120),
  webhookRateLimitMax: number('WEBHOOK_RATE_LIMIT_MAX', 20_000),
  mediaRateLimitMax: number('MEDIA_RATE_LIMIT_MAX', 20_000),
  authRateLimitMax: number('AUTH_RATE_LIMIT_MAX', 10),
  ipBlockAfter: number('IP_BLOCK_AFTER', 20),
  ipBlockSeconds: number('IP_BLOCK_SECONDS', 900),
  conversationBackupRetentionDays: Math.min(
    3650,
    Math.max(30, Math.trunc(number('CONVERSATION_BACKUP_RETENTION_DAYS', 90)))
  ),
  whatsappCloudApiVersion: process.env.WHATSAPP_CLOUD_API_VERSION || 'v25.0',
  startNotifyWhatsappPermission: process.env.START_NOTIFY_WHATSAPP_PERMISSION || '/notify-me',
  startVerifyTelegramPermission: process.env.START_VERIFY_TELEGRAM_PERMISSION || '/verify-me'
};

// Segredo com separacao de dominio: mesmo sem uma variavel adicional, tokens
// de contato nunca compartilham literalmente a chave dos administradores.
env.profileJwtSecret = process.env.PROFILE_JWT_SECRET || crypto.createHmac('sha256', env.jwtAccessSecret)
  .update('notify-app:contact-profile:' + env.searchHashKey)
  .digest('hex');
env.profileJwtTtl = process.env.PROFILE_JWT_TTL || '10m';
env.profileCodeTtlSeconds = number('PROFILE_CODE_TTL_SECONDS', 600);
env.profileCodeMaxAttempts = number('PROFILE_CODE_MAX_ATTEMPTS', 5);
env.profileCodeMaxRequests = number('PROFILE_CODE_MAX_REQUESTS', 5);
env.profileCodeWindowSeconds = number('PROFILE_CODE_WINDOW_SECONDS', 3600);
env.profileCodeResendSeconds = number('PROFILE_CODE_RESEND_SECONDS', 30);
env.chatEmailCodeTtlSeconds = Math.max(
  60,
  Math.trunc(number('CHAT_EMAIL_CODE_TTL_SECONDS', 15 * 60))
);
env.chatEmailCodeResendSeconds = Math.max(
  2 * 60,
  Math.trunc(number('CHAT_EMAIL_CODE_RESEND_SECONDS', 2 * 60))
);
env.chatEmailCodeMaxAttempts = Math.max(
  1,
  Math.trunc(number('CHAT_EMAIL_CODE_MAX_ATTEMPTS', 5))
);
env.chatEmailCodeMaxRequests = Math.max(
  1,
  Math.trunc(number('CHAT_EMAIL_CODE_MAX_REQUESTS', 5))
);
env.chatEmailCodeWindowSeconds = Math.max(
  env.chatEmailCodeResendSeconds,
  Math.trunc(number('CHAT_EMAIL_CODE_WINDOW_SECONDS', 60 * 60))
);
env.profileLinkTtlSeconds = Math.min(
  7 * 24 * 60 * 60,
  Math.max(60, Math.trunc(number('PROFILE_LINK_TTL_SECONDS', 7 * 24 * 60 * 60)))
);
env.profileSessionTtlSeconds = Math.min(
  7 * 24 * 60 * 60,
  Math.max(60, Math.trunc(number('PROFILE_SESSION_TTL_SECONDS', 7 * 24 * 60 * 60)))
);
env.telegramBotUsername = process.env.TELEGRAM_BOT_USERNAME || null;
env.whatsappCloudDisplayPhoneNumber = process.env.WHATSAPP_CLOUD_DISPLAY_PHONE_NUMBER || null;
env.mediaPublicBaseUrl = String(process.env.MEDIA_PUBLIC_BASE_URL || env.publicAppUrl).replace(/\/+$/, '');
env.mediaSigningSecret = process.env.MEDIA_SIGNING_SECRET || crypto.createHmac('sha256', env.inviteTokenSecret)
  .update('notify-app:template-media-signing:v1')
  .digest('hex');

const productionRequired = [
  ['JWT_ACCESS_SECRET', env.jwtAccessSecret],
  ['JWT_REFRESH_SECRET', env.jwtRefreshSecret],
  ['ENCRYPTION_KEY', env.encryptionKey],
  ['SEARCH_HASH_KEY', env.searchHashKey],
  ['INVITE_TOKEN_SECRET', env.inviteTokenSecret]
];

function validateEnv() {
  if (env.nodeEnv !== 'production') return;
  if (!isSafePublicHttpsUrl(env.mediaPublicBaseUrl)) {
    throw new Error('MEDIA_PUBLIC_BASE_URL (ou PUBLIC_APP_URL) deve ser uma URL HTTPS publica em producao');
  }
  if (process.env.MEDIA_SIGNING_SECRET && String(process.env.MEDIA_SIGNING_SECRET).length < 32) {
    throw new Error('MEDIA_SIGNING_SECRET deve possuir ao menos 32 caracteres em producao');
  }
  const unsafeMarkers = ['development', 'change-me', 'replace-with', 'notify-dev', 'dev-secret'];
  const unsafe = productionRequired.filter(([, value]) => {
    const candidate = String(value || '');
    const normalized = candidate.toLowerCase();
    return candidate.length < 32 || unsafeMarkers.some((marker) => normalized.includes(marker));
  });
  if (unsafe.length) {
    throw new Error('Segredos de producao ausentes ou inseguros: ' + unsafe.map(([name]) => name).join(', '));
  }
  if (new Set(productionRequired.map(([, value]) => value)).size !== productionRequired.length) {
    throw new Error('Cada segredo de producao deve possuir um valor independente');
  }
  const admins = configuredAdmins();
  if (!admins.length) throw new Error('Configure ao menos um par ADMINn_EMAIL/ADMINn_PASSWORD');
  const unsafeAdmins = admins.filter((admin) => {
    const password = admin.password.toLowerCase();
    return admin.password.length < 12 || unsafeMarkers.some((marker) => password.includes(marker)) || password.includes('changeme');
  });
  if (unsafeAdmins.length) {
    throw new Error('Senha administrativa ausente ou insegura: ' + unsafeAdmins.map((admin) => 'ADMIN' + admin.sourceIndex + '_PASSWORD').join(', '));
  }
}

function configuredAdmins() {
  const indexes = Object.keys(process.env)
    .map((key) => /^ADMIN(\d+)_EMAIL$/.exec(key))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);

  return indexes.map((index) => ({
    email: String(process.env['ADMIN' + index + '_EMAIL'] || '').trim().toLowerCase(),
    password: String(process.env['ADMIN' + index + '_PASSWORD'] || ''),
    sourceIndex: index
  })).filter((admin) => admin.email && admin.password);
}

module.exports = { env, validateEnv, configuredAdmins };
