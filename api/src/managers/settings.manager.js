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
  WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID: { sensitive: false, channel: 'whatsapp_cloud' },
  WHATSAPP_CLOUD_VERIFY_TOKEN: { sensitive: true, channel: 'whatsapp_cloud' },
  WHATSAPP_CLOUD_APP_SECRET: { sensitive: true, channel: 'whatsapp_cloud' },
  WHATSAPP_CLOUD_API_VERSION: { sensitive: false, channel: 'whatsapp_cloud' },
  WHATSAPP_WEB_AUTHENTICATED_AT: { sensitive: true, internal: true },
  WHATSAPP_WEB_SESSION_MAX_AGE_DAYS: { sensitive: false, channel: 'whatsapp_web' }
});

const REQUIRED = Object.freeze({
  telegram: ['TELEGRAM_BOT_TOKEN'],
  email: ['GMAIL_USER', 'GMAIL_APP_PASSWORD', 'GMAIL_FROM'],
  whatsapp_cloud: ['WHATSAPP_CLOUD_ACCESS_TOKEN', 'WHATSAPP_CLOUD_PHONE_NUMBER_ID', 'WHATSAPP_CLOUD_VERIFY_TOKEN', 'WHATSAPP_CLOUD_APP_SECRET'],
  whatsapp_web: []
});

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
    return {
      key,
      channel: config.channel,
      sensitive: config.sensitive,
      configured,
      source: runtime ? 'runtime' : process.env[key] ? 'environment' : null,
      value: configured && !config.sensitive ? (runtime ? decrypt(runtime.valueEncrypted) : process.env[key]) : undefined
    };
  });
}

async function channelConfigured(channel) {
  const required = REQUIRED[channel];
  if (!required) throw new ApiError(400, 'Canal desconhecido');
  const values = await Promise.all(required.map(getValue));
  return required.every((_key, index) => Boolean(values[index]));
}

async function statuses() {
  const base = {};
  for (const channel of Object.keys(REQUIRED)) {
    base[channel] = { configured: await channelConfigured(channel) };
  }
  try {
    const whatsappWeb = require('./whatsapp-web.manager');
    base.whatsapp_web = { ...base.whatsapp_web, ...(await whatsappWeb.status()) };
  } catch (_error) {
    base.whatsapp_web = { configured: true, ready: false, state: 'not_initialized' };
  }
  return base;
}

async function setBulk(input, actorId) {
  const mapping = {
    'telegram.botToken': 'TELEGRAM_BOT_TOKEN',
    'telegram.webhookSecret': 'TELEGRAM_WEBHOOK_SECRET',
    'whatsappWeb.sessionTtlDays': 'WHATSAPP_WEB_SESSION_MAX_AGE_DAYS',
    'whatsappCloud.accessToken': 'WHATSAPP_CLOUD_ACCESS_TOKEN',
    'whatsappCloud.phoneNumberId': 'WHATSAPP_CLOUD_PHONE_NUMBER_ID',
    'whatsappCloud.businessAccountId': 'WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID',
    'whatsappCloud.verifyToken': 'WHATSAPP_CLOUD_VERIFY_TOKEN',
    'whatsappCloud.appSecret': 'WHATSAPP_CLOUD_APP_SECRET',
    'whatsappCloud.apiVersion': 'WHATSAPP_CLOUD_API_VERSION',
    'email.user': 'GMAIL_USER',
    'email.from': 'GMAIL_FROM',
    'email.fromName': 'GMAIL_FROM_NAME',
    'email.appPassword': 'GMAIL_APP_PASSWORD'
  };
  const updated = [];
  for (const [path, key] of Object.entries(mapping)) {
    const value = path.split('.').reduce((current, part) => current?.[part], input);
    if (value === undefined || value === null || value === '') continue;
    updated.push(await setValue(key, value, actorId));
  }
  return { updated: updated.map((item) => item.key), configuration: await getStructured() };
}

async function getStructured() {
  const [items, channelStatuses] = await Promise.all([list(), statuses()]);
  const values = Object.fromEntries(items.map((item) => [item.key, item]));
  return {
    telegram: { configured: channelStatuses.telegram.configured, botTokenConfigured: values.TELEGRAM_BOT_TOKEN?.configured || false, webhookSecretConfigured: values.TELEGRAM_WEBHOOK_SECRET?.configured || false },
    whatsappWeb: { ...channelStatuses.whatsapp_web, sessionTtlDays: Number(values.WHATSAPP_WEB_SESSION_MAX_AGE_DAYS?.value || process.env.WHATSAPP_WEB_SESSION_MAX_AGE_DAYS || 90) },
    whatsappCloud: {
      configured: channelStatuses.whatsapp_cloud.configured,
      accessTokenConfigured: values.WHATSAPP_CLOUD_ACCESS_TOKEN?.configured || false,
      phoneNumberIdConfigured: values.WHATSAPP_CLOUD_PHONE_NUMBER_ID?.configured || false,
      businessAccountId: values.WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID?.value || null,
      verifyTokenConfigured: values.WHATSAPP_CLOUD_VERIFY_TOKEN?.configured || false,
      appSecretConfigured: values.WHATSAPP_CLOUD_APP_SECRET?.configured || false,
      apiVersion: values.WHATSAPP_CLOUD_API_VERSION?.value || process.env.WHATSAPP_CLOUD_API_VERSION || null
    },
    email: {
      configured: channelStatuses.email.configured,
      user: values.GMAIL_USER?.value || null,
      from: values.GMAIL_FROM?.value || null,
      fromName: values.GMAIL_FROM_NAME?.value || null,
      appPasswordConfigured: values.GMAIL_APP_PASSWORD?.configured || false
    },
    items
  };
}

module.exports = { DEFINITIONS, getValue, setValue, remove, list, setBulk, getStructured, channelConfigured, statuses };
