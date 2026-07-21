import { describe, expect, it, vi } from 'vitest'

vi.mock('quasar', () => ({ useQuasar: () => ({}) }))
import {
  WHATSAPP_CLOUD_PRESETS,
  buildWhatsAppCloudTemplateDefinition,
  findWhatsAppCloudPreset,
  renderWhatsAppCloudPreview,
} from '../src/pages/TemplatesPage.vue'

describe('templates oficiais do WhatsApp Cloud', () => {
  it('expõe somente os três modelos habilitados pela Meta', () => {
    expect(WHATSAPP_CLOUD_PRESETS.map((preset) => preset.value)).toEqual([
      'order_confirmation',
      'plain_text',
      'hello_world',
    ])
  })

  it('gera os componentes da confirmação de pedido sem exigir JSON do usuário', () => {
    expect(buildWhatsAppCloudTemplateDefinition('order_confirmation')).toEqual({
      whatsappCloudPreset: 'order_confirmation',
      templateType: 'approved_template',
      externalTemplateName: 'jaspers_market_order_confirmation_v1',
      languageCode: 'en_US',
      body: 'Pedido {{orderNumber}} de {{customerName}} confirmado em {{orderDate}}.',
      variables: ['customerName', 'orderNumber', 'orderDate'],
      payload: {
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: '{{customerName}}' },
            { type: 'text', text: '{{orderNumber}}' },
            { type: 'text', text: '{{orderDate}}' },
          ],
        }],
      },
    })
  })

  it.each([
    ['plain_text', 'jaspers_market_plain_text_v1'],
    ['hello_world', 'hello_world'],
  ])('não inventa componentes para o modelo %s', (preset, templateName) => {
    const definition = buildWhatsAppCloudTemplateDefinition(preset)
    expect(definition.externalTemplateName).toBe(templateName)
    expect(definition.variables).toEqual([])
    expect(definition.payload).toEqual({})
  })

  it('reconhece registros antigos pelo nome oficial e monta uma prévia legível', () => {
    expect(findWhatsAppCloudPreset('hello_world').value).toBe('hello_world')
    expect(findWhatsAppCloudPreset('jaspers_market_plain_text_v1').value).toBe('plain_text')
    expect(renderWhatsAppCloudPreview('order_confirmation'))
      .toBe('Pedido 123456 de John Doe confirmado em Jul 20, 2026.')
  })
})
