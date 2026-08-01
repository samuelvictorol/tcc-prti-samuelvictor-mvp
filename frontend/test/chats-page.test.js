import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('quasar', () => ({ useQuasar: () => ({}) }))

import {
  canSendCloudServiceMessage,
  canSendCloudChatMode,
  cloudChatTemplateFixedVariables,
  cloudChatTemplatePreview,
  cloudChatTemplateVariablesForSend,
  cloudChatTemplateParameters,
  cloudConsentOf,
  cloudConsentSourceLabel,
  cloudConversationId,
  formatServiceWindow,
  isValidCloudTemplateMediaUrl,
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
    expect(chats).toContain("socket.on('conversation:message', onRealtimeMessage)")
    expect(chats).toContain("socket.on('conversations:updated', onRealtimeConversation)")
    expect(chats).toContain('A Cloud API não oferece uma importação retroativa')
    expect(chats).toContain('label="Fazer backup agora"')
    expect(chats).toContain('@media (max-width: 850px)')
    expect(chats).toContain('@media (max-width: 430px)')
    expect(chats).toContain('chats-shell--conversation-mobile')
    expect(layout).not.toContain("label: 'Chats'")
    expect(router).toContain("path: 'chats'")
    expect(router).toContain("redirect: { name: 'whatsapp-cloud', query: { tab: 'conversations' } }")
    expect(source('pages/WhatsappCloudPage.vue')).toContain('<ChatsPage v-if="activeTab === \'conversations\'" embedded />')
    expect(`${chats}\n${layout}\n${router}`).not.toMatch(/whatsapp[_-]?web|WhatsApp Web/i)
  })

  it('não oferece resposta livre nem pedido de consentimento depois do prazo', () => {
    const chats = source('pages/ChatsPage.vue')

    expect(chats).toContain(':disable="!selectedCanCompose')
    expect(chats).toContain(':disable="!consentRequestAvailable"')
    expect(chats).toContain('Respostas livres bloqueadas após 24 horas.')
    expect(chats).toContain('template oficial aprovado pela Meta')
  })

  it('permite texto na janela ou template cadastrado depois do opt-in', () => {
    const open = {
      serviceWindow: { expiresAt: '2026-07-28T13:00:00.000Z' },
      consent: { authorized: false },
    }
    const optedIn = {
      serviceWindow: { expiresAt: '2026-07-28T11:00:00.000Z' },
      consent: { authorized: true },
    }

    expect(canSendCloudChatMode(open, 'quick', now)).toBe(true)
    expect(canSendCloudChatMode(open, 'template', now)).toBe(false)
    expect(canSendCloudChatMode(optedIn, 'quick', now)).toBe(false)
    expect(canSendCloudChatMode(optedIn, 'template', now)).toBe(true)
    expect(cloudChatTemplateParameters({
      payload: { builder: { components: [{ type: 'body', parameters: [{ key: 'pedido', label: 'Pedido', fixedValue: '123' }] }] } },
    })).toEqual([{
      key: 'pedido',
      label: 'Pedido',
      type: 'text',
      componentType: 'body',
      fixedValue: '123',
    }])
  })

  it('não pede valores no chat e usa mídia, texto e botões já cadastrados', () => {
    const template = {
      description: 'Descrição interna que não deve ser usada na prévia',
      payload: {
        builder: {
          components: [
            {
              type: 'header',
              text: 'Olá {{cliente}}',
              parameters: [
                { key: 'cliente', label: 'Cliente', type: 'text', fixedValue: 'Ana' },
                { key: 'imagem_cabecalho', label: 'Imagem', type: 'image', fixedValue: 'https://cdn.example.com/exemplo.png' },
              ],
            },
            { type: 'body', text: 'Pedido {{1}} confirmado.', parameters: [{ key: 'pedido', type: 'text', fixedValue: '123' }] },
            { type: 'footer', text: 'Notify Flow' },
            { type: 'button', text: 'Acompanhar', url: 'https://example.com/{{pedido}}' },
          ],
        },
      },
    }
    const parameters = cloudChatTemplateParameters(template)

    expect(parameters).toEqual(expect.arrayContaining([expect.objectContaining({
      key: 'imagem_cabecalho',
      type: 'image',
      fixedValue: 'https://cdn.example.com/exemplo.png',
    })]))
    expect(cloudChatTemplateFixedVariables(template)).toEqual({
      cliente: 'Ana',
      imagem_cabecalho: 'https://cdn.example.com/exemplo.png',
      pedido: '123',
    })
    expect(cloudChatTemplateFixedVariables({
      payload: { builder: { components: [{ parameters: [{ key: 'somenteExemplo', example: 'NÃO ENVIAR' }] }] } },
    })).toEqual({})
    expect(cloudChatTemplateVariablesForSend(parameters)).toEqual({
      cliente: 'Ana',
      imagem_cabecalho: 'https://cdn.example.com/exemplo.png',
      pedido: '123',
    })
    expect(cloudChatTemplatePreview(template)).toEqual({
      header: 'Olá Ana',
      body: 'Pedido 123 confirmado.',
      footer: 'Notify Flow',
      mediaType: 'image',
      mediaUrl: 'https://cdn.example.com/exemplo.png',
      buttons: [{ text: 'Acompanhar', url: 'https://example.com/123' }],
    })
    expect(isValidCloudTemplateMediaUrl('https://cdn.example.com/capa.png')).toBe(true)
    expect(isValidCloudTemplateMediaUrl('https://')).toBe(false)
    expect(isValidCloudTemplateMediaUrl('https://user:secret@example.com/capa.png')).toBe(false)

    const chats = source('pages/ChatsPage.vue')
    expect(chats).not.toContain("http.post('/media', multipart")
    expect(chats).not.toContain('v-model="templateVariables')
    expect(chats).not.toContain("label: 'Enviar arquivo'")
    expect(chats).toContain('class="chat-template-preview"')
    expect(chats).toContain('Conteúdo e valores definidos no template cadastrado.')
  })

  it('mantém os valores oficiais do preset de confirmação sem pedir campos no chat', () => {
    expect(cloudChatTemplateFixedVariables({
      whatsappCloudPreset: 'order_confirmation',
      variables: ['customerName', 'orderNumber', 'orderDate'],
    })).toEqual({
      customerName: 'John Doe',
      orderNumber: '123456',
      orderDate: 'Jul 20, 2026',
    })
  })

  it('atualiza o chat em segundo plano sem reabrir o skeleton ou aceitar respostas obsoletas', () => {
    const chats = source('pages/ChatsPage.vue')

    expect(chats).toContain('let messagesRequest = 0')
    expect(chats).toContain('requestId !== messagesRequest')
    expect(chats).toContain("await loadConversation(current, { background: true, markRead: false })")
    expect(chats).toContain('messages.value = mergeCloudMessages([...messages.value, payload.message])')
    expect(chats).not.toContain('if (current) await selectConversation(current)')
    expect(chats).toMatch(
      /<div v-if="loadingMessages"[\s\S]+?<template v-else>[\s\S]+?v-for="item in messages"/,
    )
  })
})
