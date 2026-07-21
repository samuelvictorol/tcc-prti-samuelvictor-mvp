const editableSettings = Object.freeze({
  telegram: ['botToken', 'webhookSecret'],
  whatsappWeb: ['sessionTtlDays'],
  whatsappCloud: ['accessToken', 'phoneNumberId', 'businessAccountId', 'verifyToken', 'appSecret', 'apiVersion'],
  email: ['user', 'from', 'fromName', 'appPassword'],
})

export function isMaskedSecret(value) {
  if (typeof value !== 'string') return false
  const normalized = value.trim()
  return normalized.includes('••••') || /^\*{4,}$/.test(normalized)
}

export function compactChannelSettings(channel, values = {}) {
  const allowed = editableSettings[channel] || []
  return Object.fromEntries(allowed.flatMap((key) => {
    const value = values?.[key]
    if (value === undefined || value === null) return []
    if (typeof value === 'string') {
      const normalized = value.trim()
      if (!normalized || isMaskedSecret(normalized)) return []
      return [[key, normalized]]
    }
    return [[key, value]]
  }))
}

export function channelSettingsPayload(channel, values) {
  const settings = compactChannelSettings(channel, values)
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

export function sendsToAllAvailableChannels(kind, selectedChannel) {
  return kind === 'global' || (kind === 'quick' && selectedChannel === 'global')
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
