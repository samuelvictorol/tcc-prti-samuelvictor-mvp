import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('quasar', () => ({ useQuasar: () => ({}) }))

import {
  mergeNotificationVariableDefinitions,
  notificationDeliveryDetail,
  notificationGlobalChannelOptions,
  notificationTemplatePreview,
  notificationTemplateVariableDefinitions,
  notificationWhatsAppFixedValues,
} from '../src/pages/NotificationsPage.vue'

describe('compositor amigável de notificações', () => {
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
})
