const Setting = require('../models/setting.model');
const { encrypt, decrypt } = require('../services/crypto.service');
const ApiError = require('../utils/api-error');

const DEFINITIONS = Object.freeze({
  TELEGRAM_BOT_TOKEN: { sensitive: true, channel: 'telegram' },
  TELEGRAM_WEBHOOK_SECRET: { sensitive: true, channel: 'telegram' },
  GMAIL_USER: { sensitive: false, channel: 'email' },
  GMAIL_APP_PASSWORD: { sensitive: true, channel: 'email' },
  GMAIL_FROM: { sensitive: false, channel: 'email' },
  GMAIL_FROM_NAME: { sensitive: false, channel: 'email' },
  WHATSAPP_CLOUD_ACCESS_TOKEN: { sensitive: true, channel: 'whatsapp_cloud' },
  WHATSAPP_CLOUD_PHONE_NUMBER_ID: { sensitive: true, channel: 'whatsapp_cloud' },
  WHATSAPP_CLOUD_DISPLAY_PHONE_NUMBER: { sensitive: false, channel: 'whatsapp_cloud' },
  WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID: { sensitive: false, channel: 'whatsapp_cloud' },
  WHATSAPP_CLOUD_VERIFY_TOKEN: { sensitive: true, channel: 'whatsapp_cloud' },
  WHATSAPP_CLOUD_APP_SECRET: { sensitive: true, channel: 'whatsapp_cloud' },
  WHATSAPP_CLOUD_API_VERSION: { sensitive: false, channel: 'whatsapp_cloud' },
  WHATSAPP_CLOUD_CONSENT_REQUEST_TEXT: { sensitive: false, channel: 'whatsapp_cloud' },
  START_NOTIFY_WHATSAPP_PERMISSION: { sensitive: false, channel: 'whatsapp' },
  START_VERIFY_TELEGRAM_PERMISSION: { sensitive: false, channel: 'telegram' }
});

const REQUIRED = Object.freeze({
  telegram: ['TELEGRAM_BOT_TOKEN'],
  email: ['GMAIL_USER', 'GMAIL_APP_PASSWORD', 'GMAIL_FROM'],
  whatsapp_cloud: ['WHATSAPP_CLOUD_ACCESS_TOKEN', 'WHATSAPP_CLOUD_PHONE_NUMBER_ID']
});

const SENSITIVE_PREVIEW = '••••••••••••';

const DEFAULT_WHATSAPP_CLOUD_CONSENT_REQUEST_TEXT = 'Para ativar suas notificações, responda com {command}.';
const RESERVED_CHAT_COMMANDS = new Set([
  '/gerar-codigo',
  '/meu-perfil',
  '/cancelar',
  '/stop',
  '/start'
]);

function unwrapConfiguredValue(value) {
  let normalized = String(value ?? '').trim();
  if (normalized.length >= 2) {
    const first = normalized[0];
    const last = normalized.at(-1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      normalized = normalized.slice(1, -1).trim();
    }
  }
  return normalized;
}

const CHANNEL_REVEAL_FIELDS = Object.freeze({
  telegram: Object.freeze({
    botToken: 'TELEGRAM_BOT_TOKEN'
  }),
  whatsappCloud: Object.freeze({
    accessToken: 'WHATSAPP_CLOUD_ACCESS_TOKEN',
    phoneNumberId: 'WHATSAPP_CLOUD_PHONE_NUMBER_ID',
    displayPhoneNumber: 'WHATSAPP_CLOUD_DISPLAY_PHONE_NUMBER',
    businessAccountId: 'WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID',
    verifyToken: 'WHATSAPP_CLOUD_VERIFY_TOKEN',
    appSecret: 'WHATSAPP_CLOUD_APP_SECRET',
    apiVersion: 'WHATSAPP_CLOUD_API_VERSION'
  }),
  email: Object.freeze({
    user: 'GMAIL_USER',
    from: 'GMAIL_FROM',
    fromName: 'GMAIL_FROM_NAME',
    appPassword: 'GMAIL_APP_PASSWORD'
  })
});

