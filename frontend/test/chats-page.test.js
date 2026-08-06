import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('quasar', () => ({ useQuasar: () => ({}) }))

import {
  canSendCloudServiceMessage,
  canSendCloudChatMode,
  cloudChatFormatText,
  cloudChatMessagePresentation,
  cloudChatSafeActionUrl,
  cloudChatSafeMediaUrl,
  cloudChatTemplateFixedVariables,
  cloudChatTemplatePreview,
  cloudChatTemplateVariablesForSend,
  cloudChatTemplateParameters,
  cloudTechnicalMessageDiagnostic,
  cloudConsentOf,
  cloudConsentSourceLabel,
  cloudConversationId,
  formatServiceWindow,
  isValidCloudTemplateMediaUrl,
  mergeCloudMessages,
  isContactlessTechnicalConversation,
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

  it('preserva mensagens antigas de template que só possuem o identificador', () => {
    expect(cloudChatMessagePresentation({
      type: 'template',
      body: '[Template: modelo_legado]',
    })).toEqual({
      isTemplate: true,
      name: 'modelo_legado',
      identifier: '[Template: modelo_legado]',
      languageCode: '',
      header: '',
      body: '',
      footer: '',
      media: null,
      buttons: [],
      hasRichContent: false,
    })
  })

  it('exibe evento técnico contactless em modo somente leitura sem inventar código de verificação', () => {
    const message = {
      type: 'unsupported',
      body: '[Conteúdo original não fornecido pela Meta]\nErro técnico da Meta META_131051: Message type unknown',
      metadata: {
        unsupported: { type: 'unknown', rawType: 'unknown', contentProvided: false },
        providerErrors: [{
          code: 131051,
          title: 'Message type unknown',
          message: 'Message type unknown',
          details: 'Message type is currently not supported.',
        }],
      },
    }
    const conversation = {
      id: 'technical-1',
      externalId: '447900000000',
      displayName: '447900000000',
      contactId: null,
      lastMessage: message,
    }

    expect(cloudTechnicalMessageDiagnostic(message)).toEqual({
      technical: true,
      type: 'unsupported',
      providerCode: 131051,
      providerCodeLabel: 'META_131051',
      title: 'Message type unknown',
      message: 'Message type unknown',
      details: 'Message type is currently not supported.',
      content: '',
      verificationCode: '',
      originalContentProvided: false,
    })
    expect(isContactlessTechnicalConversation(conversation)).toBe(true)

    const chats = source('pages/ChatsPage.vue')
    expect(chats).toContain('Evento técnico da Meta · contato não cadastrado')
    expect(chats).toContain('META_131051 é um código técnico da Meta, não o código de verificação.')
    expect(chats).toContain('<footer v-if="!selectedIsTechnical" class="message-composer">')
    expect(chats).toContain('conversation?.externalId')
  })

  it('apresenta o contrato estável do template como uma mensagem semelhante ao WhatsApp', () => {
    const presentation = cloudChatMessagePresentation({
      type: 'template',
      body: '[Template: notify_flow_image_notification]',
      metadata: {
        templatePreview: {
          name: 'notify_flow_image_notification',
          languageCode: 'pt_BR',
          header: {
            type: 'image',
            text: '*Grupo Alpha*',
            media: {
              type: 'image',
              url: 'https://cdn.example.com/grupo-alpha.png',
              filename: 'grupo-alpha.png',
            },
          },
          body: { text: 'Olá, *Samuel*!\nSeu convite está pronto.' },
          footer: { text: 'Notify Flow' },
          buttons: [
            { type: 'url', text: 'Autorizar notificações', url: 'https://notify.example.com/invite/grupo-alpha' },
            { type: 'quick_reply', text: 'Agora não', url: '' },
          ],
        },
      },
    })

    expect(presentation).toEqual({
      isTemplate: true,
      name: 'notify_flow_image_notification',
      identifier: '[Template: notify_flow_image_notification]',
      languageCode: 'pt_BR',
      header: '*Grupo Alpha*',
      body: 'Olá, *Samuel*!\nSeu convite está pronto.',
      footer: 'Notify Flow',
      media: {
        type: 'image',
        url: 'https://cdn.example.com/grupo-alpha.png',
        filename: 'grupo-alpha.png',
      },
      buttons: [
        { type: 'url', text: 'Autorizar notificações', url: 'https://notify.example.com/invite/grupo-alpha' },
        { type: 'quick_reply', text: 'Agora não', url: '' },
      ],
      hasRichContent: true,
    })
  })

  it('deriva detalhes de componentes legados quando eles estiverem disponíveis', () => {
    expect(cloudChatMessagePresentation({
      type: 'template',
      body: '[Template: pedido_confirmado]',
      metadata: {
        template: {
          name: 'pedido_confirmado',
          languageCode: 'pt_BR',
          components: [
            { type: 'header', parameters: [{ type: 'document', document: { link: 'https://cdn.example.com/pedido.pdf', filename: 'pedido.pdf' } }] },
            { type: 'body', text: 'Pedido {{1}} confirmado.', parameters: [{ type: 'text', text: '123' }] },
            { type: 'footer', text: 'Obrigado pela preferência' },
            { type: 'button', subType: 'url', text: 'Acompanhar', url: 'https://example.com/pedido/123' },
          ],
        },
      },
    })).toEqual(expect.objectContaining({
      identifier: '[Template: pedido_confirmado]',
      body: 'Pedido 123 confirmado.',
      footer: 'Obrigado pela preferência',
      media: {
        type: 'document',
        url: 'https://cdn.example.com/pedido.pdf',
        filename: 'pedido.pdf',
      },
      buttons: [{ type: 'url', text: 'Acompanhar', url: 'https://example.com/pedido/123' }],
      hasRichContent: true,
    }))
  })

  it('formata texto sem permitir HTML arbitrário e restringe URLs exibidas', () => {
    expect(cloudChatFormatText('*Olá* _Samuel_ ~antigo~\n<script>alert(1)</script>'))
      .toBe('<strong>Olá</strong> <em>Samuel</em> <s>antigo</s><br>&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(cloudChatSafeActionUrl('https://example.com/acao')).toBe('https://example.com/acao')
    expect(cloudChatSafeActionUrl('http://example.com/acao')).toBe('')
    expect(cloudChatSafeActionUrl('javascript:alert(1)')).toBe('')
    expect(cloudChatSafeMediaUrl('/api/media/asset-1')).toBe('/api/media/asset-1')
    expect(cloudChatSafeMediaUrl('http://example.com/a.png')).toBe('')
    expect(cloudChatSafeMediaUrl('//evil.example.com/a.png')).toBe('')
  })

  it('renderiza mídia, conteúdo e ações dentro da bolha sem esconder o identificador', () => {
    const chats = source('pages/ChatsPage.vue')

    expect(chats).toContain('metadata.templatePreview')
    expect(chats).toContain('class="template-message-identifier"')
    expect(chats).toContain('{{ messagePresentation(item).identifier }}')
    expect(chats).toContain('class="template-message-media"')
    expect(chats).toContain('class="template-message-body"')
    expect(chats).toContain('class="template-message-footer"')
    expect(chats).toContain('class="template-message-buttons"')
    expect(chats).toContain('v-html="cloudChatFormatText(messagePresentation(item).body)"')
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

  it('mantem o legado com apenas imagem dinamica no chat oficial', () => {
    const template = {
      payload: {
        builder: {
          components: [
            { type: 'header', parameters: [{ key: 'imagem', label: 'Imagem', type: 'image', example: 'https://cdn.example.com/amostra.png' }] },
            { type: 'body', text: 'Corpo fixo aprovado.' },
            { type: 'button', text: 'Abrir', url: 'https://notify.example.com/fixo' },
          ],
        },
      },
    }
    const parameters = cloudChatTemplateParameters(template)
    expect(parameters).toEqual([expect.objectContaining({ key: 'imagem', fixedValue: '', type: 'image' })])
    expect(cloudChatTemplateFixedVariables(template)).toEqual({})
    const variables = cloudChatTemplateVariablesForSend(parameters, {
      imagem: 'https://cdn.example.com/envio.png',
    })
    expect(variables).toEqual({ imagem: 'https://cdn.example.com/envio.png' })
    expect(cloudChatTemplatePreview(template, variables)).toEqual({
      header: '',
      body: 'Corpo fixo aprovado.',
      footer: '',
      mediaType: 'image',
      mediaUrl: 'https://cdn.example.com/envio.png',
      buttons: [{ text: 'Abrir', url: 'https://notify.example.com/fixo' }],
    })
  })

  it('preenche imagem, corpo nomeado e URL posicional no chat sem liberar sobrescrita de fixos', () => {
    const template = {
      payload: {
        builder: {
          components: [
            { type: 'header', parameters: [{ key: 'header_image', label: 'Imagem', type: 'image' }] },
            {
              type: 'body',
              text: '{{body_description}} — {{operator_name}}',
              parameters: [
                { key: 'body_text', parameterName: 'body_description', label: 'Descricao', type: 'text' },
                { key: 'operator_name', parameterName: 'operator_name', label: 'Operador', type: 'text', fixedValue: 'Notify Flow' },
              ],
            },
            {
              type: 'button',
              text: 'Ver convite',
              url: 'https://notify.example.com/invite/{{1}}',
              parameters: [{ key: 'invite_slug', label: 'Slug', type: 'text' }],
            },
          ],
        },
      },
    }
    const parameters = cloudChatTemplateParameters(template)
    expect(parameters.filter((item) => !item.fixedValue).map((item) => item.key))
      .toEqual(['header_image', 'body_text', 'invite_slug'])
    const variables = cloudChatTemplateVariablesForSend(parameters, {
      header_image: 'https://cdn.example.com/nova.png',
      body_text: 'Descricao dinamica',
      invite_slug: 'grupo-alpha',
      operator_name: 'Nao deve sobrescrever',
    })
    expect(variables).toEqual({
      header_image: 'https://cdn.example.com/nova.png',
      body_text: 'Descricao dinamica',
      operator_name: 'Notify Flow',
      invite_slug: 'grupo-alpha',
    })
    expect(cloudChatTemplatePreview(template, variables)).toEqual({
      header: '',
      body: 'Descricao dinamica — Notify Flow',
      footer: '',
      mediaType: 'image',
      mediaUrl: 'https://cdn.example.com/nova.png',
      buttons: [{ text: 'Ver convite', url: 'https://notify.example.com/invite/grupo-alpha' }],
    })

    const chats = source('pages/ChatsPage.vue')
    expect(chats).toContain('selectedTemplateDynamicParameters')
    expect(chats).toContain('v-model="templateValues[parameter.key]"')
    expect(chats).toContain('variables: selectedTemplateVariables.value')
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
    expect(chats).toContain('const mergedMessages = mergeCloudMessages([...messages.value, payload.message])')
    expect(chats).toContain('chatWindowAfterRealtime(mergedMessages')
    expect(chats).toContain('params: { page: 1, limit: CHAT_MESSAGE_PAGE_SIZE }')
    expect(chats).not.toContain('if (current) await selectConversation(current)')
    expect(chats).toMatch(
      /<div v-if="loadingMessages"[\s\S]+?<template v-else>[\s\S]+?v-for="item in messages"/,
    )
  })
})
