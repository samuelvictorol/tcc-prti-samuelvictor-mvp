import { describe, expect, it, vi } from 'vitest'

vi.mock('quasar', () => ({ useQuasar: () => ({}) }))
import {
  WHATSAPP_CLOUD_PRESETS,
  buildCustomWhatsAppCloudDefinition,
  buildWhatsAppCloudTemplateDefinition,
  cloudBuilderFromTemplate,
  createCloudComponent,
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

  it('monta um template oficial personalizado com builder editável e payload Meta', () => {
    const component = createCloudComponent({
      id: 'body-main',
      type: 'body',
      parameters: [{ id: 'body-name', type: 'text', key: 'nomeCliente', parameterName: 'nome_cliente', label: 'Nome do cliente', example: 'Samuel' }],
    })
    const definition = buildCustomWhatsAppCloudDefinition({
      templateName: 'confirmacao_personalizada_v1',
      languageCode: 'pt_BR',
      description: 'Confirma um cadastro.',
      components: [component],
    })

    expect(definition.whatsappCloudPreset).toBe('custom')
    expect(definition.externalTemplateName).toBe('confirmacao_personalizada_v1')
    expect(definition.variables).toEqual(['nomeCliente'])
    expect(definition.payload.components).toBeUndefined()
    expect(definition.payload.builder.components[0].parameters[0]).toMatchObject({
      key: 'nomeCliente',
      parameterName: 'nome_cliente',
      label: 'Nome do cliente',
      example: 'Samuel',
    })
  })

  it('reabre a estrutura amigável salva sem depender de JSON manual', () => {
    const components = cloudBuilderFromTemplate({
      payload: {
        builder: {
          version: 1,
          components: [{ id: 'header-main', type: 'header', parameters: [{ id: 'header-image', type: 'image', key: 'imagem', label: 'Imagem', example: 'https://example.com/image.png' }] }],
        },
      },
    })
    expect(components).toHaveLength(1)
    expect(components[0].parameters[0]).toMatchObject({ type: 'image', key: 'imagem', label: 'Imagem' })
  })

  it('preserva o tipo coupon_code usado pelo botão copiar código da Meta', () => {
    const definition = buildCustomWhatsAppCloudDefinition({
      templateName: 'cupom_aprovado',
      languageCode: 'pt_BR',
      components: [createCloudComponent({
        type: 'button',
        subType: 'copy_code',
        index: '0',
        parameters: [{ type: 'coupon_code', key: 'cupom', label: 'Código do cupom' }],
      })],
    })

    expect(definition.payload.builder.components[0]).toMatchObject({
      type: 'button',
      subType: 'copy_code',
      parameters: [{ type: 'coupon_code', key: 'cupom' }],
    })
  })
})
