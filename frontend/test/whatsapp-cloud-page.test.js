import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('quasar', () => ({ useQuasar: () => ({}) }))

import {
  dispatchDeliveryCount,
  dynamicTemplateParameters,
  fixedTemplateVariableValues,
  formatWhatsappPublicNumber,
  humanizeWebhookKey,
  isOfficialCloudTemplateAvailable,
  isCloudContactEligible,
  isCloudSendConfigured,
  mergeWebhookEventPage,
  mergeWebhookEventVersions,
  mergeWebhookEvents,
  normalizeDeliveryIssuePage,
  normalizeWebhookEventPage,
  sanitizeWebhookPayload,
  selectedGroupEligibility,
  templateParameterDefinitions,
  templateVariableValuesForSend,
  whatsappConnectionIdentity,
  whatsappDispatchTemplatePreview,
  webhookEventFieldOptionsFrom,
  webhookEventPresentation,
  webhookEventSummary,
} from '../src/pages/WhatsappCloudPage.vue'

const eligibleContact = {
  id: 'contact-1',
  displayName: 'Ana',
  active: true,
  channels: [{ channel: 'whatsapp_cloud', address: '5511999999999', authorized: true, consentStatus: 'granted', source: 'whatsapp_cloud_webhook' }],
}

const deniedContact = {
  id: 'contact-2',
  displayName: 'Bruno',
  active: true,
  channels: [{ channel: 'whatsapp_cloud', address: '5511888888888', authorized: false, consentStatus: 'unknown' }],
}

