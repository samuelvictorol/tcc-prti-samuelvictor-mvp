function payloadOf(source) {
  return source?.data?.data ?? source?.data ?? source ?? {}
}

export const DEFAULT_TELEGRAM_PERMISSION_COMMAND = '/verify-me'

export function telegramPermissionCommandFromSettings(source = {}) {
  const payload = payloadOf(source)
  const configuration = payload.configuration || payload.settings || payload
  const command = configuration.telegramPermission?.command
    || configuration.telegram_permission?.command
    || configuration.telegram?.permissionCommand
  return String(command || DEFAULT_TELEGRAM_PERMISSION_COMMAND).trim() || DEFAULT_TELEGRAM_PERMISSION_COMMAND
}

function cleanUsername(value) {
  const username = String(value || '').trim().replace(/^@/, '')
  return username || null
}

export function telegramBotIdentity(source) {
  const payload = payloadOf(source)
  const bot = payload.bot
    || payload.telegram?.bot
    || payload.configuration?.telegram?.bot
    || payload.settings?.telegram?.bot

  if (!bot || typeof bot !== 'object') return null

  const firstName = String(bot.firstName || bot.first_name || bot.name || '').trim()
  const username = cleanUsername(bot.username)
  const displayName = String(bot.displayName || bot.display_name || firstName || username || '').trim()
  const id = bot.id === undefined || bot.id === null ? null : String(bot.id)

  if (!id && !displayName && !username) return null
  return { id, firstName: firstName || displayName, displayName, username }
}

export function normalizeTelegramMessage(source) {
  const payload = payloadOf(source)
  const message = payload.message && typeof payload.message === 'object'
    ? { ...payload, ...payload.message }
    : payload
  const chat = message.chat || {}
  const from = message.from || {}
  const chatIdValue = chat.id ?? message.chatId ?? message.chat_id

  if (chatIdValue === undefined || chatIdValue === null) return null

  const text = String(message.text ?? message.body ?? message.caption ?? '').trim()
  return {
    id: String(message.messageId ?? message.message_id ?? message.updateId ?? `${chatIdValue}:${message.sentAt || Date.now()}`),
    updateId: message.updateId === undefined || message.updateId === null ? null : String(message.updateId),
    contactId: message.contactId === undefined || message.contactId === null ? null : String(message.contactId),
    groupId: message.groupId === undefined || message.groupId === null ? null : String(message.groupId),
    chatId: String(chatIdValue),
    chatType: chat.type || message.chatType || null,
    chatTitle: chat.title || null,
    senderId: from.id === undefined || from.id === null ? null : String(from.id),
    senderName: String(from.displayName || from.display_name || from.firstName || from.first_name || '').trim() || null,
    username: cleanUsername(from.username),
    text: text || 'Nova mensagem recebida',
    sentAt: message.sentAt || message.createdAt || message.timestamp || new Date().toISOString(),
    direction: 'inbound',
  }
}

export function telegramMessageMatchesChat(message, chat) {
  if (!message || !chat) return false
  const identity = chat.channels?.find((item) => String(item.channel).replaceAll('-', '_') === 'telegram')
  const chatId = identity?.address ?? chat.chatId ?? chat.chat_id
  const contactId = chat.id ?? chat._id
  return String(chatId ?? '') === String(message.chatId ?? '')
    || Boolean(message.contactId && String(contactId ?? '') === String(message.contactId))
}