function maskedPreview(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  if (normalized.length <= 4) return '••••••••';
  const visibleStart = Math.min(3, Math.max(1, Math.floor(normalized.length / 4)));
  const visibleEnd = Math.min(4, Math.max(1, Math.floor(normalized.length / 4)));
  return `${normalized.slice(0, visibleStart)}••••••••${normalized.slice(-visibleEnd)}`;
}

function isMaskedSentinel(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return /[•*]{4,}/u.test(normalized) || /^\[?(?:redacted|masked)\]?$/i.test(normalized);
}

function assertWritableValue(key, value, config) {
  if (config.sensitive && isMaskedSentinel(value)) {
    throw new ApiError(
      422,
      'Valor mascarado nao pode substituir uma credencial sensivel',
      { key },
      'MASKED_SECRET_NOT_ALLOWED'
    );
  }
  if (key === 'WHATSAPP_CLOUD_CONSENT_REQUEST_TEXT') {
    const normalized = String(value || '').trim();
    if (!normalized || normalized.length > 1000 || !normalized.includes('{command}')) {
      throw new ApiError(
        422,
        'O texto deve ter ate 1000 caracteres e incluir o marcador {command}',
        { key },
        'WHATSAPP_CONSENT_REQUEST_TEXT_INVALID'
      );
    }
  }
}

function assertPermissionCommand(value) {
  const normalized = normalizeWhatsappPermissionText(value);
  const reserved = RESERVED_CHAT_COMMANDS.has(normalized)
    || normalized.startsWith('/start@')
    || normalized.startsWith('/stop@');
  if (reserved) {
    throw new ApiError(
      422,
      'Escolha um comando diferente dos comandos reservados de perfil e autenticacao',
      { command: normalized },
      'PERMISSION_COMMAND_RESERVED'
    );
  }
  return normalized;
}

async function validatePermissionCommandChange(key, value) {
  if (!['START_NOTIFY_WHATSAPP_PERMISSION', 'START_VERIFY_TELEGRAM_PERMISSION'].includes(key)) return;
  const normalized = assertPermissionCommand(value);
  const otherKey = key === 'START_NOTIFY_WHATSAPP_PERMISSION'
    ? 'START_VERIFY_TELEGRAM_PERMISSION'
    : 'START_NOTIFY_WHATSAPP_PERMISSION';
  const fallback = otherKey === 'START_NOTIFY_WHATSAPP_PERMISSION' ? '/notify-me' : '/verify-me';
  const other = normalizeWhatsappPermissionText(await getValue(otherKey) || fallback);
  if (normalized === other) {
    throw new ApiError(
      422,
      'Os comandos de permissao do WhatsApp e Telegram devem ser diferentes',
      { command: normalized },
      'PERMISSION_COMMAND_COLLISION'
    );
  }
}

function revealFields(channel) {
  const fields = CHANNEL_REVEAL_FIELDS[channel];
  if (!fields) {
    throw new ApiError(400, 'Canal de configuracao desconhecido', {
      allowedChannels: Object.keys(CHANNEL_REVEAL_FIELDS)
    }, 'SETTING_CHANNEL_NOT_ALLOWED');
  }
  return fields;
}

function definition(key) {
  const normalized = String(key).toUpperCase();
  if (!DEFINITIONS[normalized]) throw new ApiError(400, 'Configuracao nao permitida: ' + normalized, null, 'SETTING_NOT_ALLOWED');
  return [normalized, DEFINITIONS[normalized]];
}

async function getValue(key) {
  const normalized = String(key).toUpperCase();
  const stored = await Setting.findOne({ key: normalized }).select('+valueEncrypted').lean();
  if (stored) return decrypt(stored.valueEncrypted);
  return process.env[normalized] || null;
}

async function setValue(key, value, actorId, options = {}) {
  const [normalized, config] = definition(key);
  if (config.internal && !options.internal) throw new ApiError(403, 'Configuracao reservada');
  assertWritableValue(normalized, value, config);
  if (!options.skipPermissionValidation) {
    await validatePermissionCommandChange(normalized, value);
  }
  await Setting.updateOne({ key: normalized }, {
    $set: {
      valueEncrypted: encrypt(String(value)),
      sensitive: options.sensitive ?? config.sensitive,
      updatedBy: actorId
    }
  }, { upsert: true });
  return { key: normalized, configured: true, sensitive: options.sensitive ?? config.sensitive, source: 'runtime' };
}

