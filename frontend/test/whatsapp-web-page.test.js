import { describe, expect, it, vi } from 'vitest'

vi.mock('quasar', () => ({ useQuasar: () => ({}) }))

import {
  canReplyToWhatsappWebConversation,
  mergeWhatsappWebHistory,
  upsertWhatsappWebConversation,
  whatsappWebConversationId,
} from '../src/pages/WhatsappWebPage.vue'

describe('histórico do monitor WhatsApp Web', () => {
  it('retorna um id vazio quando ainda não existe conversa selecionada', () => {
    expect(whatsappWebConversationId(null)).toBe('')
  })

  it('remove duplicados e ordena exclusivamente o histórico persistido', () => {
    const result = mergeWhatsappWebHistory([
      {
        id: 'local-1',
        providerMessageId: 'wamid-1',
        direction: 'inbound',
        body: 'Mensagem persistida',
        sentAt: '2026-07-21T10:00:00.000Z',
      },
      { id: 'wamid-2', fromMe: true, body: 'Resposta recente', timestamp: 1784628060 },
      { id: 'wamid-1', fromMe: false, body: 'Mensagem persistida', timestamp: 1784628000 },
    ])

    expect(result).toHaveLength(2)
    expect(result.map((message) => message.providerMessageId)).toEqual(['wamid-1', 'wamid-2'])
    expect(result[0]).toMatchObject({ id: 'local-1', direction: 'inbound' })
    expect(result[1]).toMatchObject({ direction: 'outbound', fromMe: true })
  })

  it('permite resposta somente em conversa individual autorizada', () => {
    const granted = { channel: 'whatsapp_web', authorized: true, consentStatus: 'granted' }
    const unknown = { channel: 'whatsapp_web', authorized: false, consentStatus: 'unknown' }
    expect(canReplyToWhatsappWebConversation({ isGroup: false }, granted)).toBe(true)
    expect(canReplyToWhatsappWebConversation({ isGroup: false }, unknown)).toBe(false)
    expect(canReplyToWhatsappWebConversation({ isGroup: true }, granted)).toBe(false)
    expect(canReplyToWhatsappWebConversation(null)).toBe(false)
  })

  it('insere e atualiza a conversa recebida em tempo real sem duplicar', () => {
    const initial = [
      { id: 'conversation-1', channel: 'whatsapp_web', displayName: 'Nome antigo' },
      { id: 'conversation-2', channel: 'whatsapp_web', displayName: 'Outro chat' },
    ]
    const updated = upsertWhatsappWebConversation(initial, {
      id: 'conversation-1',
      channel: 'whatsapp_web',
      displayName: 'Nome atualizado',
      avatarUrl: 'https://example.test/avatar.jpg',
    })

    expect(updated).toHaveLength(2)
    expect(updated[0]).toMatchObject({ id: 'conversation-1', displayName: 'Nome atualizado' })
    expect(whatsappWebConversationId(updated[0])).toBe('conversation-1')
  })

  it('ignora atualização em tempo real de outro canal', () => {
    const initial = [{ id: 'conversation-1', channel: 'whatsapp_web' }]
    expect(upsertWhatsappWebConversation(initial, { id: 'telegram-1', channel: 'telegram' })).toBe(initial)
  })
})
