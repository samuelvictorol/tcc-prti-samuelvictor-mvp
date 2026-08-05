import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('quasar', () => ({ useQuasar: () => ({}) }))

import {
  isExternalMetaDeliveryBlock,
  mergeNotificationVariableDefinitions,
  normalizeMetaDeliveryBlocks,
  notificationActivityName,
  notificationActivityType,
  notificationDeliveryDetail,
  notificationGlobalChannelOptions,
  notificationRuntimeVariableValues,
  notificationTemplatePreview,
  notificationTemplateVariableDefinitions,
  notificationVariableScopeKey,
  notificationWhatsAppFixedValues,
} from '../src/pages/NotificationsPage.vue'

describe('compositor amigável de notificações', () => {
  it('identifica o conjunto ou template exibido na atividade recente', () => {
    const templates = [
      { id: 'template-wa', name: 'Aviso WhatsApp' },
      { id: 'template-email', name: 'Aviso Email' },
    ]
    const templateSets = [{ id: 'set-1', name: 'Boas-vindas multicanal' }]

    expect(notificationActivityName({ templateSet: 'set-1' }, templates, templateSets))
      .toBe('Boas-vindas multicanal')
    expect(notificationActivityName({ template: 'template-wa' }, templates, templateSets))
      .toBe('Aviso WhatsApp')
    expect(notificationActivityName({
      templates: { whatsapp_cloud: 'template-wa', email: 'template-email' },
    }, templates, templateSets)).toBe('Aviso WhatsApp · Aviso Email')
    expect(notificationActivityName({ kind: 'quick' }, templates, templateSets))
      .toBe('Mensagem rápida')

    expect(notificationActivityType({ templateSet: 'set-1', kind: 'global' })).toBe('Conjunto')
    expect(notificationActivityType({ template: 'template-wa', kind: 'template' })).toBe('Template')
    expect(notificationActivityType({ kind: 'global', templates: { email: 'template-email' } })).toBe('Template')
    expect(notificationActivityType({ kind: 'quick' })).toBe('Rápida')

    const source = readFileSync(fileURLToPath(new URL('../src/pages/NotificationsPage.vue', import.meta.url)), 'utf8')
    expect(source).toContain("label: 'Conjunto / template'")
    expect(source).toContain('<q-td :props="props">{{ activityType(props.row) }}</q-td>')
  })

  it('descobre variáveis declaradas, placeholders e parâmetros do builder sem JSON manual', () => {
    const definitions = notificationTemplateVariableDefinitions({
      variables: [{ key: 'protocolo', label: 'Número do protocolo' }],
      body: 'Olá {{nomeCampanha}}, protocolo {{protocolo}} para {{displayName}}.',
      payload: {
        builder: {
          components: [{
            type: 'header',
            parameters: [{
              key: 'imagem',
              label: 'Imagem principal',
              type: 'image',
              example: 'https://example.com/a.png',
              mediaSource: 'upload',
              mediaAssetId: '507f1f77bcf86cd799439011',
            }],
          }],
        },
      },
    }, 'telegram')

    expect(definitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'protocolo', label: 'Número do protocolo' }),
      expect.objectContaining({ key: 'nomeCampanha' }),
      expect.objectContaining({
        key: 'imagem',
        type: 'image',
        mediaSource: 'upload',
        mediaAssetId: '507f1f77bcf86cd799439011',
      }),
    ]))
    expect(definitions.some((item) => item.key === 'displayName')).toBe(false)
  })

  it('não pede dados variáveis no fluxo comum de template ou conjunto', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/pages/NotificationsPage.vue', import.meta.url)), 'utf8')

    expect(source).not.toContain('Dados variáveis')
    expect(source).not.toContain('form.variableValues')
    expect(source).not.toContain('v-for="definition in variableDefinitions"')
    expect(source).toContain('variables: {}')
  })

  it('une a mesma variável usada por canais diferentes', () => {
    const definitions = mergeNotificationVariableDefinitions([
      { channel: 'telegram', template: { body: 'Olá {{codigo}}' } },
      { channel: 'email', template: { subject: 'Código {{codigo}}' } },
    ])

    expect(definitions).toEqual([
      expect.objectContaining({ key: 'codigo', channels: ['telegram', 'email'] }),
    ])
  })

  it('isola dados runtime ao trocar aba, template, conjunto ou selecao manual', () => {
    const base = {
      tab: 'global',
      channel: 'whatsapp_cloud',
      templateId: 'template-1',
      globalSelectionMode: 'set',
      templateSetId: 'set-1',
      templateIds: { whatsapp_cloud: 'wa-1', telegram: 'tg-1' },
    }
    const key = notificationVariableScopeKey(base)

    expect(notificationVariableScopeKey({ ...base, tab: 'template' })).not.toBe(key)
    expect(notificationVariableScopeKey({ ...base, channel: 'telegram' })).not.toBe(key)
    expect(notificationVariableScopeKey({ ...base, templateId: 'template-2' })).not.toBe(key)
    expect(notificationVariableScopeKey({ ...base, globalSelectionMode: 'manual' })).not.toBe(key)
    expect(notificationVariableScopeKey({ ...base, templateSetId: 'set-2' })).not.toBe(key)
    expect(notificationVariableScopeKey({
      ...base,
      templateIds: { whatsapp_cloud: 'wa-2', telegram: 'tg-1' },
    })).not.toBe(key)
    expect(notificationVariableScopeKey({
      ...base,
      templateIds: { telegram: 'tg-1', whatsapp_cloud: 'wa-1' },
    })).toBe(key)

    const source = readFileSync(fileURLToPath(new URL('../src/pages/NotificationsPage.vue', import.meta.url)), 'utf8')
    expect(source).toContain('watch(activeVariableScopeKey, () => {')
    expect(source).toContain('form.variables = {}')
    expect(source).toContain('watch(activeVariableDefinitions, (definitions) => {')
  })

  it('envia mapa templateIds e não oferece rápido global nem editor JSON', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/pages/NotificationsPage.vue', import.meta.url)), 'utf8')

    expect(source).toContain('templateIds')
    expect(source).toContain('form.templateIds[channel.value]')
    expect(source).not.toContain('variablesJson')
    expect(source).not.toContain('quickChannelOptions')
    expect(source).toContain(':options="panel === \'quick\' ? quickEnabledChannelOptions : templateEnabledChannelOptions"')
  })

  it('abre no template global e ordena os modos do mais amplo para o rápido', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/pages/NotificationsPage.vue', import.meta.url)), 'utf8')
    const globalTab = source.indexOf('<q-tab name="global"')
    const templateTab = source.indexOf('<q-tab name="template"')
    const quickTab = source.indexOf('<q-tab name="quick"')

    expect(source).toContain("const tab = ref('global')")
    expect(globalTab).toBeGreaterThan(-1)
    expect(globalTab).toBeLessThan(templateTab)
    expect(templateTab).toBeLessThan(quickTab)
    expect(source).toContain("v-for=\"panel in ['global', 'template', 'quick']\"")
  })

  it('mantém o formulário enxuto sem os banners explicativos removidos', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/pages/NotificationsPage.vue', import.meta.url)), 'utf8')

    expect(source).not.toContain('Escolha um, dois ou três canais')
    expect(source).not.toContain('Ativos agora:')
    expect(source).not.toContain('WhatsApp oficial usa um formulário próprio')
    expect(source).not.toContain('Nome aprovado, componentes e permissões são montados sem JSON')
  })

  it('aceita qualquer combinação não vazia de canais no template global', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/pages/NotificationsPage.vue', import.meta.url)), 'utf8')

    expect(source).toContain('selectedGlobalChannelOptions')
    expect(source).toContain('Selecione ao menos um canal e seu respectivo template.')
    expect(source).toContain('Template ${channel.label} (opcional)')
    expect(source).not.toContain('const missing = enabledChannelOptions.value.filter')
  })

  it('permite alternar entre um conjunto e a seleção manual por canal', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/pages/NotificationsPage.vue', import.meta.url)), 'utf8')

    expect(source).toContain("const globalSelectionMode = ref('set')")
    expect(source).toContain("fetchAll('/template-sets'")
    expect(source).toContain('v-model="form.templateSetId"')
    expect(source).toContain("{ label: 'Conjunto', value: 'set'")
    expect(source).toContain("{ label: 'Por canal', value: 'manual'")
    expect(source).toContain("globalSelectionMode.value === 'set'")
    expect(source).toContain('templateSetId:')
    expect(source).toContain("globalSelectionMode.value === 'manual'")
  })

  it('mantém todos os canais do conjunto na revisão e trata disponibilidade somente como aviso', () => {
    const channels = [
      { value: 'whatsapp_cloud', label: 'WhatsApp Cloud', enabled: false },
      { value: 'telegram', label: 'Telegram', enabled: true },
      { value: 'email', label: 'Email', enabled: false },
    ]
    const templateIds = {
      whatsapp_cloud: 'wa-1',
      telegram: 'tg-1',
      email: 'mail-1',
    }

    expect(notificationGlobalChannelOptions(channels, templateIds, 'set').map((item) => item.value))
      .toEqual(['whatsapp_cloud', 'telegram', 'email'])
    expect(notificationGlobalChannelOptions(channels, templateIds, 'manual').map((item) => item.value))
      .toEqual(['telegram'])

    const source = readFileSync(fileURLToPath(new URL('../src/pages/NotificationsPage.vue', import.meta.url)), 'utf8')
    expect(source).toContain('unavailableGlobalChannelOptions')
    expect(source).toContain("globalSelectionMode.value === 'manual' && !enabledChannelOptions.value.length")
    expect(source).toContain("item.enabled ? 'Selecionado' : 'Canal indisponível'")
  })

  it('monta uma prévia amigável por canal sem renderizar HTML bruto', () => {
    expect(notificationTemplatePreview({
      name: 'Boas-vindas',
      subject: 'Olá {{nome}}',
      html: '<p>Bem-vindo, <strong>{{nome}}</strong>.</p><script>alert(1)</script>',
    }, 'email', { nome: 'Ana' })).toEqual(expect.objectContaining({
      subject: 'Olá Ana',
      body: 'Bem-vindo, Ana.',
      html: '<p>Bem-vindo, <strong>Ana</strong>.</p><script>alert(1)</script>',
    }))

    const whatsappTemplate = {
      name: 'Pedido',
      externalTemplateName: 'order_confirmed',
      languageCode: 'pt_BR',
      description: 'Descrição interna que não deve aparecer',
      payload: {
        builder: {
          components: [
            {
              type: 'header',
              parameters: [{ key: 'capa', type: 'image', fixedValue: 'https://cdn.example.com/capa.png' }],
            },
            {
              type: 'body',
              text: 'Pedido {{1}} confirmado para {{cliente}}.',
              parameters: [
                { key: 'codigo', fixedValue: 'ABC-123' },
                { key: 'cliente', fixedValue: 'Ana' },
              ],
            },
            { type: 'footer', text: 'Notify Flow' },
            { type: 'button', text: 'Acompanhar', url: 'https://example.com/pedidos/{{codigo}}' },
          ],
        },
      },
    }
    expect(notificationWhatsAppFixedValues(whatsappTemplate)).toEqual(expect.objectContaining({
      codigo: 'ABC-123',
      cliente: 'Ana',
      capa: 'https://cdn.example.com/capa.png',
    }))
    expect(notificationWhatsAppFixedValues({
      payload: { builder: { components: [{ parameters: [{ key: 'somenteExemplo', example: 'NÃO ENVIAR' }] }] } },
    })).toEqual({})
    expect(notificationTemplateVariableDefinitions(whatsappTemplate, 'whatsapp_cloud')).toEqual([])
    expect(notificationTemplatePreview(whatsappTemplate, 'whatsapp_cloud', { codigo: 'IGNORADO' })).toEqual(expect.objectContaining({
      officialName: 'order_confirmed',
      languageCode: 'pt_BR',
      body: 'Pedido ABC-123 confirmado para Ana.',
      footer: 'Notify Flow',
      mediaType: 'image',
      mediaUrl: 'https://cdn.example.com/capa.png',
      buttons: [expect.objectContaining({ text: 'Acompanhar', url: 'https://example.com/pedidos/ABC-123' })],
    }))

    expect(notificationTemplatePreview({
      body: 'Imagem',
      payload: {
        telegram: {
          kind: 'photo',
          mediaUrl: 'https://cdn.example.com/imagem.jpg',
          caption: 'Olá {{nome}}',
        },
      },
    }, 'telegram', { nome: 'Ana' })).toEqual(expect.objectContaining({
      body: 'Olá Ana',
      mediaType: 'photo',
      mediaUrl: 'https://cdn.example.com/imagem.jpg',
    }))
  })

  it('mantem o legado com apenas a imagem dinamica sem transformar o exemplo em valor fixo', () => {
    const template = {
      externalTemplateName: 'convite_imagem_legado',
      languageCode: 'pt_BR',
      payload: {
        builder: {
          components: [
            {
              type: 'header',
              parameters: [{
                key: 'imagem_cabecalho',
                label: 'Link da imagem',
                type: 'image',
                example: 'https://cdn.example.com/amostra.png',
              }],
            },
            { type: 'body', text: 'Texto fixo aprovado pela Meta.' },
            { type: 'button', text: 'Abrir convite', url: 'https://notify.example.com/invite/fixo' },
          ],
        },
      },
    }

    const definitions = notificationTemplateVariableDefinitions(template, 'whatsapp_cloud')
    expect(definitions).toEqual([expect.objectContaining({
      key: 'imagem_cabecalho',
      label: 'Link da imagem',
      type: 'image',
      example: 'https://cdn.example.com/amostra.png',
      componentType: 'header',
    })])
    expect(notificationRuntimeVariableValues(definitions, {
      imagem_cabecalho: 'https://cdn.example.com/envio.png',
      campo_obsoleto: 'nao enviar',
    })).toEqual({ imagem_cabecalho: 'https://cdn.example.com/envio.png' })
    expect(notificationTemplatePreview(template, 'whatsapp_cloud', {
      imagem_cabecalho: 'https://cdn.example.com/envio.png',
    })).toEqual(expect.objectContaining({
      body: 'Texto fixo aprovado pela Meta.',
      mediaType: 'image',
      mediaUrl: 'https://cdn.example.com/envio.png',
      buttons: [{ text: 'Abrir convite', url: 'https://notify.example.com/invite/fixo' }],
    }))
  })

  it('preenche imagem, corpo nomeado e sufixo posicional do botao sem expor valores fixos', () => {
    const template = {
      externalTemplateName: 'notify_flow_dinamic_image_description',
      languageCode: 'pt_BR',
      payload: {
        builder: {
          components: [
            { type: 'header', parameters: [{ key: 'header_image', label: 'Imagem', type: 'image' }] },
            {
              type: 'body',
              text: '{{body_description}}\nAssinado por {{operator_name}}',
              parameters: [
                { key: 'body_text', parameterName: 'body_description', label: 'Descricao', type: 'text' },
                { key: 'operator_name', parameterName: 'operator_name', label: 'Operador', type: 'text', fixedValue: 'Notify Flow' },
              ],
            },
            {
              type: 'button',
              text: 'Ver convite',
              url: 'https://notify.example.com/invite/{{1}}',
              parameters: [{ key: 'invite_slug', label: 'Slug do convite', type: 'text' }],
            },
          ],
        },
      },
    }

    const definitions = notificationTemplateVariableDefinitions(template, 'whatsapp_cloud')
    expect(definitions.map((item) => item.key)).toEqual(['header_image', 'body_text', 'invite_slug'])
    expect(definitions.find((item) => item.key === 'body_text')).toMatchObject({
      parameterName: 'body_description',
      componentType: 'body',
    })
    const runtime = notificationRuntimeVariableValues(definitions, {
      header_image: 'https://cdn.example.com/campanha.png',
      body_text: 'Conteudo desta campanha.',
      invite_slug: 'grupo-alpha',
      operator_name: 'Tentativa de sobrescrita',
    })
    expect(runtime).toEqual({
      header_image: 'https://cdn.example.com/campanha.png',
      body_text: 'Conteudo desta campanha.',
      invite_slug: 'grupo-alpha',
    })
    expect(notificationTemplatePreview(template, 'whatsapp_cloud', runtime)).toEqual(expect.objectContaining({
      body: 'Conteudo desta campanha.\nAssinado por Notify Flow',
      mediaUrl: 'https://cdn.example.com/campanha.png',
      buttons: [{ text: 'Ver convite', url: 'https://notify.example.com/invite/grupo-alpha' }],
    }))
  })

  it('usa uma q-dialog responsiva para revisar os canais antes da fila', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/pages/NotificationsPage.vue', import.meta.url)), 'utf8')

    expect(source).toContain('<q-dialog v-model="reviewDialog" persistent :maximized="$q.screen.lt.sm">')
    expect(source).toContain('v-for="item in reviewItems"')
    expect(source).toContain('Confirmar e colocar na fila')
    expect(source).toContain('@click="confirmSend"')
    expect(source).toContain('v-html="safeReviewHtml(item.preview.html)"')
    expect(source).toContain('item.preview.mediaUrl')
    expect(source).not.toContain('$q.dialog({')
  })

  it('explica sucesso, erro e itens ignorados sem ocultar o motivo do provedor', () => {
    expect(notificationDeliveryDetail({ status: 'sent' })).toBe('Envio aceito pelo provedor')
    expect(notificationDeliveryDetail({ status: 'skipped' }))
      .toBe('Contato ignorado pelas regras de elegibilidade do canal')
    expect(notificationDeliveryDetail({
      status: 'failed',
      errorMessage: 'Template não aprovado para este número',
    })).toBe('Template não aprovado para este número')
  })

  it('abre um histórico paginado por contato e canal e evita scroll horizontal da página', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/pages/NotificationsPage.vue', import.meta.url)), 'utf8')

    expect(source).toContain('openDispatchDetails')
    expect(source).toContain('`/notifications/${id}/deliveries`')
    expect(source).toContain('v-model:pagination="dispatchDetailPagination"')
    expect(source).toContain('Status por contato e canal')
    expect(source).toContain('notificationDeliveryDetail(props.row)')
    expect(source).toContain('@request="requestDispatchDetailPage"')
    expect(source).toContain('.page-container {')
    expect(source).toContain('overflow-x: clip')
    expect(source).toContain('.composer-tabs {')
    expect(source).toContain('overflow-x: auto')
    expect(source).toContain(':grid="$q.screen.lt.md"')
  })

  it('reconhece somente bloqueios externos da Meta e exclui falhas internas', () => {
    expect(isExternalMetaDeliveryBlock({
      channel: 'whatsapp_cloud',
      errorCode: 'META_131049',
      provider: 'meta',
    })).toBe(true)
    expect(isExternalMetaDeliveryBlock({
      channel: 'whatsapp_cloud',
      errorCode: 'INTERNAL_ERROR_131049',
      provider: 'notify-flow',
    })).toBe(false)
    expect(isExternalMetaDeliveryBlock({
      channel: 'email',
      errorCode: 'META_131049',
      provider: 'meta',
    })).toBe(false)
  })

  it('agrupa bloqueios equivalentes da Meta preservando usuários, entregas e retry de 24h', () => {
    const blocks = normalizeMetaDeliveryBlocks({
      items: [
        {
          id: 'delivery-1',
          channel: 'whatsapp_cloud',
          provider: 'meta',
          errorCode: 'META_131049',
          errorCategory: 'engagement',
          errorMessage: 'In order to maintain a healthy ecosystem engagement, the message failed to be delivered.',
          contactId: 'contact-1',
          contactName: 'Ana',
          automaticRetryAt: '2026-08-03T15:00:00.000Z',
          automaticRetryStatus: 'scheduled',
          updatedAt: '2026-08-02T15:00:00.000Z',
        },
        {
          id: 'delivery-2',
          channel: 'whatsapp_cloud',
          provider: 'meta',
          errorCode: '131049',
          errorCategory: 'engagement',
          contactId: 'contact-2',
          contactName: 'Bruno',
          automaticRetryAt: '2026-08-03T15:05:00.000Z',
          automaticRetryStatus: 'scheduled',
          updatedAt: '2026-08-02T15:05:00.000Z',
        },
        {
          id: 'delivery-internal',
          channel: 'whatsapp_cloud',
          provider: 'notify-flow',
          errorCode: 'INTERNAL_ERROR_50001',
        },
      ],
    })

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual(expect.objectContaining({
      code: 'META_131049',
      deliveryCount: 2,
      contactCount: 2,
      deliveryIds: ['delivery-1', 'delivery-2'],
      automaticRetryAt: '2026-08-03T15:00:00.000Z',
      automaticRetryStatus: 'scheduled',
    }))
    expect(blocks[0].contacts.map((contact) => contact.name)).toEqual(['Ana', 'Bruno'])
  })

  it('normaliza o resumo agregado da API e libera retry manual somente após o automático', () => {
    const [block] = normalizeMetaDeliveryBlocks({
      items: [{
        id: 'meta:META_131049',
        provider: 'meta',
        errorCode: 'META_131049',
        errorMessage: 'Bloqueio de engajamento',
        affectedDeliveries: 12,
        affectedContacts: 10,
        pendingAutomaticRetry: 1,
        automaticRetryAttempted: 2,
        currentFailures: 2,
        latestAt: '2026-08-02T18:00:00.000Z',
        deliveries: [
          {
            id: 'delivery-waiting',
            notificationId: 'notification-a',
            contactId: 'contact-a',
            status: 'failed',
            automaticRetryAttempts: 0,
            retryNotBefore: '2026-08-03T18:00:00.000Z',
          },
          {
            id: 'delivery-manual',
            notificationId: 'notification-b',
            contactId: 'contact-b',
            status: 'failed',
            automaticRetryAttempts: 1,
            automaticRetryAttemptedAt: '2026-08-03T18:05:00.000Z',
          },
        ],
      }],
    })

    expect(block).toEqual(expect.objectContaining({
      deliveryCount: 12,
      contactCount: 10,
      automaticRetryStatus: 'scheduled',
      automaticRetryAttempted: true,
      retryable: true,
      deliveryIds: ['delivery-manual'],
      updatedAt: '2026-08-02T18:00:00.000Z',
    }))
    expect(block.deliveries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'delivery-waiting', retryable: false }),
      expect.objectContaining({ id: 'delivery-manual', retryable: true }),
    ]))
  })

  it('exibe painel responsivo, detalhes e retry manual sem esconder a regra automática única', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/pages/NotificationsPage.vue', import.meta.url)), 'utf8')

    expect(source).toContain("http.get('/notifications/meta-delivery-blocks'")
    expect(source).toContain('`/notifications/external-provider-issues/${encodeURIComponent(block.code)}/retry`')
    expect(source).toContain('Bloqueios temporários da Meta')
    expect(source).toContain('uma única tentativa automática após 24 horas')
    expect(source).toContain('Tentar novamente')
    expect(source).not.toContain('Erros internos do Notify Flow não aparecem aqui')
    expect(source).toContain('v-model="metaBlockDetailDialog"')
    expect(source).toContain(':grid="$q.screen.lt.md"')
  })
})
