import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('quasar', () => ({ useQuasar: () => ({}) }))

import {
  canSendCloudServiceMessage,
  cloudConsentOf,
  cloudConsentSourceLabel,
  cloudConversationId,
  formatServiceWindow,
  mergeCloudMessages,
  serviceWindowOf,
  upsertCloudConversation,
} from '../src/pages/ChatsPage.vue'

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../src/${relativePath}`, import.meta.url)), 'utf8')
}

describe('Chats oficiais do WhatsApp Cloud', () => {
  const now = new Date('2026-07-28T12:00:00.000Z').getTime()

  it('calcula a janela de 24 horas pelo último inbound e a encerra dinamicamente', () => {
    const openConversation = { serviceWindow: { lastInboundAt: '2026-07-28T11:30:00.000Z' } }
    const closedConversation = { serviceWindow: { expiresAt: '2026-07-28T11:59:59.000Z' } }

    expect(serviceWindowOf(openConversation, now)).toMatchObject({
      open: true,
      remainingSeconds: 23.5 * 60 * 60,
    })
    expect(formatServiceWindow(openConversation, now)).toBe('23h 30m')
    expect(canSendCloudServiceMessage(openConversation, now)).toBe(true)
    expect(serviceWindowOf(closedConversation, now).open).toBe(false)
    expect(formatServiceWindow(closedConversation, now)).toBe('Janela encerrada')
  })

  it('separa janela de atendimento de consentimento para notificações', () => {
    const conversation = {
      serviceWindow: { expiresAt: '2026-07-28T13:00:00.000Z' },
      consent: {
        authorized: false,
        status: 'unknown',
        source: '',
        command: '/notify-me',
      },
    }

    expect(canSendCloudServiceMessage(conversation, now)).toBe(true)
    expect(cloudConsentOf(conversation)).toEqual({
      authorized: false,
      status: 'unknown',
      source: '',
      command: '/notify-me',
    })
  })

  it('identifica a origem da autorização de forma amigável', () => {
    expect(cloudConsentSourceLabel({
      authorized: true,
      source: 'whatsapp_cloud_permission_command',
      command: '/notify-me',
    })).toBe('Comando /notify-me')
    expect(cloudConsentSourceLabel({ authorized: true, source: 'profile' })).toBe('Meu Perfil')
    expect(cloudConsentSourceLabel({ authorized: true, source: 'admin_manual' })).toBe('Administrador')
  })

  it('remove duplicados e ordena mensagens persistidas', () => {
    const result = mergeCloudMessages([
      { providerMessageId: 'wamid-2', direction: 'outbound', text: 'Resposta', sentAt: '2026-07-28T11:02:00.000Z' },
      { providerMessageId: 'wamid-1', direction: 'inbound', text: 'Olá', sentAt: '2026-07-28T11:00:00.000Z' },
      { providerMessageId: 'wamid-1', direction: 'inbound', text: 'Olá', sentAt: '2026-07-28T11:00:00.000Z', status: 'read' },
    ])

    expect(result).toHaveLength(2)
    expect(result.map((item) => item.providerMessageId)).toEqual(['wamid-1', 'wamid-2'])
    expect(result[0].status).toBe('read')
  })

  it('atualiza uma conversa em tempo real sem duplicar', () => {
    const initial = [
      { id: 'conversation-1', displayName: 'Nome antigo', lastMessageAt: '2026-07-28T10:00:00Z' },
      { id: 'conversation-2', displayName: 'Outra pessoa', lastMessageAt: '2026-07-28T09:00:00Z' },
    ]
    const updated = upsertCloudConversation(initial, {
      id: 'conversation-1',
      displayName: 'Nome atualizado',
      lastMessageAt: '2026-07-28T12:00:00Z',
    })

    expect(updated).toHaveLength(2)
    expect(cloudConversationId(updated[0])).toBe('conversation-1')
    expect(updated[0].displayName).toBe('Nome atualizado')
  })

  it('usa somente endpoints oficiais e mantém controles responsivos', () => {
    const chats = source('pages/ChatsPage.vue')
    const layout = source('layouts/MainLayout.vue')
    const router = source('router/index.js')

    expect(chats).toContain("http.get('/whatsapp-cloud/conversations'")
    expect(chats).toContain('`/whatsapp-cloud/conversations/${cloudConversationId(selected.value)}/messages`')
    expect(chats).toContain('`/whatsapp-cloud/conversations/${cloudConversationId(selected.value)}/consent-request`')
    expect(chats).toContain("'/whatsapp-cloud/conversations/backup'")
    expect(chats).toContain("socket.on('whatsapp_cloud:message', scheduleRealtimeRefresh)")
    expect(chats).toContain("socket.on('conversation:message', scheduleRealtimeRefresh)")
    expect(chats).toContain('A Cloud API não oferece uma importação retroativa')
    expect(chats).toContain('label="Fazer backup agora"')
    expect(chats).toContain('@media (max-width: 850px)')
    expect(chats).toContain('@media (max-width: 430px)')
    expect(chats).toContain('chats-shell--conversation-mobile')
    expect(layout).toContain("label: 'Chats'")
    expect(router).toContain("path: 'chats'")
    expect(router).toContain("import('../pages/ChatsPage.vue')")
    expect(`${chats}\n${layout}\n${router}`).not.toMatch(/whatsapp[_-]?web|WhatsApp Web/i)
  })

  it('não oferece resposta livre nem pedido de consentimento depois do prazo', () => {
    const chats = source('pages/ChatsPage.vue')

    expect(chats).toContain(':disable="!selectedCanSend || !draft.trim()"')
    expect(chats).toContain(':disable="!consentRequestAvailable"')
    expect(chats).toContain('Respostas livres bloqueadas após 24 horas.')
    expect(chats).toContain('template oficial aprovado pela Meta')
  })
})