async function remove(key) {
  const [normalized, config] = definition(key);
  if (config.internal) throw new ApiError(403, 'Configuracao reservada');
  await Setting.deleteOne({ key: normalized });
  return { key: normalized, removed: true, envFallback: Boolean(process.env[normalized]) };
}

async function list() {
  const stored = await Setting.find({}).select('+valueEncrypted').lean();
  const byKey = new Map(stored.map((item) => [item.key, item]));
  return Object.entries(DEFINITIONS).filter(([, config]) => !config.internal).map(([key, config]) => {
    const runtime = byKey.get(key);
    const configured = Boolean(runtime || process.env[key]);
    const readableValue = configured && !config.sensitive
      ? (runtime ? decrypt(runtime.valueEncrypted) : process.env[key])
      : null;
    return {
      key,
      channel: config.channel,
      sensitive: config.sensitive,
      configured,
      source: runtime ? 'runtime' : process.env[key] ? 'environment' : null,
      preview: configured && config.sensitive ? SENSITIVE_PREVIEW : maskedPreview(readableValue),
      value: configured && !config.sensitive ? readableValue : undefined
    };
  });
}

async function revealChannel(channel) {
  const fields = revealFields(channel);
  const entries = await Promise.all(Object.entries(fields).map(async ([field, key]) => {
    const value = await getValue(key);
    return value === null || value === undefined || value === '' ? null : [field, String(value)];
  }));
  return {
    channel,
    values: Object.fromEntries(entries.filter(Boolean))
  };
}

async function channelConfigured(channel) {
  const required = REQUIRED[channel];
  if (!required) throw new ApiError(400, 'Canal desconhecido');
  const values = await Promise.all(required.map(getValue));
  if (channel === 'whatsapp_cloud') {
    const accessToken = unwrapConfiguredValue(values[0]).replace(/^Bearer\s+/i, '').trim();
    const phoneNumberId = unwrapConfiguredValue(values[1]);
    const version = unwrapConfiguredValue(
      await getValue('WHATSAPP_CLOUD_API_VERSION')
      || process.env.WHATSAPP_CLOUD_API_VERSION
      || 'v25.0'
    );
    return Boolean(accessToken && /^\d{5,30}$/.test(phoneNumberId) && /^v\d+\.\d+$/.test(version));
  }
  return required.every((_key, index) => Boolean(unwrapConfiguredValue(values[index])));
}

async function statuses() {
  const base = {};
  for (const channel of Object.keys(REQUIRED)) {
    base[channel] = { configured: await channelConfigured(channel) };
  }
  return base;
}

