export const PUBLIC_LEGAL_TYPES = Object.freeze([
  Object.freeze({ type: 'terms_of_use', title: 'Termos de Uso' }),
  Object.freeze({ type: 'terms_of_service', title: 'Termos de Serviço' }),
  Object.freeze({ type: 'privacy_policy', title: 'Política de Privacidade' }),
])

export function slugifyInviteTitle(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 88)
    .replace(/-+$/g, '')
  return normalized.length >= 3 ? normalized : `convite-${normalized || 'publico'}`
}

export function normalizeWhatsappDisplayPhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : ''
}

export function inviteChannelPresentation(type) {
  const channel = String(type || '').trim().toLowerCase().replaceAll('-', '_')
  const presentations = {
    telegram: {
      icon: 'bi-telegram',
      tone: 'telegram',
      caption: 'Inicie o bot e confirme sua autorização',
    },
    whatsapp: {
      icon: 'mdi-whatsapp',
      tone: 'whatsapp',
      caption: 'Abra a conversa e envie o comando de autorização',
    },
    whatsapp_cloud: {
      icon: 'mdi-whatsapp',
      tone: 'whatsapp',
      caption: 'Abra a conversa e envie o comando de autorização',
    },
    email: {
      icon: 'mdi-gmail',
      tone: 'email',
      caption: 'Continue pelo seu endereço de e-mail',
    },
  }
  return presentations[channel] || {
    icon: 'arrow_outward',
    tone: 'default',
    caption: 'Continuar por este canal',
  }
}

export function buildWhatsappInviteUrl(phoneNumber, permissionCommand = '/notify-me') {
  const phone = normalizeWhatsappDisplayPhone(phoneNumber)
  const command = String(permissionCommand || '/notify-me').trim() || '/notify-me'
  return `https://wa.me/${phone}?text=${encodeURIComponent(command)}`
}

export function telegramStartPayload(command = '/notify-me') {
  const payload = String(command || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return payload || 'notify-me'
}

export function buildTelegramInviteUrl(username, permissionCommand = '/notify-me') {
  const cleanUsername = String(username || '').trim().replace(/^@/, '')
  if (!/^[a-zA-Z0-9_]{5,32}$/.test(cleanUsername)) return ''
  return `https://t.me/${cleanUsername}?start=${encodeURIComponent(telegramStartPayload(permissionCommand))}`
}

export function defaultInviteActionLink(channel, context = {}) {
  const normalizedChannel = String(channel || '').replaceAll('-', '_')
  if (normalizedChannel === 'telegram') {
    return {
      label: 'Iniciar Telegram',
      url: buildTelegramInviteUrl(context.telegramBotUsername, context.whatsappPermissionCommand),
      channel: 'telegram',
      active: true,
      _generated: true,
    }
  }
  if (normalizedChannel === 'whatsapp_cloud') {
    return {
      label: 'Autorizar WhatsApp',
      url: buildWhatsappInviteUrl(context.whatsappPhoneNumber, context.whatsappPermissionCommand),
      channel: normalizedChannel,
      active: true,
      _generated: true,
    }
  }
  return { label: '', url: '', channel: normalizedChannel || 'other', active: true, _generated: false }
}

function privateIpv4(hostname) {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  return parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] >= 224
}

export function safeInviteIconUrl(value) {
  try {
    const url = new URL(String(value || ''))
    const hostname = url.hostname.toLowerCase()
    const unwrappedHostname = hostname.replace(/^\[|\]$/g, '')
    if (url.protocol !== 'https:' || !hostname || url.username || url.password) return ''
    if (url.port && url.port !== '443') return ''
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return ''
    if (privateIpv4(hostname)) return ''
    if (unwrappedHostname === '::1' || unwrappedHostname === '::'
      || /^(fc|fd|fe8|fe9|fea|feb)/.test(unwrappedHostname)) return ''
    return url.toString()
  } catch {
    return ''
  }
}

export function fallbackLegalDocument(type) {
  const definition = PUBLIC_LEGAL_TYPES.find((item) => item.type === type) || PUBLIC_LEGAL_TYPES[0]
  return {
    type: definition.type,
    title: definition.title,
    version: 'informativo',
    fallback: true,
    content: '<p>Este documento ainda não possui uma versão publicada. Antes de fornecer dados ou autorizar notificações, confirme as condições diretamente com o responsável por este convite.</p>',
  }
}
