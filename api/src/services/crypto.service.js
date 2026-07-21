const crypto = require('node:crypto');
const { env } = require('../config/env');

const VERSION = 'enc:v1';
const key = crypto.createHash('sha256').update(env.encryptionKey).digest();

function encrypt(value) {
  if (value === undefined || value === null || value === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = typeof value === 'string' ? value : JSON.stringify(value);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
}

function decrypt(value, options = {}) {
  if (!value) return null;
  if (!String(value).startsWith(VERSION + ':')) return value;
  const parts = String(value).split(':');
  if (parts.length !== 5) throw new Error('Conteudo criptografado invalido');
  const iv = Buffer.from(parts[2], 'base64url');
  const tag = Buffer.from(parts[3], 'base64url');
  const encrypted = Buffer.from(parts[4], 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const result = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  if (!options.json) return result;
  return JSON.parse(result);
}

function searchHash(value) {
  if (value === undefined || value === null || value === '') return null;
  return crypto.createHmac('sha256', env.searchHashKey).update(String(value)).digest('hex');
}

function tokenHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { encrypt, decrypt, searchHash, tokenHash, timingSafeEqual };
