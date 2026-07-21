import { describe, expect, it } from 'vitest'
import {
  normalizeTelegramMessage,
  telegramBotIdentity,
  telegramMessageMatchesChat,
} from '../src/services/telegram.js'

describe('telegramBotIdentity', () => {
  it('normaliza a identidade retornada pelo getMe nos formatos de status e configuracao', () => {
    expect(telegramBotIdentity({ bot: { id: 12, firstName: 'Notify', username: '@notify_bot' } })).toEqual({
      id: '12',
      firstName: 'Notify',
      displayName: 'Notify',
      username: 'notify_bot',
    })
    expect(telegramBotIdentity({ configuration: { telegram: { bot: { displayName: 'Alertas', username: 'alertas_bot' } } } })).toMatchObject({
      displayName: 'Alertas',
      username: 'alertas_bot',
    })
  })

  it('nao inventa identidade quando getMe ainda nao retornou um bot', () => {
    expect(telegramBotIdentity({ telegram: { configured: true } })).toBeNull()
  })
})

describe('mensagem em tempo real do Telegram', () => {
  const event = {
    updateId: 99,
    messageId: 15,
    contactId: 'contact-1',
    chat: { id: 456, type: 'private' },
    from: { id: 456, username: '@samuel', displayName: 'Samuel' },
    text: 'Oi pelo webhook',
    sentAt: '2026-07-20T12:00:00.000Z',
  }

  it('normaliza apenas o contrato seguro emitido pelo Socket.IO', () => {
    expect(normalizeTelegramMessage(event)).toEqual({
      id: '15',
      updateId: '99',
      contactId: 'contact-1',
      groupId: null,
      chatId: '456',
      chatType: 'private',
      chatTitle: null,
      senderId: '456',
      senderName: 'Samuel',
      username: 'samuel',
      text: 'Oi pelo webhook',
      sentAt: '2026-07-20T12:00:00.000Z',
      direction: 'inbound',
    })
  })

  it('associa o evento por chat_id ou contactId', () => {
    const message = normalizeTelegramMessage(event)
    expect(telegramMessageMatchesChat(message, { id: 'other', chatId: '456' })).toBe(true)
    expect(telegramMessageMatchesChat(message, { id: 'contact-1', chatId: '999' })).toBe(true)
    expect(telegramMessageMatchesChat(message, { id: 'contact-2', chatId: '999' })).toBe(false)
  })
})