describe('disparo oficial WhatsApp Cloud', () => {
  it('formata e apresenta os identificadores não secretos do número oficial', () => {
    expect(formatWhatsappPublicNumber('5511931234567')).toBe('+55 (11) 9 3123-4567')
    expect(formatWhatsappPublicNumber('+55 (11) 3123-4567')).toBe('+55 (11) 3123-4567')
    expect(whatsappConnectionIdentity({
      status: {
        sendConfigured: true,
        phoneNumberId: '1000000000000001',
        displayPhoneNumber: '5511931234567',
        businessAccountId: '2000000000000001',
      },
    })).toEqual({
      configured: true,
      phoneNumberId: '1000000000000001',
      displayPhoneNumber: '5511931234567',
      formattedPhoneNumber: '+55 (11) 9 3123-4567',
      businessAccountId: '2000000000000001',
    })
  })

  it('mantém o banner responsivo e os ícones das linhas com dimensões estáveis', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/pages/WhatsappCloudPage.vue', import.meta.url)), 'utf8')

    expect(source).toContain('data-testid="whatsapp-cloud-identity"')
    expect(source).toContain('WhatsApp Business Account ID')
    expect(source).toContain('class="table-row-icon"')
    expect(source).toContain('width: 38px !important')
    expect(source).toContain('@media (max-width: 650px)')
  })

  it('mantem o webhook independente das credenciais de envio', () => {
    expect(isCloudSendConfigured({ webhookConfigured: true, sendConfigured: false })).toBe(false)
    expect(isCloudSendConfigured({ webhookConfigured: false, sendConfigured: true })).toBe(true)
  })

  it('oferece somente templates oficiais ativos', () => {
    expect(isOfficialCloudTemplateAvailable({
      active: true,
      templateType: 'approved_template',
      externalTemplateName: 'confirmacao_ativa',
    })).toBe(true)
    expect(isOfficialCloudTemplateAvailable({
      active: false,
      templateType: 'approved_template',
      externalTemplateName: 'confirmacao_inativa',
    })).toBe(false)
  })

  it('distingue contatos elegíveis pelo consentimento do canal', () => {
    expect(isCloudContactEligible(eligibleContact)).toBe(true)
    expect(isCloudContactEligible(deniedContact)).toBe(false)
  })

  it('expande grupos e aponta inelegíveis sem bloquear os elegíveis', () => {
    const result = selectedGroupEligibility(
      ['group-1'],
      [{ id: 'group-1', contacts: ['contact-1', 'contact-2', 'missing'] }],
      [eligibleContact, deniedContact],
    )
    expect(result.eligible.map((contact) => contact.id)).toEqual(['contact-1'])
    expect(result.ineligible.map((item) => item.contactId)).toEqual(['contact-2', 'missing'])
  })

  it('lê dinamicamente os campos salvos pelo builder do template', () => {
    const fields = templateParameterDefinitions({
      whatsappCloudPreset: 'custom',
      payload: {
        builder: {
          components: [{ type: 'header', parameters: [{ key: 'arquivo', label: 'Documento', fixedValue: 'https://example.com/a.pdf', type: 'document' }] }],
        },
      },
    })
    expect(fields).toEqual([expect.objectContaining({
      key: 'arquivo',
      label: 'Documento',
      fixedValue: 'https://example.com/a.pdf',
      type: 'document',
      componentType: 'header',
    })])
  })

  it('usa somente os valores fixos cadastrados e mostra a prévia real do template', () => {
    const template = {
      body: 'Fallback',
      description: 'Descrição interna não exibida',
      payload: {
        builder: {
          components: [
            {
              type: 'header',
              text: 'Olá {{cliente}}',
              parameters: [
                { key: 'cliente', label: 'Cliente', type: 'text', fixedValue: 'Ana' },
                { key: 'capa', label: 'Capa', type: 'image', fixedValue: 'https://example.com/capa.png' },
              ],
            },
            { type: 'body', text: 'Seu pedido {{1}} chegou.', parameters: [{ key: 'pedido', type: 'text', fixedValue: '123' }] },
            { type: 'footer', text: 'Notify Flow' },
            { type: 'button', text: 'Abrir', url: 'https://example.com/{{pedido}}' },
          ],
        },
      },
    }

    expect(fixedTemplateVariableValues(template)).toEqual({
      cliente: 'Ana',
      capa: 'https://example.com/capa.png',
      pedido: '123',
    })
    expect(fixedTemplateVariableValues({
      payload: { builder: { components: [{ parameters: [{ key: 'somenteExemplo', example: 'NÃO ENVIAR' }] }] } },
    })).toEqual({})
    expect(whatsappDispatchTemplatePreview(template)).toEqual({
      header: 'Olá Ana',
      body: 'Seu pedido 123 chegou.',
      footer: 'Notify Flow',
      mediaType: 'image',
      mediaUrl: 'https://example.com/capa.png',
      buttons: [{ text: 'Abrir', url: 'https://example.com/123' }],
    })

    const source = readFileSync(fileURLToPath(new URL('../src/pages/WhatsappCloudPage.vue', import.meta.url)), 'utf8')
    expect(source).not.toContain('Valores do template')
    expect(source).not.toContain('form.variableValues')
    expect(source).toContain('Conteúdo e valores definidos no template cadastrado.')
  })

  it('suporta o template legado com somente a imagem dinamica', () => {
    const template = {
      payload: {
        builder: {
          components: [
            { type: 'header', parameters: [{ key: 'imagem', label: 'Imagem', type: 'image', example: 'https://cdn.example.com/amostra.png' }] },
            { type: 'body', text: 'Mensagem fixa.' },
            { type: 'button', text: 'Abrir', url: 'https://notify.example.com/fixo' },
          ],
        },
      },
    }

    expect(dynamicTemplateParameters(template)).toEqual([
      expect.objectContaining({ key: 'imagem', type: 'image', fixedValue: '' }),
    ])
    const variables = templateVariableValuesForSend(template, {
      imagem: 'https://cdn.example.com/envio.png',
      campo_antigo: 'ignorar',
    })
    expect(variables).toEqual({ imagem: 'https://cdn.example.com/envio.png' })
    expect(whatsappDispatchTemplatePreview(template, variables)).toEqual({
      header: '',
      body: 'Mensagem fixa.',
      footer: '',
      mediaType: 'image',
      mediaUrl: 'https://cdn.example.com/envio.png',
      buttons: [{ text: 'Abrir', url: 'https://notify.example.com/fixo' }],
    })
  })

  it('monta runtime de imagem, corpo nomeado e URL posicional preservando campos fixos', () => {
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

    expect(dynamicTemplateParameters(template).map((item) => item.key))
      .toEqual(['header_image', 'body_text', 'invite_slug'])
    const variables = templateVariableValuesForSend(template, {
      header_image: 'https://cdn.example.com/nova.png',
      body_text: 'Descricao dinamica',
      invite_slug: 'grupo-alpha',
      operator_name: 'Nao deve sobrescrever',
      obsoleto: 'Nao deve seguir',
    })
    expect(variables).toEqual({
      header_image: 'https://cdn.example.com/nova.png',
      body_text: 'Descricao dinamica',
      invite_slug: 'grupo-alpha',
      operator_name: 'Notify Flow',
    })
    expect(whatsappDispatchTemplatePreview(template, variables)).toEqual({
      header: '',
      body: 'Descricao dinamica — Notify Flow',
      footer: '',
      mediaType: 'image',
      mediaUrl: 'https://cdn.example.com/nova.png',
      buttons: [{ text: 'Ver convite', url: 'https://notify.example.com/invite/grupo-alpha' }],
    })
  })

  it('não promove placeholder legado a valor fixo de envio', () => {
    expect(templateParameterDefinitions({
      payload: {
        components: [{
          type: 'body',
          parameters: [{ type: 'text', text: '{{cliente}}' }],
        }],
      },
    })[0]).toMatchObject({ key: 'cliente', fixedValue: '' })
  })

  it('normaliza a página remota de falhas e vincula os contatos locais', () => {
    const result = normalizeDeliveryIssuePage({
      items: [{ id: 'issue-1', notificationId: 'notification-1', contactId: 'contact-2', status: 'skipped', errorCode: 'CHANNEL_NOT_AUTHORIZED', errorMessage: 'Sem autorização' }],
      total: 37,
      page: 2,
      limit: 10,
    }, [deniedContact])
    expect(result).toEqual(expect.objectContaining({ total: 37, page: 2, limit: 10 }))
    expect(result.items).toEqual([expect.objectContaining({
      notificationId: 'notification-1',
      contactId: 'contact-2',
      contact: deniedContact,
      errorCode: 'CHANNEL_NOT_AUTHORIZED',
    })])
  })

  it('mantém o resumo do POST independente da presença de deliveries', () => {
    const dispatch = { queuedCount: 12, summary: { skipped: 3, failed: 1 } }
    expect(dispatchDeliveryCount(dispatch, 'queued')).toBe(12)
    expect(dispatchDeliveryCount(dispatch, 'skipped')).toBe(3)
    expect(dispatchDeliveryCount(dispatch, 'failed')).toBe(1)
  })
})