async function setBulk(input, actorId) {
  const mapping = {
    'telegram.botToken': 'TELEGRAM_BOT_TOKEN',
    'telegram.webhookSecret': 'TELEGRAM_WEBHOOK_SECRET',
    'whatsappCloud.accessToken': 'WHATSAPP_CLOUD_ACCESS_TOKEN',
    'whatsappCloud.phoneNumberId': 'WHATSAPP_CLOUD_PHONE_NUMBER_ID',
    'whatsappCloud.displayPhoneNumber': 'WHATSAPP_CLOUD_DISPLAY_PHONE_NUMBER',
    'whatsappCloud.businessAccountId': 'WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID',
    'whatsappCloud.verifyToken': 'WHATSAPP_CLOUD_VERIFY_TOKEN',
    'whatsappCloud.appSecret': 'WHATSAPP_CLOUD_APP_SECRET',
    'whatsappCloud.apiVersion': 'WHATSAPP_CLOUD_API_VERSION',
    'whatsappPermission.command': 'START_NOTIFY_WHATSAPP_PERMISSION',
    'whatsappPermission.requestText': 'WHATSAPP_CLOUD_CONSENT_REQUEST_TEXT',
    'telegramPermission.command': 'START_VERIFY_TELEGRAM_PERMISSION',
    'email.user': 'GMAIL_USER',
    'email.from': 'GMAIL_FROM',
    'email.fromName': 'GMAIL_FROM_NAME',
    'email.appPassword': 'GMAIL_APP_PASSWORD'
  };
  const pending = [];
  for (const [path, key] of Object.entries(mapping)) {
    const value = path.split('.').reduce((current, part) => current?.[part], input);
    if (value === undefined || value === null || value === '') continue;
    const [normalized, config] = definition(key);
    assertWritableValue(normalized, value, config);
    pending.push({ key: normalized, value });
  }
  const pendingCommands = Object.fromEntries(
    pending
      .filter((item) => ['START_NOTIFY_WHATSAPP_PERMISSION', 'START_VERIFY_TELEGRAM_PERMISSION'].includes(item.key))
      .map((item) => [item.key, item.value])
  );
  if (Object.keys(pendingCommands).length) {
    const [storedWhatsapp, storedTelegram] = await Promise.all([
      getValue('START_NOTIFY_WHATSAPP_PERMISSION'),
      getValue('START_VERIFY_TELEGRAM_PERMISSION')
    ]);
    const whatsappCommand = assertPermissionCommand(
      pendingCommands.START_NOTIFY_WHATSAPP_PERMISSION || storedWhatsapp || '/notify-me'
    );
    const telegramCommand = assertPermissionCommand(
      pendingCommands.START_VERIFY_TELEGRAM_PERMISSION || storedTelegram || '/verify-me'
    );
    if (whatsappCommand === telegramCommand) {
      throw new ApiError(
        422,
        'Os comandos de permissao do WhatsApp e Telegram devem ser diferentes',
        { command: whatsappCommand },
        'PERMISSION_COMMAND_COLLISION'
      );
    }
  }
  const updated = [];
  for (const item of pending) {
    updated.push(await setValue(item.key, item.value, actorId, { skipPermissionValidation: true }));
  }
  return { updated: updated.map((item) => item.key), configuration: await getStructured() };
}

async function getStructured() {
  const [items, channelStatuses] = await Promise.all([list(), statuses()]);
  const values = Object.fromEntries(items.map((item) => [item.key, item]));
  const previewsFor = (channel) => Object.fromEntries(
    Object.entries(revealFields(channel))
      .map(([field, key]) => [field, values[key]?.preview || null])
  );
  const permissionCommand = values.START_NOTIFY_WHATSAPP_PERMISSION?.value
    || process.env.START_NOTIFY_WHATSAPP_PERMISSION
    || '/notify-me';
  const telegramPermissionCommand = values.START_VERIFY_TELEGRAM_PERMISSION?.value
    || process.env.START_VERIFY_TELEGRAM_PERMISSION
    || '/verify-me';
  const whatsappConsentRequestText = values.WHATSAPP_CLOUD_CONSENT_REQUEST_TEXT?.value
    || process.env.WHATSAPP_CLOUD_CONSENT_REQUEST_TEXT
    || DEFAULT_WHATSAPP_CLOUD_CONSENT_REQUEST_TEXT;
  return {
    telegram: {
      configured: channelStatuses.telegram.configured,
      botTokenConfigured: values.TELEGRAM_BOT_TOKEN?.configured || false,
      webhookSecretConfigured: values.TELEGRAM_WEBHOOK_SECRET?.configured || false,
      previews: previewsFor('telegram'),
      permissionCommand: telegramPermissionCommand
    },
    telegramPermission: { command: telegramPermissionCommand },
    whatsappPermission: {
      command: permissionCommand,
      requestText: whatsappConsentRequestText
    },
    whatsappCloud: {
      configured: channelStatuses.whatsapp_cloud.configured,
      sendConfigured: channelStatuses.whatsapp_cloud.configured,
      accessTokenConfigured: values.WHATSAPP_CLOUD_ACCESS_TOKEN?.configured || false,
      phoneNumberIdConfigured: values.WHATSAPP_CLOUD_PHONE_NUMBER_ID?.configured || false,
      displayPhoneNumber: values.WHATSAPP_CLOUD_DISPLAY_PHONE_NUMBER?.value || null,
      businessAccountId: values.WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID?.value || null,
      verifyTokenConfigured: values.WHATSAPP_CLOUD_VERIFY_TOKEN?.configured || false,
      appSecretConfigured: values.WHATSAPP_CLOUD_APP_SECRET?.configured || false,
      webhookVerificationConfigured: values.WHATSAPP_CLOUD_VERIFY_TOKEN?.configured || false,
      webhookSignatureConfigured: values.WHATSAPP_CLOUD_APP_SECRET?.configured || false,
      webhookConfigured: Boolean(values.WHATSAPP_CLOUD_VERIFY_TOKEN?.configured && values.WHATSAPP_CLOUD_APP_SECRET?.configured),
      apiVersion: values.WHATSAPP_CLOUD_API_VERSION?.value || process.env.WHATSAPP_CLOUD_API_VERSION || null,
      previews: previewsFor('whatsappCloud'),
      permissionCommand
    },
    email: {
      configured: channelStatuses.email.configured,
      user: values.GMAIL_USER?.value || null,
      from: values.GMAIL_FROM?.value || null,
      fromName: values.GMAIL_FROM_NAME?.value || null,
      appPasswordConfigured: values.GMAIL_APP_PASSWORD?.configured || false,
      previews: previewsFor('email')
    },
    items
  };
}

