import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('quasar', () => ({ useQuasar: () => ({}) }))

import {
  mergeNotificationVariableDefinitions,
  notificationTemplatePreview,
  notificationTemplateVariableDefinitions,
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
            parameters: [{ key: 'imagem', label: 'Imagem principal', type: 'image', example: 'https://example.com/a.png' }],
          }],
        },
      },
    }, 'telegram')

    expect(definitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'protocolo', label: 'Número do protocolo' }),
      expect.objectContaining({ key: 'nomeCampanha' }),
      expect.objectContaining({ key: 'imagem', type: 'image' }),
    ]))
    expect(definitions.some((item) => item.key === 'displayName')).toBe(false)
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

  it('aceita qualquer combinação não vazia de canais no template global', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/pages/NotificationsPage.vue', import.meta.url)), 'utf8')

    expect(source).toContain('selectedGlobalChannelOptions')
    expect(source).toContain('Selecione ao menos um canal e seu respectivo template.')
    expect(source).toContain('Template ${channel.label} (opcional)')
    expect(source).not.toContain('const missing = enabledChannelOptions.value.filter')
  })

  it('monta uma prévia amigável por canal sem renderizar HTML bruto', () => {
    expect(notificationTemplatePreview({
      name: 'Boas-vindas',
      subject: 'Olá {{nome}}',
      html: '<p>Bem-vindo, <strong>{{nome}}</strong>.</p><script>alert(1)</script>',
    }, 'email', { nome: 'Ana' })).toEqual(expect.objectContaining({
      subject: 'Olá Ana',
      body: 'Bem-vindo, Ana.',
    }))

    expect(notificationTemplatePreview({
      name: 'Pedido',
      externalTemplateName: 'order_confirmed',
      languageCode: 'pt_BR',
      body: 'Pedido {{codigo}} confirmado.',
    }, 'whatsapp_cloud', { codigo: 'ABC-123' })).toEqual(expect.objectContaining({
      officialName: 'order_confirmed',
      languageCode: 'pt_BR',
      body: 'Pedido ABC-123 confirmado.',
    }))
  })

  it('usa uma q-dialog responsiva para revisar os canais antes da fila', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/pages/NotificationsPage.vue', import.meta.url)), 'utf8')

    expect(source).toContain('<q-dialog v-model="reviewDialog" persistent :maximized="$q.screen.lt.sm">')
    expect(source).toContain('v-for="item in reviewItems"')
    expect(source).toContain('Confirmar e colocar na fila')
    expect(source).toContain('@click="confirmSend"')
    expect(source).not.toContain('$q.dialog({')
  })
})
