export function recordId(record = {}) {
  return record.id || record._id || null
}

export function channelIdentity(contact = {}, channel) {
  const normalizedChannel = String(channel || '').replaceAll('-', '_')
  return (contact.channels || []).find(
    (identity) => String(identity.channel || '').replaceAll('-', '_') === normalizedChannel,
  ) || null
}

export function contactIneligibility(contact = {}, channel) {
  const identity = channelIdentity(contact, channel)
  if (!identity) return `Sem identidade de ${channel === 'email' ? 'email' : 'Telegram'}`
  if (contact.active === false || contact.notificationDisabled) return 'Contato desativado para notificações'
  if (!identity.authorized || identity.consentStatus !== 'granted') {
    return `Permissão de ${channel === 'email' ? 'email' : 'Telegram'} não concedida`
  }
  return null
}

export function isContactEligible(contact = {}, channel) {
  return !contactIneligibility(contact, channel)
}

function groupContactIds(group = {}) {
  return (group.contacts || group.contactIds || [])
    .map((contact) => String(recordId(contact) || contact))
    .filter(Boolean)
}

export function selectedRecipientsEligibility({
  selectedContactIds = [],
  selectedGroupIds = [],
  groups = [],
  contacts = [],
  channel,
} = {}) {
  const selectedGroups = new Set(selectedGroupIds.map(String))
  const requestedIds = [
    ...selectedContactIds.map(String),
    ...groups
      .filter((group) => selectedGroups.has(String(recordId(group))))
      .flatMap(groupContactIds),
  ]
  const contactIds = [...new Set(requestedIds.filter(Boolean))]
  const contactMap = new Map(contacts.map((contact) => [String(recordId(contact)), contact]))
  const eligible = []
  const ineligible = []

  for (const contactId of contactIds) {
    const contact = contactMap.get(contactId)
    const reason = contact ? contactIneligibility(contact, channel) : 'Contato não encontrado ou removido'
    if (!reason) eligible.push(contact)
    else ineligible.push({ contactId, contact: contact || null, reason })
  }

  return { contactIds, eligible, ineligible }
}

export function normalizeDeliveryIssuePage(payload = {}, contacts = []) {
  const contactMap = new Map(contacts.map((contact) => [String(recordId(contact)), contact]))
  const items = (Array.isArray(payload.items) ? payload.items : []).map((issue, index) => {
    const contactId = String(issue.contactId || '')
    return {
      ...issue,
      id: issue.id || issue._id || `${issue.notificationId || 'notification'}-${contactId || index}`,
      contactId,
      errorMessage: issue.errorMessage || 'Entrega não elegível',
      contact: contactMap.get(contactId) || null,
    }
  })
  return {
    items,
    total: Math.max(0, Number(payload.total ?? items.length) || 0),
    page: Math.max(1, Number(payload.page) || 1),
    limit: Math.max(1, Number(payload.limit) || 10),
  }
}

export function normalizeDeliveryPage(payload = {}, contacts = []) {
  const contactMap = new Map(contacts.map((contact) => [String(recordId(contact)), contact]))
  const items = (Array.isArray(payload.items) ? payload.items : []).map((delivery, index) => {
    const contactId = String(delivery.contactId || '')
    return {
      ...delivery,
      id: delivery.id || delivery._id || `${delivery.notificationId || 'notification'}-${contactId || index}`,
      contactId,
      contact: contactMap.get(contactId) || null,
    }
  })
  return {
    items,
    total: Math.max(0, Number(payload.total ?? items.length) || 0),
    page: Math.max(1, Number(payload.page) || 1),
    limit: Math.max(1, Number(payload.limit) || 10),
  }
}

export function dispatchDeliveryCount(dispatch = {}, status) {
  const value = dispatch?.[`${status}Count`] ?? dispatch?.summary?.[status]
  return Math.max(0, Number(value) || 0)
}

export function newIdempotencyKey(prefix) {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${suffix}`
}

export function deliveryStatusColor(value = '') {
  return {
    delivered: 'positive',
    read: 'positive',
    sent: 'positive',
    queued: 'info',
    processing: 'info',
    received: 'info',
    failed: 'negative',
    error: 'negative',
    skipped: 'warning',
  }[String(value).toLowerCase()] || 'grey-7'
}