function normalizeWhatsappPermissionText(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
}

async function getWhatsappPermissionCommand() {
  const commands = await getValidatedPermissionCommands();
  return commands.whatsapp;
}

async function isWhatsappPermissionCommand(value) {
  const command = await getWhatsappPermissionCommand();
  return Boolean(command) && normalizeWhatsappPermissionText(value) === normalizeWhatsappPermissionText(command);
}

async function getWhatsappConsentRequestText() {
  const configured = await module.exports.getValue('WHATSAPP_CLOUD_CONSENT_REQUEST_TEXT');
  return String(
    configured
    || process.env.WHATSAPP_CLOUD_CONSENT_REQUEST_TEXT
    || DEFAULT_WHATSAPP_CLOUD_CONSENT_REQUEST_TEXT
  ).trim();
}

async function getTelegramPermissionCommand() {
  const commands = await getValidatedPermissionCommands();
  return commands.telegram;
}

async function getValidatedPermissionCommands() {
  const [configuredWhatsapp, configuredTelegram] = await Promise.all([
    module.exports.getValue('START_NOTIFY_WHATSAPP_PERMISSION'),
    module.exports.getValue('START_VERIFY_TELEGRAM_PERMISSION')
  ]);
  const whatsapp = assertPermissionCommand(
    configuredWhatsapp || process.env.START_NOTIFY_WHATSAPP_PERMISSION || '/notify-me'
  );
  const telegram = assertPermissionCommand(
    configuredTelegram || process.env.START_VERIFY_TELEGRAM_PERMISSION || '/verify-me'
  );
  if (whatsapp === telegram) {
    throw new ApiError(
      503,
      'Os comandos de permissao do WhatsApp e Telegram devem ser diferentes',
      { command: whatsapp },
      'PERMISSION_COMMAND_COLLISION'
    );
  }
  return { whatsapp, telegram };
}

async function isTelegramPermissionCommand(value) {
  const command = await getTelegramPermissionCommand();
  return Boolean(command) && normalizeWhatsappPermissionText(value) === normalizeWhatsappPermissionText(command);
}

module.exports = {
  DEFINITIONS, getValue, setValue, remove, list, setBulk, getStructured, channelConfigured, statuses,
  getWhatsappPermissionCommand, isWhatsappPermissionCommand, getTelegramPermissionCommand,
  getWhatsappConsentRequestText, isTelegramPermissionCommand, normalizeWhatsappPermissionText, CHANNEL_REVEAL_FIELDS,
  DEFAULT_WHATSAPP_CLOUD_CONSENT_REQUEST_TEXT, RESERVED_CHAT_COMMANDS, getValidatedPermissionCommands,
  SENSITIVE_PREVIEW, maskedPreview, isMaskedSentinel, revealChannel
};
