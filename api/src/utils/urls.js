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

module.exports = { ALLOWED_INVITE_PROTOCOLS, isAllowedInviteUrl };
