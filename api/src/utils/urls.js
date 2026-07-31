const net = require('node:net');

const ALLOWED_INVITE_PROTOCOLS = new Set(['http:', 'https:', 'tg:', 'mailto:', 'whatsapp:']);

function isAllowedInviteUrl(value) {
  try {
    const url = new URL(String(value));
    if (!ALLOWED_INVITE_PROTOCOLS.has(url.protocol)) return false;
    if (['http:', 'https:'].includes(url.protocol) && !url.hostname) return false;
    return true;
  } catch (_error) {
    return false;
  }
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] >= 224;
}

function isPrivateIpv6(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb')
    || normalized.startsWith('2001:db8:')
    || normalized.startsWith('::ffff:127.')
    || normalized.startsWith('::ffff:10.')
    || normalized.startsWith('::ffff:169.254.')
    || normalized.startsWith('::ffff:172.')
    || normalized.startsWith('::ffff:192.168.');
}

function hasSafePublicHostname(url) {
  const hostname = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (!hostname || url.username || url.password) return false;
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || hostname.endsWith('.lan')
  ) return false;
  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4 && isPrivateIpv4(hostname)) return false;
  if (ipVersion === 6 && isPrivateIpv6(hostname)) return false;
  if (ipVersion === 0 && !hostname.includes('.')) return false;
  return true;
}

function isSafeExternalHttpUrl(value) {
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    return hasSafePublicHostname(url);
  } catch (_error) {
    return false;
  }
}

function isSafePublicHttpsUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:') return false;
    if (url.port && url.port !== '443') return false;
    return hasSafePublicHostname(url);
  } catch (_error) {
    return false;
  }
}

module.exports = {
  ALLOWED_INVITE_PROTOCOLS,
  isAllowedInviteUrl,
  isSafeExternalHttpUrl,
  isSafePublicHttpsUrl
};
