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

module.exports = { normalizeEmail, normalizePhone, normalizeTelegramUsername, normalizeSearch, escapeRegex };
