export const ADMIN_NOTIFICATION_RETENTION_DAYS = 30

export const ADMIN_NOTIFICATION_READ_OPTIONS = [
  { label: 'Todas', value: 'all' },
  { label: 'Não lidas', value: 'unread' },
  { label: 'Lidas', value: 'read' },
]

export const DEFAULT_ADMIN_NOTIFICATION_CHANNELS = [
  { label: 'Todos os canais', value: 'all' },
  { label: 'Sistema', value: 'system' },
  { label: 'WhatsApp oficial', value: 'whatsapp_cloud' },
  { label: 'Telegram', value: 'telegram' },
  { label: 'Email', value: 'email' },
]

export function adminNotificationKindLabel(value) {
  if (!value) return 'Todos os tipos'
  const known = {
    contact_auto_created: 'Novo contato',
  }
  return known[value] || String(value)
    .replaceAll('_', ' ')
    .replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase('pt-BR'))
}

export function buildAdminNotificationQuery(filters = {}, pagination = {}) {
  const read = filters.read === 'read'
    ? true
    : filters.read === 'unread'
      ? false
      : undefined

  return {
    page: Number(pagination.page || 1),
    limit: Number(pagination.rowsPerPage || pagination.limit || 15),
    search: filters.search?.trim() || undefined,
    read,
    channel: filters.channel && filters.channel !== 'all' ? filters.channel : undefined,
    kind: filters.kind && filters.kind !== 'all' ? filters.kind : undefined,
  }
}

export function matchesAdminNotificationFilters(item, filters = {}) {
  if (!item) return false
  if (filters.read === 'read' && !item.read) return false
  if (filters.read === 'unread' && item.read) return false
  if (filters.channel && filters.channel !== 'all' && item.channel !== filters.channel) return false
  if (filters.kind && filters.kind !== 'all' && item.kind !== filters.kind) return false

  const search = filters.search?.trim().toLocaleLowerCase('pt-BR')
  if (!search) return true
  return [item.title, item.message, item.channel, item.kind]
    .filter(Boolean)
    .some((value) => String(value).toLocaleLowerCase('pt-BR').includes(search))
}

export function prependRealtimeAdminNotification(items, notification, limit = 15) {
  if (!notification?.id) return items
  return [
    notification,
    ...(items || []).filter((item) => item.id !== notification.id),
  ].slice(0, limit)
}

export function paginationAfterAdminNotificationRemoval(pagination = {}) {
  const rowsPerPage = Math.max(1, Number(pagination.rowsPerPage || pagination.limit || 15))
  const rowsNumber = Math.max(0, Number(pagination.rowsNumber || 0) - 1)
  const pages = Math.max(1, Math.ceil(rowsNumber / rowsPerPage))
  const previousPage = Math.max(1, Number(pagination.page || 1))
  const page = Math.min(previousPage, pages)

  return {
    pagination: {
      ...pagination,
      page,
      rowsPerPage,
      rowsNumber,
      pages,
    },
    pageChanged: page !== previousPage,
    shouldReload: rowsNumber > 0,
  }
}
