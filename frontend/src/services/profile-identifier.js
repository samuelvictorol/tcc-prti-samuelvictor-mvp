const BRAZIL_COUNTRY_CODE = '55'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '')
}

function brazilianNationalDigits(value) {
  const digits = digitsOnly(value)
  if (/^55\d{10,11}$/.test(digits)) return digits.slice(2)
  return digits
}

export function formatBrazilianProfilePhone(value) {
  const digits = brazilianNationalDigits(value).slice(0, 11)
  if (!digits) return ''
  if (digits.length < 3) return `(${digits}`

  const areaCode = digits.slice(0, 2)
  const subscriber = digits.slice(2)
  if (subscriber.length <= 4) return `(${areaCode}) ${subscriber}`

  if (subscriber.length === 9) {
    return `(${areaCode}) ${subscriber.slice(0, 1)} ${subscriber.slice(1, 5)}-${subscriber.slice(5)}`
  }

  const prefix = subscriber.slice(0, -4)
  const suffix = subscriber.slice(-4)
  return `(${areaCode}) ${prefix}-${suffix}`
}

export function updateBrazilianProfilePhoneInput(value, previousValue = '') {
  const raw = previousValue
    ? rawValueAfterPhoneEdit(value, previousValue)
    : String(value ?? '')

  return formatBrazilianProfilePhone(raw)
}

function inferMode(value) {
  const raw = String(value ?? '')
  if (!raw) return 'auto'
  const digits = digitsOnly(raw)
  if (digits.length > 11 && !/^55\d{10,11}$/.test(digits)) return 'email'

  const compact = raw.replace(/\s/g, '')
  const canonicalPhone = formatBrazilianProfilePhone(digits).replace(/\s/g, '')
  return compact === digits
    || compact === canonicalPhone
    || /^55\d{10,11}$/.test(digits)
    ? 'phone'
    : 'email'
}

function rawValueAfterPhoneEdit(value, previousValue) {
  const next = String(value ?? '')
  const previous = String(previousValue ?? '')
  if (!previous) return next

  let prefixLength = 0
  while (
    prefixLength < previous.length
    && prefixLength < next.length
    && previous[prefixLength] === next[prefixLength]
  ) prefixLength += 1

  let suffixLength = 0
  while (
    suffixLength < previous.length - prefixLength
    && suffixLength < next.length - prefixLength
    && previous[previous.length - 1 - suffixLength] === next[next.length - 1 - suffixLength]
  ) suffixLength += 1

  const previousDigits = digitsOnly(previous)
  const rawStart = digitsOnly(previous.slice(0, prefixLength)).length
  const removedEnd = previous.length - suffixLength
  const removedDigits = digitsOnly(previous.slice(prefixLength, removedEnd)).length
  const insertedEnd = next.length - suffixLength
  const inserted = next.slice(prefixLength, insertedEnd)

  return previousDigits.slice(0, rawStart)
    + inserted
    + previousDigits.slice(rawStart + removedDigits)
}

export function updateProfileIdentifierInput(value, previousMode = 'auto', previousValue = '') {
  const raw = String(value ?? '')
  const mode = inferMode(raw)

  if (mode === 'auto') return { mode, value: '' }
  if (mode === 'phone') {
    return { mode, value: formatBrazilianProfilePhone(raw) }
  }

  return {
    mode,
    // Reconstrói o valor bruto a partir da edição, descartando somente a
    // apresentação anterior do telefone. O texto inserido nunca é truncado.
    value: previousMode === 'phone' ? rawValueAfterPhoneEdit(raw, previousValue) : raw,
  }
}

export function profileIdentifierRule(value, mode = inferMode(value)) {
  const raw = String(value ?? '').trim()
  if (mode === 'phone') {
    return [10, 11].includes(brazilianNationalDigits(raw).length)
      || 'Digite um telefone com DDD, por exemplo (11) 93123-4567'
  }
  if (mode === 'email') {
    return EMAIL_PATTERN.test(raw) || 'Digite um email válido'
  }
  return 'Informe seu email ou telefone'
}

export function normalizeProfileIdentifierForRequest(value, mode = inferMode(value)) {
  const raw = String(value ?? '').trim()
  if (mode !== 'phone') return raw
  const rawDigits = digitsOnly(raw)
  if (/^55\d{10,11}$/.test(rawDigits)) return rawDigits
  const nationalNumber = brazilianNationalDigits(raw)
  return `${BRAZIL_COUNTRY_CODE}${nationalNumber}`
}
