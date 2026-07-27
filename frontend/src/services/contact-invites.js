function recordId(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return String(value.id || value._id || value.inviteId || value.invite || '')
}

function inviteCatalogMap(catalog = []) {
  return new Map(catalog.map((invite) => [recordId(invite), invite]))
}

export function contactInviteOrigins(contact = {}, catalog = []) {
  const byId = inviteCatalogMap(catalog)
  const values = contact.inviteOrigins
    || contact.invitationOrigins
    || contact.invites
    || []
  const list = Array.isArray(values) ? values : [values]
  const seen = new Set()

  return list.map((value) => {
    const id = recordId(value)
    const source = typeof value === 'object' && value !== null ? value : {}
    const fallback = byId.get(id) || {}
    return {
      id,
      title: source.title || source.name || fallback.title || fallback.name || 'Convite',
      slug: source.slug || fallback.slug || '',
      firstUsedAt: source.firstUsedAt || source.clickedAt || source.createdAt || null,
      lastUsedAt: source.lastUsedAt || source.inviteClickedAt || source.clickedAt || source.createdAt || null,
      channels: Array.isArray(source.channels) ? source.channels : [],
    }
  }).filter((origin) => origin.id && !seen.has(origin.id) && seen.add(origin.id))
}

export function groupInviteIds(group = {}) {
  const values = [
    ...(Array.isArray(group.inviteIds) ? group.inviteIds : []),
    ...(Array.isArray(group.sourceInviteIds) ? group.sourceInviteIds : []),
    ...(Array.isArray(group.sourceInvites) ? group.sourceInvites : []),
    ...(group.sourceInvite ? [group.sourceInvite] : []),
    ...(group.sourceInviteId ? [group.sourceInviteId] : []),
    ...(Array.isArray(group.inviteOrigins) ? group.inviteOrigins : []),
    ...(Array.isArray(group.invites) ? group.invites : []),
  ]
  const list = Array.isArray(values) ? values : [values]
  return [...new Set(list.map(recordId).filter(Boolean))]
}

export function groupInviteOrigins(group = {}, catalog = []) {
  const byId = inviteCatalogMap(catalog)
  return groupInviteIds(group).map((id) => {
    const source = [
      ...(Array.isArray(group.sourceInvites) ? group.sourceInvites : []),
      ...(group.sourceInvite ? [group.sourceInvite] : []),
      ...(Array.isArray(group.inviteOrigins) ? group.inviteOrigins : []),
      ...(Array.isArray(group.invites) ? group.invites : []),
    ].find((value) => recordId(value) === id) || {}
    const fallback = byId.get(id) || {}
    return {
      id,
      title: source.title || source.name || fallback.title || fallback.name || 'Convite',
      slug: source.slug || fallback.slug || '',
    }
  })
}

export function buildInviteGroupSyncPayload(form = {}) {
  return {
    inviteIds: [...new Set((form.inviteIds || []).map(recordId).filter(Boolean))],
  }
}

export function inviteGroupSyncSummary(result = {}) {
  const itemSummaries = Array.isArray(result.items)
    ? result.items.map((item) => item.summary || {})
    : []
  const summary = result.summary || result.sync || result
  return {
    invitesProcessed: Number(summary.invitesProcessed ?? result.items?.length ?? 0),
    groupsCreated: Number(summary.groupsCreated ?? itemSummaries.filter((item) => item.created).length ?? 0),
    groupsUpdated: Number(summary.groupsUpdated ?? itemSummaries.filter((item) => !item.created).length ?? 0),
    matched: Number(summary.matched ?? summary.totalMatched
      ?? itemSummaries.reduce((total, item) => total + Number(item.matched || 0), 0)),
    added: Number(summary.contactsAdded ?? summary.added ?? summary.addedCount
      ?? itemSummaries.reduce((total, item) => total + Number(item.added || 0), 0)),
    unchanged: Number(summary.unchanged ?? summary.unchangedCount
      ?? itemSummaries.reduce((total, item) => total + Number(item.unchanged || 0), 0)),
  }
}

export function inviteGroupSyncCaption(result = {}) {
  const summary = inviteGroupSyncSummary(result)
  const details = [
    `${summary.added} adicionado(s)`,
  ]
  if (summary.invitesProcessed) details.unshift(`${summary.invitesProcessed} convite(s)`)
  if (summary.matched) details.push(`${summary.matched} encontrado(s)`)
  if (summary.unchanged) details.push(`${summary.unchanged} já presente(s)`)
  return details.join(' · ')
}