describe('histórico persistente de webhooks da Meta', () => {
  it('normaliza a resposta paginada do endpoint dedicado', () => {
    const result = normalizeWebhookEventPage({
      items: [{ id: 'event-1', field: 'messages' }],
      total: 37,
      page: 2,
      limit: 20,
      pages: 2,
    })

    expect(result).toEqual({
      items: [{ id: 'event-1', field: 'messages' }],
      total: 37,
      page: 2,
      limit: 20,
      pages: 2,
    })
  })

  it('preserva o evento recebido pelo socket quando o refetch ainda não o devolveu', () => {
    const live = {
      id: 'live-event',
      field: 'account_update',
      receivedAt: '2026-07-27T12:01:00.000Z',
    }
    const remote = {
      id: 'remote-event',
      field: 'messages',
      receivedAt: '2026-07-27T12:00:00.000Z',
    }

    expect(mergeWebhookEvents([live], [remote], 20).map((event) => event.id))
      .toEqual(['live-event', 'remote-event'])
  })

  it('substitui uma versão socket pela versão persistida de mesmo id sem duplicar', () => {
    const socketEvent = {
      id: 'event-1',
      field: 'messages',
      processingStatus: 'received',
      receivedAt: '2026-07-27T12:00:00.000Z',
    }
    const persistedEvent = {
      ...socketEvent,
      processingStatus: 'processed',
      summary: { title: 'Mensagem processada' },
    }

    expect(mergeWebhookEvents([socketEvent], [persistedEvent], 20)).toEqual([persistedEvent])
  })

  it('não regride processed do socket quando uma resposta HTTP received chega atrasada', () => {
    const socketProcessed = {
      id: 'event-race',
      field: 'messages',
      processingStatus: 'processed',
      receivedAt: '2026-07-27T12:00:00.000Z',
      processedAt: '2026-07-27T12:00:02.000Z',
      updatedAt: '2026-07-27T12:00:02.000Z',
      summary: { title: 'Processado em tempo real' },
    }
    const staleHttpReceived = {
      id: 'event-race',
      field: 'messages',
      processingStatus: 'received',
      receivedAt: '2026-07-27T12:00:00.000Z',
      lastReceivedAt: '2026-07-27T12:00:03.000Z',
      updatedAt: '2026-07-27T12:00:03.000Z',
      summary: { messageCount: 1 },
    }

    expect(mergeWebhookEventVersions(socketProcessed, staleHttpReceived))
      .toEqual(expect.objectContaining({
        processingStatus: 'processed',
        processedAt: '2026-07-27T12:00:02.000Z',
        summary: {
          messageCount: 1,
          title: 'Processado em tempo real',
        },
      }))
    expect(mergeWebhookEventPage([socketProcessed], [staleHttpReceived]))
      .toEqual([expect.objectContaining({ processingStatus: 'processed' })])
  })

  it('identifica campos conhecidos e mantém fallback amigável para novos campos da Meta', () => {
    expect(webhookEventPresentation({
      field: 'account_alerts',
      eventType: 'verified_account',
      processingStatus: 'processed',
    })).toEqual(expect.objectContaining({
      fieldLabel: 'Alertas da conta',
      eventTypeLabel: 'Verified account',
      statusLabel: 'Processado',
      statusColor: 'positive',
    }))
    expect(webhookEventPresentation({
      field: 'future_meta_field',
      processingStatus: 'received',
    }).fieldLabel).toBe('Future meta field')
    expect(humanizeWebhookKey('group.participants-update')).toBe('Group participants update')
    expect(webhookEventPresentation({ field: 'messages', processingStatus: 'processing' }))
      .toEqual(expect.objectContaining({ statusLabel: 'Processando', statusColor: 'warning' }))
  })

  it('inclui no filtro fields desconhecidos observados na página', () => {
    expect(webhookEventFieldOptionsFrom([{ field: 'new_meta_field_v26' }]))
      .toContainEqual(expect.objectContaining({
        value: 'new_meta_field_v26',
        label: 'New meta field v26',
        icon: 'webhook',
      }))
  })

  it('resume contagens e remove segredos do JSON exibido nos detalhes', () => {
    expect(webhookEventSummary({
      field: 'messages',
      summary: { messageCount: 2, statusCount: 1, contactCount: 1 },
    })).toBe('2 mensagem(ns) · 1 status · 1 contato(s)')

    expect(sanitizeWebhookPayload({
      object: 'whatsapp_business_account',
      access_token: 'segredo',
      nested: { appSecret: 'segredo-2', phone_number_id: '123' },
    })).toEqual({
      object: 'whatsapp_business_account',
      access_token: '[PROTEGIDO]',
      nested: { appSecret: '[PROTEGIDO]', phone_number_id: '123' },
    })
  })
})
