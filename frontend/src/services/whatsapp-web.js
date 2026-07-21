export const DEFAULT_WHATSAPP_PERMISSION_COMMAND = '/notify-me'

function valueOf(payload = {}) {
  return payload?.data?.data ?? payload?.data ?? payload ?? {}
}

export function normalizeWhatsappWebStatus(payload = {}, previous = {}) {
  const value = { ...previous, ...valueOf(payload) }
  const state = String(value.state || value.status || (value.ready ? 'ready' : 'disconnected')).toLowerCase()
  const ready = Boolean(value.ready || value.connected || value.authenticated || state === 'ready')
  const attemptActive = !ready && Boolean(
    value.attemptActive
    || ['initializing', 'connecting', 'qr', 'authenticated'].includes(state),
  )

  return {
    ...value,
    configured: Boolean(value.configured ?? value.initialized ?? ready),
    initialized: Boolean(value.initialized ?? value.configured ?? ready),
    ready,
    state: ready ? 'ready' : state,
    qrCode: ready ? '' : String(value.qrCode || value.dataUrl || ''),
    attemptActive,
    updatedAt: value.updatedAt || new Date().toISOString(),
  }
}

export function whatsappPermissionCommandFromSettings(payload = {}) {
  const value = valueOf(payload)
  const configuration = value.configuration || value.settings || value
  const command = configuration.whatsappPermission?.command
    || configuration.whatsapp_permission?.command
    || configuration.whatsappWeb?.permissionCommand
    || configuration.whatsapp_web?.permissionCommand
    || configuration.whatsappCloud?.permissionCommand
    || configuration.whatsapp_cloud?.permissionCommand

  return String(command || DEFAULT_WHATSAPP_PERMISSION_COMMAND).trim() || DEFAULT_WHATSAPP_PERMISSION_COMMAND
}

export function isWhatsappWebLog(log = {}) {
  const context = log.context || log.metadata || {}
  const candidates = [
    log.channel,
    log.provider,
    log.source,
    log.event,
    log.title,
    log.message,
    context.channel,
    context.provider,
    context.source,
  ]
  const text = candidates.filter(Boolean).join(' ').toLowerCase()
  return /whatsapp[ _-]?web|\bwweb\b/.test(text)
}

export function shouldShowOperationalLog(log, whatsappWebReady) {
  return !isWhatsappWebLog(log) || Boolean(whatsappWebReady)
}
