import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('quasar', () => ({ useQuasar: () => ({}) }))
import {
  META_LANGUAGE_OPTIONS,
  WHATSAPP_CLOUD_PRESETS,
  buildCustomWhatsAppCloudDefinition,
  buildCustomWhatsAppCloudPreviewPayload,
  buildWhatsAppCloudTemplateDefinition,
  cloudMediaAccept,
  cloudMediaExampleLabel,
  cloudMediaMaxBytes,
  cloudBuilderFromTemplate,
  createCloudParameter,
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

  it('pré-configura variáveis e rótulos amigáveis para cada mídia Meta', () => {
    expect(createCloudParameter({ type: 'image' })).toMatchObject({ key: 'imagem_cabecalho', label: 'Link da imagem', mediaSource: 'url' })
    expect(createCloudParameter({ type: 'video' })).toMatchObject({ key: 'video_cabecalho', label: 'Link do vídeo', mediaType: '' })
    expect(createCloudParameter({ type: 'document' })).toMatchObject({ key: 'arquivo_cabecalho', label: 'Link do arquivo' })
    expect(cloudMediaExampleLabel('document')).toBe('Link do arquivo')
    expect(cloudMediaAccept('image')).toBe('image/jpeg,image/png')
    expect(cloudMediaAccept('image')).not.toContain('webp')
    expect(cloudMediaMaxBytes('image')).toBe(5 * 1024 * 1024)
    expect(cloudMediaMaxBytes('video')).toBe(16 * 1024 * 1024)
    expect(cloudMediaMaxBytes('document')).toBe(100 * 1024 * 1024)
  })

  it('preserva no builder os metadados da mídia hospedada pelo Notify Flow', () => {
    const definition = buildCustomWhatsAppCloudDefinition({
      templateName: 'aviso_com_imagem',
      languageCode: 'pt_BR',
      components: [createCloudComponent({
        type: 'header',
        parameters: [{
          type: 'image',
          key: 'imagem_cabecalho',
          label: 'Link da imagem',
          example: 'https://notify.example/media/asset-1',
          mediaSource: 'upload',
          mediaAssetId: 'asset-1',
          mimeType: 'image/png',
          mediaType: 'image',
          uploadedFilename: 'capa.png',
        }],
      })],
    })

    expect(definition.payload.builder.components[0].parameters[0]).toMatchObject({
      mediaSource: 'upload',
      mediaAssetId: 'asset-1',
      mimeType: 'image/png',
      mediaType: 'image',
      uploadedFilename: 'capa.png',
    })
  })

  it.each([
    ['image', 'https://notify.example/capa.png', 'image'],
    ['video', 'https://notify.example/video.mp4', 'video'],
  ])('mostra o payload Meta formatado para %s', (type, url, payloadKey) => {
    const payload = buildCustomWhatsAppCloudPreviewPayload({
      templateName: 'midias_aprovadas',
      languageCode: 'pt_BR',
      components: [{ type: 'header', parameters: [{ type, key: 'midia', example: url }] }],
    })

    expect(payload.template.components[0].parameters[0]).toEqual({
      type,
      [payloadKey]: { link: url },
    })
  })

  it('mostra o payload Meta formatado para documento e preserva o nome do arquivo', () => {
    const payload = buildCustomWhatsAppCloudPreviewPayload({
      templateName: 'midias_aprovadas',
      languageCode: 'pt_BR',
      components: [{
        type: 'header',
        parameters: [{ type: 'document', key: 'arquivo', example: 'https://notify.example/arquivo.pdf', filename: 'arquivo.pdf' }],
      }],
    })

    expect(payload).toMatchObject({
      messaging_product: 'whatsapp',
      type: 'template',
      template: {
        name: 'midias_aprovadas',
        language: { code: 'pt_BR' },
        components: [{
          type: 'header',
          parameters: [{ type: 'document', document: { link: 'https://notify.example/arquivo.pdf', filename: 'arquivo.pdf' } }],
        }],
      },
    })
  })

  it('oferece somente os idiomas suportados no formulário amigável', () => {
    expect(META_LANGUAGE_OPTIONS.map((option) => option.value)).toEqual(['pt_BR', 'en_US'])
  })

  it('oferece upload multipart, prévia visual e inspeção do payload sem JSON manual', () => {
    const source = readFileSync(new URL('../src/pages/TemplatesPage.vue', import.meta.url), 'utf8')
    expect(source).toContain("body.append('file', file)")
    expect(source).toContain("http.post('/media', body, { timeout: 600000 })")
    expect(source).toContain("body.append('mediaType', parameter.type)")
    expect(source).toContain("body.append('purpose', 'template')")
    expect(source).toContain('<q-file')
    expect(source).toContain("{ label: 'Payload', value: 'payload', icon: 'data_object' }")
    expect(source).toContain('<pre>{{ cloudPreviewPayloadJson }}</pre>')
    expect(source).toContain(':options="META_LANGUAGE_OPTIONS"')
  })
})
