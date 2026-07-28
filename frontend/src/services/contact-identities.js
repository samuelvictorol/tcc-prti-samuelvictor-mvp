const CHANNEL_META = Object.freeze({
  telegram: Object.freeze({ label: 'Telegram', icon: 'send_to_mobile', color: 'info' }),
  whatsapp_cloud: Object.freeze({ label: 'WhatsApp Cloud', icon: 'cloud_sync', color: 'positive' }),
  email: Object.freeze({ label: 'Email', icon: 'mail', color: 'grey-7' }),
})

const AUTOMATIC_SOURCE_LABELS = Object.freeze({
  telegram_webhook: 'Telegram',
  telegram_write_access_allowed: 'Telegram',
  telegram_start: 'Telegram',
  whatsapp_cloud_webhook: 'WhatsApp Cloud',
  whatsapp_cloud_permission_command: 'WhatsApp Cloud',
})

export function normalizeContactChannel(value) {
  return String(value || '').trim().toLowerCase().replaceAll('-', '_')
}

export function contactChannelMeta(channel) {
  const normalized = normalizeContactChannel(channel)
  return CHANNEL_META[normalized] || { label: normalized || 'Canal', icon: 'badge', color: 'grey-7' }
}

export function contactIdentity(contact = {}, channel) {
  const normalized = normalizeContactChannel(channel)
  return (Array.isArray(contact?.channels) ? contact.channels : [])
    .find((identity) => normalizeContactChannel(identity?.channel) === normalized) || null
}

export function pendingWhatsappConsent(contact = {}, channel) {
  const normalized = normalizeContactChannel(channel)
  if (normalized !== 'whatsapp_cloud') return null
  return (Array.isArray(contact?.pendingWhatsappConsents) ? contact.pendingWhatsappConsents : [])
    .find((pending) => normalizeContactChannel(pending?.channel) === normalized
      && (!pending?.status || pending.status === 'granted')) || null
}

function usable(value) {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

function metadataValue(metadata, ...keys) {
  for (const key of keys) {
    const value = usable(metadata?.[key])
    if (value) return value
  }
  return ''
}

function addIdentifier(items, key, label, value) {
  const normalized = usable(value)
  if (!normalized) return
  items.push({ key, label, value: normalized })
}

export function identityIdentifiers(identity = {}) {
  if (!identity || typeof identity === 'string') return []
  const channel = normalizeContactChannel(identity.channel)
  const metadata = identity.metadata || {}
  const address = usable(identity.address)
  const items = []

  addIdentifier(items, 'address', 'ID principal', address)

  if (channel === 'telegram') {
    const chatId = metadataValue(metadata, 'chatId', 'chat_id', 'groupChatId', 'group_chat_id') || address
    const userId = metadataValue(metadata, 'userId', 'user_id', 'senderId', 'sender_id') || address
    addIdentifier(items, 'chatId', 'chat_id', chatId)
    addIdentifier(items, 'userId', 'user_id', userId)
  } else if (channel === 'whatsapp_cloud') {
    addIdentifier(items, 'waId', 'wa_id', metadataValue(metadata, 'waId', 'wa_id') || address)
    addIdentifier(items, 'userId', 'user_id', metadataValue(metadata, 'userId', 'user_id', 'fromUserId', 'from_user_id'))
    addIdentifier(items, 'phoneNumberId', 'phone_number_id', metadataValue(metadata, 'phoneNumberId', 'phone_number_id'))
  }

  return items
}

export function isAutomaticIdentity(identity = {}) {
  if (!identity || typeof identity === 'string') return false
  if (usable(identity.metadata?.autoRegisteredVia || identity.metadata?.auto_registered_via)) return true
  const source = usable(identity.source).toLowerCase()
  if (!source || source === 'manual') return false
  return /(webhook|permission|message|start|write_access|inbound|auto|group)/.test(source)
}

export function identityRegistrationSource(identity = {}) {
  const channel = normalizeContactChannel(identity?.channel)
  const source = usable(identity?.source).toLowerCase()
  const metadataSource = normalizeContactChannel(
    identity?.metadata?.autoRegisteredVia || identity?.metadata?.auto_registered_via,
  )
  const resolvedChannel = CHANNEL_META[metadataSource] ? metadataSource : channel
  const label = AUTOMATIC_SOURCE_LABELS[source] || contactChannelMeta(resolvedChannel).label
  return {
    automatic: isAutomaticIdentity(identity),
    channel: resolvedChannel,
    label,
    source: source || 'manual',
  }
}

export function identityConsentProvenance(identity = {}) {
  const metadata = identity?.metadata || {}
  const consent = identity?.consent || identity?.authorization || {}
  const source = usable(
    identity?.consentSource
      || consent.source
      || metadata.consentSource
      || metadata.consent_source
      || identity?.source,
  ).toLowerCase()
  const command = usable(
    identity?.consentCommand
      || consent.command
      || metadata.consentCommand
      || metadata.consent_command
      || metadata.permissionCommand
      || metadata.permission_command,
  )
  const changedAt = identity?.consentChangedAt
    || consent.changedAt
    || metadata.consentChangedAt
    || metadata.consent_changed_at
    || identity?.consentedAt
    || null
  const changedByAdmin = Boolean(
    identity?.consentChangedByAdmin
      || consent.changedByAdmin
      || metadata.consentChangedByAdmin
      || metadata.consent_changed_by_admin
      || /(^|_)(admin|manual)(_|$)/.test(source),
  )
  const automaticCommand = Boolean(
    command
      || metadata.permissionCommandReceived
      || metadata.permission_command_received
      || source.includes('permission_command'),
  )
  const permissionChannel = normalizeContactChannel(
    identity?.consentCommandChannel
      || consent.commandChannel
      || consent.channel
      || metadata.permissionCommandReceivedVia
      || metadata.permission_command_received_via
      || metadata.consentCommandChannel
      || metadata.consent_command_channel
      || metadata.permissionChannel
      || metadata.permission_channel
      || (/whatsapp_cloud_permission_command/.test(usable(identity?.source).toLowerCase()) ? 'whatsapp_cloud' : ''),
  )
  const permissionChannelLabel = permissionChannel === 'whatsapp_cloud'
    ? contactChannelMeta(permissionChannel).label
    : ''
  const automaticLabel = `Autorizado automaticamente${command ? ` via ${command}` : ' via comando'}${permissionChannelLabel ? ` recebido pelo ${permissionChannelLabel}` : ''}`

  return {
    source: source || 'unknown',
    command,
    permissionChannel,
    permissionChannelLabel,
    changedAt,
    changedByAdmin,
    automaticCommand,
    label: changedByAdmin
      ? 'Alterado por último pelo administrador'
      : automaticCommand
        ? automaticLabel
        : 'Sem registro de autorização automática',
  }
}

export function automaticRegistrationSources(contact = {}) {
  const sources = new Set()
  for (const identity of Array.isArray(contact?.channels) ? contact.channels : []) {
    const registration = identityRegistrationSource(identity)
    if (registration.automatic) sources.add(registration.label)
  }
  return [...sources]
}

export function contactIdentitySummaries(contact = {}) {
  return (Array.isArray(contact?.channels) ? contact.channels : [])
    .filter((identity) => identity && typeof identity !== 'string')
    .map((identity) => ({
      identity,
      channel: normalizeContactChannel(identity.channel),
      ...contactChannelMeta(identity.channel),
      identifiers: identityIdentifiers(identity),
      registration: identityRegistrationSource(identity),
    }))
}
