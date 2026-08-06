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
  cloudMediaContentMode,
  cloudMediaDisplayValue,
  cloudMediaExampleLabel,
  cloudMediaMaxBytes,
  cloudBodyContentMode,
  cloudBodyHasAdvancedParameters,
  cloudBodyVariableParameter,
  cloudButtonBaseUrl,
  cloudButtonSuffixParameter,
  cloudButtonUrlMode,
  cloudBuilderFromTemplate,
  cloudParameterDisplayValue,
  cloudParameterValueMode,
  cloneCloudComponentsForDraft,
  createCloudParameter,
  createCloudComponent,
  createOptionalStandardComponent,
  createStandardMarketingComponents,
  findWhatsAppCloudPreset,
  isForbiddenWhatsAppButtonUrl,
  isSystemTemplateRecord,
  isValidHttpsTemplateUrl,
  meaningfulCloudComponents,
  previewCloudButtonUrl,
  previewCloudComponentText,
  reconcileCloudButtonUrlParameter,
  renameCloudBodyVariable,
  renderWhatsAppPreviewMarkup,
  renderWhatsAppCloudPreview,
  setCloudBodyContentMode,
  setCloudButtonUrlMode,
  setCloudMediaContentMode,
  setCloudParameterValueMode,
  standardMarketingComponentsFromTemplate,
  templateCopyName,
  updateCloudButtonBaseUrl,
  updateCloudMediaValue,
  updateCloudParameterValue,
  validateCustomWhatsAppCloudTemplate,
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

  it('salva um template de teste somente com título e nome oficial, usando pt_BR como padrão', () => {
    const blankComponents = createStandardMarketingComponents({
      body: '',
      footer: '',
      buttonText: '',
      buttonUrl: '',
    })
    const definition = buildCustomWhatsAppCloudDefinition({
      templateName: 'modelo_minimo_teste',
      languageCode: '',
      components: blankComponents,
    })
    const preview = buildCustomWhatsAppCloudPreviewPayload({
      templateName: 'modelo_minimo_teste',
      languageCode: '',
      components: blankComponents,
    })

    expect(validateCustomWhatsAppCloudTemplate({
      templateName: 'modelo_minimo_teste',
      languageCode: '',
      components: blankComponents,
    })).toBeNull()
    expect(definition).toMatchObject({
      externalTemplateName: 'modelo_minimo_teste',
      languageCode: 'pt_BR',
      body: null,
      variables: [],
    })
    expect(definition.payload.builder.components).toEqual([])
    expect(preview.template).toEqual({
      name: 'modelo_minimo_teste',
      language: { code: 'pt_BR' },
    })
  })

  it('valida componentes opcionais somente quando o operador começa a preenchê-los', () => {
    const blankHeader = createCloudComponent({
      type: 'header',
      parameters: [{ type: 'image', key: 'midia_cabecalho', label: 'Mídia do cabeçalho' }],
    })
    const invalidHeader = createCloudComponent({
      type: 'header',
      parameters: [{ type: 'image', key: 'midia_cabecalho', label: 'Mídia do cabeçalho', fixedValue: 'http://example.com/capa.png' }],
    })
    const partialButton = createCloudComponent({ type: 'button', text: 'Abrir', url: '' })
    const completeButton = createCloudComponent({ type: 'button', text: 'Abrir', url: 'https://example.com/convite' })

    expect(meaningfulCloudComponents([blankHeader])).toEqual([])
    expect(validateCustomWhatsAppCloudTemplate({ templateName: 'teste_minimo', components: [blankHeader] })).toBeNull()
    expect(validateCustomWhatsAppCloudTemplate({ templateName: 'teste_minimo', components: [invalidHeader] }))
      .toContain('URL HTTPS pública')
    expect(validateCustomWhatsAppCloudTemplate({ templateName: 'teste_minimo', components: [partialButton] }))
      .toContain('texto e o link HTTPS')
    expect(validateCustomWhatsAppCloudTemplate({ templateName: 'teste_minimo', components: [completeButton] })).toBeNull()
    expect(validateCustomWhatsAppCloudTemplate({
      templateName: 'teste_minimo',
      components: [createCloudComponent({ type: 'button', text: 'Abrir', url: 'https://wa.me/5511999999999' })],
    })).toContain('não são permitidos')
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

  it('cria novos modelos no perfil Marketing/Padrão sem campos dinâmicos', () => {
    const components = createStandardMarketingComponents({
      media: { fixedValue: 'https://example.com/capa.png' },
    })
    const definition = buildCustomWhatsAppCloudDefinition({
      templateName: 'notify_flow_image_notification',
      languageCode: 'pt_BR',
      description: 'Descrição usada apenas na biblioteca.',
      components,
    })

    expect(definition).toMatchObject({
      description: 'Descrição usada apenas na biblioteca.',
      body: 'Você foi convidado para acompanhar nossas novidades. Toque no botão abaixo para saber mais.',
      variables: [],
      payload: {
        builder: {
          version: 1,
          category: 'marketing',
          mode: 'standard',
        },
      },
    })
    expect(definition.body).not.toContain('Descrição usada apenas')
    expect(definition.payload.builder.components.map((component) => component.type))
      .toEqual(['header', 'body', 'footer', 'button'])
    expect(definition.payload.builder.components.at(-1)).toMatchObject({
      text: 'Saiba mais',
      url: 'https://seudominio.com/',
    })
  })

  it('preserva a mídia dinâmica legada sem promover o exemplo para valor fixo', () => {
    const components = standardMarketingComponentsFromTemplate({
      body: 'Texto oficial',
      payload: {
        builder: {
          components: [{
            type: 'header',
            parameters: [{ type: 'image', key: 'imagem', label: 'Imagem', example: 'https://example.com/capa.png' }],
          }],
        },
      },
    })
    expect(components[0].parameters[0]).toMatchObject({
      example: 'https://example.com/capa.png',
      fixedValue: '',
    })
    expect(components.find((component) => component.type === 'body').text).toBe('Texto oficial')

    const definition = buildCustomWhatsAppCloudDefinition({
      templateName: 'modelo_legado_dinamico',
      components,
    })
    expect(definition.payload.builder.components[0].parameters[0]).toMatchObject({
      example: 'https://example.com/capa.png',
      fixedValue: undefined,
    })
  })

  it('alterna a mídia entre dinâmica por disparo e fixa sem perder a amostra legada', () => {
    const media = createCloudParameter({
      type: 'image',
      key: 'imagem_cabecalho',
      example: 'https://example.com/amostra.png',
    })

    expect(cloudMediaContentMode(media)).toBe('dynamic')
    expect(cloudMediaDisplayValue(media)).toBe('https://example.com/amostra.png')
    updateCloudMediaValue(media, 'https://example.com/nova-amostra.png')
    expect(media).toMatchObject({
      fixedValue: '',
      example: 'https://example.com/nova-amostra.png',
    })

    setCloudMediaContentMode(media, 'fixed')
    expect(cloudMediaContentMode(media)).toBe('fixed')
    expect(media.fixedValue).toBe('https://example.com/nova-amostra.png')
    updateCloudMediaValue(media, 'https://example.com/fixa.png')
    expect(cloudMediaDisplayValue(media)).toBe('https://example.com/fixa.png')

    setCloudMediaContentMode(media, 'dynamic')
    expect(media.fixedValue).toBe('')
    expect(media.example).toBe('https://example.com/fixa.png')
  })

  it('inicia novos cabeçalhos com mídia fixa e mantém o modo explícito de templates existentes', () => {
    const newHeader = createOptionalStandardComponent('header')
    expect(cloudMediaContentMode(newHeader.parameters[0])).toBe('fixed')

    const existingDynamic = createCloudParameter({
      type: 'image',
      contentMode: 'dynamic',
      example: 'https://example.com/amostra.png',
    })
    expect(cloudMediaContentMode(existingDynamic)).toBe('dynamic')
  })

  it('prepara uma cópia independente com nome claro e novos IDs internos', () => {
    const original = [createCloudComponent({
      id: 'component-original',
      type: 'header',
      parameters: [{
        id: 'parameter-original',
        type: 'image',
        key: 'midia_cabecalho',
        label: 'Mídia',
        fixedValue: 'https://example.com/capa.png',
        mediaAssetId: '507f1f77bcf86cd799439011',
      }],
    })]
    const copy = cloneCloudComponentsForDraft(original)

    expect(templateCopyName('Campanha', ['Campanha', 'Campanha (cópia)']))
      .toBe('Campanha (cópia 2)')
    expect(copy[0].id).not.toBe(original[0].id)
    expect(copy[0].parameters[0].id).not.toBe(original[0].parameters[0].id)
    expect(copy[0].parameters[0]).toMatchObject({
      fixedValue: 'https://example.com/capa.png',
      mediaAssetId: '507f1f77bcf86cd799439011',
    })
    copy[0].parameters[0].fixedValue = 'https://example.com/outra.png'
    expect(original[0].parameters[0].fixedValue).toBe('https://example.com/capa.png')
    expect(isSystemTemplateRecord({
      channel: 'whatsapp_cloud',
      externalTemplateName: 'jaspers_market_plain_text_v1_copia',
      systemManaged: false,
      deletable: true,
    })).toBe(false)
  })

  it('configura um corpo nomeado amigável e mantém key, parameterName e marcador sincronizados', () => {
    const body = createCloudComponent({ type: 'body', text: 'Olá!' })

    setCloudBodyContentMode(body, 'dynamic')
    expect(cloudBodyContentMode(body)).toBe('dynamic')
    expect(cloudBodyVariableParameter(body)).toMatchObject({
      key: 'body_description',
      parameterName: 'body_description',
      label: 'Descrição da mensagem',
    })
    expect(body.text).toBe('Olá!\n{{body_description}}')

    renameCloudBodyVariable(body, 'campaign_message')
    expect(body.text).toBe('Olá!\n{{campaign_message}}')
    expect(body.parameters[0]).toMatchObject({
      key: 'campaign_message',
      parameterName: 'campaign_message',
    })
    expect(previewCloudComponentText(body)).toContain('Confira os detalhes desta notificação.')

    const definition = buildCustomWhatsAppCloudDefinition({
      templateName: 'corpo_nomeado',
      components: [body],
    })
    expect(definition.variables).toEqual(['campaign_message'])
    expect(definition.payload.builder.components[0]).toMatchObject({
      type: 'body',
      text: 'Olá!\n{{campaign_message}}',
      parameters: [{
        key: 'campaign_message',
        parameterName: 'campaign_message',
        fixedValue: undefined,
      }],
    })
    expect(validateCustomWhatsAppCloudTemplate({ templateName: 'corpo_nomeado', components: [body] })).toBeNull()
  })

  it('mantém o parâmetro Meta do corpo ao alternar entre valor salvo e valor por disparo', () => {
    const body = createCloudComponent({ type: 'body', text: 'Olá!' })
    setCloudBodyContentMode(body, 'dynamic')
    const parameter = cloudBodyVariableParameter(body)

    expect(cloudParameterValueMode(parameter)).toBe('dynamic')
    setCloudParameterValueMode(parameter, 'fixed', 'Mensagem padrão')
    updateCloudParameterValue(parameter, 'Descrição fixa da campanha')

    expect(cloudParameterValueMode(parameter)).toBe('fixed')
    expect(cloudParameterDisplayValue(parameter)).toBe('Descrição fixa da campanha')
    expect(body.text).toContain('{{body_description}}')
    expect(body.parameters).toHaveLength(1)

    const fixedDefinition = buildCustomWhatsAppCloudDefinition({
      templateName: 'corpo_valor_fixo',
      components: [body],
    })
    expect(fixedDefinition.variables).toEqual([])
    expect(fixedDefinition.payload.builder.components[0].parameters[0]).toMatchObject({
      key: 'body_description',
      parameterName: 'body_description',
      fixedValue: 'Descrição fixa da campanha',
      contentMode: 'fixed',
    })

    setCloudParameterValueMode(parameter, 'dynamic')
    expect(body.parameters).toHaveLength(1)
    expect(parameter.fixedValue).toBe('')
    expect(parameter.example).toBe('Descrição fixa da campanha')
    expect(buildCustomWhatsAppCloudDefinition({
      templateName: 'corpo_valor_dinamico',
      components: [body],
    }).variables).toEqual(['body_description'])
  })

  it('preserva corpos legados com vários parâmetros ao usar o editor amigável', () => {
    const body = createCloudComponent({
      type: 'body',
      text: 'Olá, {{nome}}. Seu pedido {{pedido}} está pronto.',
      parameters: [
        { type: 'text', key: 'nome', parameterName: 'nome', label: 'Nome' },
        { type: 'text', key: 'pedido', parameterName: 'pedido', label: 'Pedido' },
      ],
    })
    const original = structuredClone(body)

    expect(cloudBodyHasAdvancedParameters(body)).toBe(true)
    expect(setCloudBodyContentMode(body, 'fixed')).toEqual(original)
    expect(setCloudBodyContentMode(body, 'dynamic')).toEqual(original)
    expect(renameCloudBodyVariable(body, 'outro_nome')).toBeNull()
    expect(body).toEqual(original)
  })

  it('configura botão URL com sufixo posicional {{1}} sem expor JSON', () => {
    const button = createCloudComponent({
      type: 'button',
      subType: 'url',
      index: '0',
      text: 'Abrir convite',
      url: 'https://notify.example/invite/',
    })

    setCloudButtonUrlMode(button, 'dynamic')
    updateCloudButtonBaseUrl(button, 'https://notify.example/invite/')

    expect(cloudButtonUrlMode(button)).toBe('dynamic')
    expect(cloudButtonBaseUrl(button)).toBe('https://notify.example/invite/')
    expect(button.url).toBe('https://notify.example/invite/{{1}}')
    expect(cloudButtonSuffixParameter(button)).toMatchObject({
      key: 'invite_slug',
      parameterName: '',
      label: 'Identificador do convite',
      example: 'grupo-alpha',
    })
    expect(previewCloudButtonUrl(button)).toBe('https://notify.example/invite/grupo-alpha')
    expect(validateCustomWhatsAppCloudTemplate({ templateName: 'botao_dinamico', components: [button] })).toBeNull()

    const definition = buildCustomWhatsAppCloudDefinition({
      templateName: 'botao_dinamico',
      components: [button],
    })
    expect(definition.payload.builder.components[0]).toMatchObject({
      type: 'button',
      url: 'https://notify.example/invite/{{1}}',
      parameters: [{ key: 'invite_slug', parameterName: undefined }],
    })
    expect(buildCustomWhatsAppCloudPreviewPayload({
      templateName: 'botao_dinamico',
      components: [button],
    }).template.components[0]).toEqual({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: 'grupo-alpha' }],
    })

    const dynamicWithoutParameter = createCloudComponent({
      type: 'button', subType: 'url', index: '0', text: 'Abrir',
      url: 'https://notify.example/invite/{{1}}', parameters: [],
    })
    const fixedWithParameter = createCloudComponent({
      type: 'button', subType: 'url', index: '0', text: 'Abrir',
      url: 'https://notify.example/invite/',
      parameters: [{ type: 'text', key: 'invite_slug', label: 'Convite', example: 'alpha' }],
    })
    expect(validateCustomWhatsAppCloudTemplate({ templateName: 'invalido', components: [dynamicWithoutParameter] }))
      .toContain('exige exatamente um sufixo {{1}}')
    expect(validateCustomWhatsAppCloudTemplate({ templateName: 'invalido', components: [fixedWithParameter] }))
      .toContain('exige exatamente um sufixo {{1}}')
  })

  it('mantém {{1}} no botão ao alternar o identificador entre salvo e por disparo', () => {
    const button = createCloudComponent({
      type: 'button',
      subType: 'url',
      index: '0',
      text: 'Ver convite',
      url: 'https://notify.example/invite/',
    })
    setCloudButtonUrlMode(button, 'dynamic')
    const suffix = cloudButtonSuffixParameter(button)

    setCloudParameterValueMode(suffix, 'fixed', 'grupo-alpha')
    updateCloudParameterValue(suffix, 'grupo-fixo')
    expect(button.url).toBe('https://notify.example/invite/{{1}}')
    expect(previewCloudButtonUrl(button)).toBe('https://notify.example/invite/grupo-fixo')
    expect(buildCustomWhatsAppCloudDefinition({
      templateName: 'link_valor_fixo',
      components: [button],
    }).payload.builder.components[0]).toMatchObject({
      url: 'https://notify.example/invite/{{1}}',
      parameters: [{ key: 'invite_slug', fixedValue: 'grupo-fixo', contentMode: 'fixed' }],
    })

    setCloudParameterValueMode(suffix, 'dynamic')
    expect(button.url).toBe('https://notify.example/invite/{{1}}')
    expect(suffix.fixedValue).toBe('')
    expect(suffix.example).toBe('grupo-fixo')
    expect(buildCustomWhatsAppCloudDefinition({
      templateName: 'link_valor_dinamico',
      components: [button],
    }).payload.builder.components[0].parameters[0]).toMatchObject({
      key: 'invite_slug',
      fixedValue: undefined,
      contentMode: 'dynamic',
    })
  })

  it('reconcilia contratos antigos de botão para nunca enviar sufixo em URL fixa', () => {
    const missingPlaceholder = createCloudComponent({
      type: 'button', subType: 'url', index: '0', text: 'Convite',
      url: 'https://notify.example/invite/',
      parameters: [{ type: 'text', key: 'invite_slug', label: 'Convite', example: 'alpha' }],
    })
    reconcileCloudButtonUrlParameter(missingPlaceholder)
    expect(missingPlaceholder.url).toBe('https://notify.example/invite/{{1}}')
    expect(missingPlaceholder.parameters).toHaveLength(1)

    const missingParameter = createCloudComponent({
      type: 'button', subType: 'url', index: '0', text: 'Convite',
      url: 'https://notify.example/invite/{{1}}',
      parameters: [],
    })
    reconcileCloudButtonUrlParameter(missingParameter)
    expect(missingParameter.parameters).toEqual([
      expect.objectContaining({ key: 'invite_slug', contentMode: 'dynamic' }),
    ])
    expect(validateCustomWhatsAppCloudTemplate({
      templateName: 'contrato_corrigido',
      components: [missingParameter],
    })).toBeNull()

    expect(validateCustomWhatsAppCloudTemplate({
      templateName: 'sem_link',
      components: [createCloudComponent({ type: 'body', text: 'Somente descrição fixa.' })],
    })).toBeNull()
  })

  it('preserva o delimitador da URL ao alternar entre link fixo e sufixo dinâmico', () => {
    const button = createCloudComponent({
      type: 'button',
      subType: 'url',
      index: '0',
      text: 'Abrir convite',
      url: 'https://notify.example/invite/',
    })

    setCloudButtonUrlMode(button, 'dynamic')
    expect(button.url).toBe('https://notify.example/invite/{{1}}')
    setCloudButtonUrlMode(button, 'fixed')
    expect(button.url).toBe('https://notify.example/invite/')
    setCloudButtonUrlMode(button, 'dynamic')
    expect(button.url).toBe('https://notify.example/invite/{{1}}')
  })

  it('reabre corpo nomeado e botão dinâmico sem alterar a estrutura salva', () => {
    const stored = {
      externalTemplateName: 'campanha_dinamica',
      payload: {
        builder: {
          components: [
            {
              type: 'body',
              text: '{{body_description}}',
              parameters: [{
                type: 'text',
                key: 'body_description',
                parameterName: 'body_description',
                label: 'Descrição',
                example: 'Exemplo',
              }],
            },
            {
              type: 'button',
              subType: 'url',
              index: '0',
              text: 'Abrir',
              url: 'https://notify.example/invite/{{1}}',
              parameters: [{ type: 'text', key: 'invite_slug', label: 'Convite', example: 'alpha' }],
            },
          ],
        },
      },
    }

    const restored = standardMarketingComponentsFromTemplate(stored)
    const definition = buildCustomWhatsAppCloudDefinition({
      templateName: stored.externalTemplateName,
      components: restored,
    })
    expect(definition.payload.builder.components.map((component) => ({
      type: component.type,
      text: component.text,
      url: component.url,
      parameters: component.parameters.map((parameter) => ({
        key: parameter.key,
        parameterName: parameter.parameterName,
        example: parameter.example,
      })),
    }))).toEqual([
      {
        type: 'body',
        text: '{{body_description}}',
        url: undefined,
        parameters: [{ key: 'body_description', parameterName: 'body_description', example: 'Exemplo' }],
      },
      {
        type: 'button',
        text: 'Abrir',
        url: 'https://notify.example/invite/{{1}}',
        parameters: [{ key: 'invite_slug', parameterName: undefined, example: 'alpha' }],
      },
    ])
  })

  it('reabre um template mínimo sem inventar corpo, mídia, rodapé ou botão', () => {
    expect(standardMarketingComponentsFromTemplate({
      externalTemplateName: 'modelo_minimo_teste',
      body: 'modelo_minimo_teste',
      payload: { builder: { components: [] } },
    })).toEqual([])
  })

  it('bloqueia destinos do próprio WhatsApp e aceita páginas HTTPS externas', () => {
    expect(isForbiddenWhatsAppButtonUrl('https://wa.me/5561999999999')).toBe(true)
    expect(isForbiddenWhatsAppButtonUrl('https://api.whatsapp.com/send?phone=5561999999999')).toBe(true)
    expect(isForbiddenWhatsAppButtonUrl('whatsapp://send?text=oi')).toBe(true)
    expect(isForbiddenWhatsAppButtonUrl('https://notify-flow.example/convite')).toBe(false)
    expect(isValidHttpsTemplateUrl('https://notify-flow.example/convite')).toBe(true)
    expect(isValidHttpsTemplateUrl('http://notify-flow.example/convite')).toBe(false)
  })

  it('espelha a formatação básica aprovada no preview do WhatsApp sem aceitar HTML', () => {
    expect(renderWhatsAppPreviewMarkup('*Grupo Alpha*\n_Convite_ ~antigo~'))
      .toBe('<strong>Grupo Alpha</strong><br><em>Convite</em> <s>antigo</s>')
    expect(renderWhatsAppPreviewMarkup('<img src=x onerror=alert(1)>'))
      .toContain('&lt;img src=x onerror=alert(1)&gt;')
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
    expect(source).toContain(':model-value="cloudMediaDisplayValue(cloudStandardMedia)"')
    expect(source).toContain('@update:model-value="onCloudMediaValueChange"')
    expect(source).toContain('v-model="cloudStandardBody.text"')
    expect(source).toContain('v-model="cloudStandardFooter.text"')
    expect(source).toContain('v-model.trim="cloudStandardButton.url"')
    expect(source).toContain("{ label: 'Variável nomeada', value: 'dynamic', icon: 'data_object' }")
    expect(source).toContain('label="Variável interna e nome na Meta"')
    expect(source).toContain("{ label: 'Sufixo dinâmico', value: 'dynamic', icon: 'route' }")
    expect(source).toContain('label="Variável interna do sufixo"')
    expect(source).toContain('cloudButtonBaseUrl(cloudStandardButton)')
    expect(source).not.toContain('Nenhum JSON precisa ser editado.')
    expect(source).toContain('aria-label="Clonar template"')
    expect(source).toContain('Clonar como um novo template editável')
    expect(source).toContain("form.cloudPreset = 'custom'")
    expect(source).toContain('copiedMetaTemplateName(')
    expect(source).toContain('position: sticky;')
    expect(source.indexOf("{ label: 'Sempre esta mídia', value: 'fixed', icon: 'lock' }"))
      .toBeLessThan(source.indexOf("{ label: 'Em cada disparo', value: 'dynamic', icon: 'sync_alt' }"))
    expect(source).toContain('Quando a descrição será definida?')
    expect(source).toContain('Quando o destino será definido?')
    expect(source.match(/\{ label: 'Sempre este valor', value: 'fixed', icon: 'lock' \}/g)).toHaveLength(2)
    expect(source.match(/\{ label: 'Definir em cada disparo', value: 'dynamic', icon: 'sync_alt' \}/g)).toHaveLength(2)
    expect(source).toContain('@update:model-value="onCloudBodyValueChange"')
    expect(source).toContain('@update:model-value="onCloudButtonValueChange"')
    expect(source).not.toContain('Apenas o título e o nome oficial são obrigatórios no Notify Flow.')
    expect(source).not.toContain('A Meta controla o layout final. A descrição interna não faz parte da mensagem')
    expect(source).toContain('Adicionar ${option.label}')
    expect(source).toContain("removeCloudStandardComponent('header')")
    expect(source).toContain("removeCloudStandardComponent('body')")
    expect(source).toContain("removeCloudStandardComponent('footer')")
    expect(source).toContain("removeCloudStandardComponent('button')")
    expect(source).toContain('label="Nome no Notify App *"')
    expect(source).toContain('label="Nome exato aprovado na Meta *"')
    expect(source).not.toContain('label="Idioma aprovado *"')
    expect(source).not.toContain('label="Tipo da mídia *"')
    expect(source).not.toContain('label="Corpo fixo *"')
    expect(source).not.toContain('label="Texto do botão *"')
    expect(source).not.toContain('label="Link HTTPS do botão *"')
    expect(source).not.toContain('`${cloudMediaExampleLabel(cloudStandardMedia.type)} *`')
    expect(source).not.toContain('label="Variável interna *"')
  })
})
