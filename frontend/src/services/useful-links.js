export const MAX_USEFUL_LINKS = 5

export const USEFUL_LINK_ICON_OPTIONS = Object.freeze([
  { label: 'Link', value: 'mdi-link-variant' },
  { label: 'Site', value: 'mdi-web' },
  { label: 'Documentação', value: 'mdi-file-document-outline' },
  { label: 'Guia', value: 'mdi-book-open-page-variant' },
  { label: 'Aprendizado', value: 'mdi-school-outline' },
  { label: 'Dúvidas frequentes', value: 'mdi-frequently-asked-questions' },
  { label: 'Atendimento', value: 'mdi-headset' },
  { label: 'WhatsApp', value: 'mdi-whatsapp' },
  { label: 'Telegram', value: 'mdi-send-circle-outline' },
  { label: 'Email', value: 'mdi-gmail' },
  { label: 'GitHub', value: 'mdi-github' },
  { label: 'Vídeo', value: 'mdi-play-circle-outline' },
])

export function normalizeUsefulLinkIcon(value) {
  const icon = String(value || '').trim().toLowerCase()
  return /^mdi-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(icon) ? icon : 'mdi-link-variant'
}

export function isSafeUsefulLinkUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim())
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

export function createUsefulLink(overrides = {}) {
  return {
    title: String(overrides.title || ''),
    caption: String(overrides.caption || ''),
    url: String(overrides.url || ''),
    iconName: normalizeUsefulLinkIcon(overrides.iconName || overrides.icon),
  }
}

export function normalizeUsefulLinks(value) {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, MAX_USEFUL_LINKS)
    .map((item) => createUsefulLink(item))
    .filter((item) => item.title.trim() && isSafeUsefulLinkUrl(item.url))
}

export function validateUsefulLinks(value) {
  if (!Array.isArray(value)) return 'A lista de links úteis é inválida.'
  if (value.length > MAX_USEFUL_LINKS) return `Cadastre no máximo ${MAX_USEFUL_LINKS} links úteis.`

  for (const [index, item] of value.entries()) {
    const position = index + 1
    if (!String(item?.title || '').trim()) return `Informe o título do link ${position}.`
    if (String(item.title).trim().length > 80) return `O título do link ${position} deve ter até 80 caracteres.`
    if (String(item?.caption || '').trim().length > 240) return `A descrição do link ${position} deve ter até 240 caracteres.`
    if (!/^mdi-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(item?.iconName || '').trim().toLowerCase())) {
      return `Use um nome de ícone MDI válido no link ${position}, como mdi-web.`
    }
    if (!isSafeUsefulLinkUrl(item?.url)) return `Informe uma URL HTTP ou HTTPS válida no link ${position}.`
  }

  return ''
}

export function usefulLinksPayload(value) {
  return (Array.isArray(value) ? value : []).slice(0, MAX_USEFUL_LINKS).map((item) => ({
    title: String(item?.title || '').trim(),
    caption: String(item?.caption || '').trim(),
    url: String(item?.url || '').trim(),
    iconName: normalizeUsefulLinkIcon(item?.iconName || item?.icon),
  }))
}
