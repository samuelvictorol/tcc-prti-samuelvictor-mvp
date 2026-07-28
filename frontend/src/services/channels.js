export const channelCredentialFields = Object.freeze({
  telegram: ['botToken', 'webhookSecret'],
  whatsappCloud: ['accessToken', 'phoneNumberId', 'displayPhoneNumber', 'businessAccountId', 'verifyToken', 'appSecret', 'apiVersion'],
  email: ['user', 'from', 'fromName', 'appPassword'],
})

export function isMaskedSecret(value) {
  if (typeof value !== 'string') return false
  const normalized = value.trim()
  return normalized.includes('••••') || /^\*{4,}$/.test(normalized)
}

export function generateSecureWebhookSecret(cryptoApi = globalThis.crypto, byteLength = 32) {
  if (!cryptoApi?.getRandomValues) throw new Error('Geração segura indisponível neste navegador.')
  if (!Number.isInteger(byteLength) || byteLength < 16 || byteLength > 128) {
    throw new Error('Tamanho inválido para o segredo seguro.')
  }
  const bytes = new Uint8Array(byteLength)
  cryptoApi.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function channelCredentialPreviews(channel, configuration = {}) {
  const allowed = channelCredentialFields[channel] || []
  const previews = configuration?.previews || {}
  return Object.fromEntries(allowed.map((key) => [key, String(previews[key] || '')]))
}

export function mergeRevealedChannelValues(channel, revealed = {}, current = {}) {
  const allowed = channelCredentialFields[channel] || []
  return Object.fromEntries(allowed.map((key) => {
    const draft = current?.[key]
    const hasDraft = typeof draft === 'string' && draft.trim() && !isMaskedSecret(draft)
    return [key, hasDraft ? draft : String(revealed?.[key] ?? '')]
  }))
}

export function compactChannelSettings(channel, values = {}, baseline = {}) {
  const allowed = channelCredentialFields[channel] || []
  return Object.fromEntries(allowed.flatMap((key) => {
    const value = values?.[key]
    if (value === undefined || value === null) return []
    if (typeof value === 'string') {
      const normalized = value.trim()
      if (!normalized || isMaskedSecret(normalized)) return []
      if (String(baseline?.[key] ?? '').trim() === normalized) return []
      return [[key, normalized]]
    }
    if (baseline?.[key] === value) return []
    return [[key, value]]
  }))
}

export function channelSettingsPayload(channel, values, baseline = {}) {
  const settings = compactChannelSettings(channel, values, baseline)
  return Object.keys(settings).length ? { [channel]: settings } : null
}

export function normalizeTelegramWebhookUrl(value) {
  let url
  try {
    url = new URL(String(value || '').trim())
  } catch {
    throw new Error('Informe uma URL pública HTTPS válida.')
  }
  if (url.protocol !== 'https:') throw new Error('O webhook do Telegram precisa usar HTTPS.')
  if (url.pathname === '/' || !url.pathname) url.pathname = '/api/webhooks/telegram'
  url.hash = ''
  return url.toString()
}

export function notificationChannel(kind, selectedChannel) {
  return kind === 'global' ? 'global' : selectedChannel
}

export function sendsToAllAvailableChannels(kind, _selectedChannel) {
  return kind === 'global'
}

export function notificationDeliveryCounts(result = {}) {
  const deliveries = Array.isArray(result.deliveries) ? result.deliveries : []
  const queuedFallback = deliveries.filter((delivery) => ['queued', 'processing'].includes(delivery?.status)).length
  const skippedFallback = deliveries.filter((delivery) => delivery?.status === 'skipped').length
  const queuedValue = result.queuedCount ?? result.summary?.queued ?? (deliveries.length ? queuedFallback : undefined)
  const skippedValue = result.skippedCount ?? result.summary?.skipped ?? (deliveries.length ? skippedFallback : 0)
  return {
    queued: queuedValue === undefined ? undefined : Number(queuedValue),
    skipped: Number(skippedValue || 0),
  }
}
