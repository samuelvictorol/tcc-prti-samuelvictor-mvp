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

function isSafePublicHttpsUrl(value) {
  try {
    const url = new URL(String(value));
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (url.protocol !== 'https:' || !hostname || url.username || url.password) return false;
    if (url.port && url.port !== '443') return false;
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return false;
    const ipVersion = net.isIP(hostname);
    if (ipVersion === 4 && isPrivateIpv4(hostname)) return false;
    if (ipVersion === 6 && (hostname === '::1' || hostname === '::' || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe8') || hostname.startsWith('fe9') || hostname.startsWith('fea') || hostname.startsWith('feb'))) return false;
    return true;
  } catch (_error) {
    return false;
  }
}

module.exports = { ALLOWED_INVITE_PROTOCOLS, isAllowedInviteUrl, isSafePublicHttpsUrl };
