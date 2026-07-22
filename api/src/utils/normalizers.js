function normalizeEmail(value) {
  return value ? String(value).trim().toLowerCase() : null;
}

function normalizePhone(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const plus = raw.startsWith('+') ? '+' : '';
  const digits = raw.replace(/\D/g, '');
  return digits ? plus + digits : null;
}

function whatsappLidDigits(value) {
  const match = /^([1-9]\d{7,})@lid$/i.exec(String(value || '').trim());
  return match ? match[1] : null;
}

function normalizeWhatsappE164(value, options = {}) {
  if (!value) return null;
  let raw = String(value).trim();
  if (/@lid$/i.test(raw)) return null;
  const jid = /^([1-9]\d{7,})@(c\.us|s\.whatsapp\.net)$/i.exec(raw);
  if (jid) raw = jid[1];
  else if (!/^[+\d\s().-]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, '');
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  const blocked = new Set((options.blockedIdentifiers || [])
    .map((item) => String(item || '').replace(/\D/g, ''))
    .filter(Boolean));
  return blocked.has(digits) ? null : digits;
}

function normalizeTelegramUsername(value) {
  if (!value) return null;
  return String(value).trim().replace(/^@/, '').toLowerCase() || null;
}

function normalizeSearch(value) {
  return value ? String(value).trim().toLocaleLowerCase('pt-BR') : null;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  normalizeEmail,
  normalizePhone,
  normalizeWhatsappE164,
  whatsappLidDigits,
  normalizeTelegramUsername,
  normalizeSearch,
  escapeRegex
};
