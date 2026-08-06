<script>
export const WHATSAPP_CLOUD_PRESETS = Object.freeze([
  Object.freeze({
    value: 'order_confirmation',
    label: 'Confirmação de pedido',
    description: 'Confirmação oficial com nome do cliente, número e data do pedido.',
    templateName: 'jaspers_market_order_confirmation_v1',
    languageCode: 'en_US',
    preview: 'Pedido {{orderNumber}} de {{customerName}} confirmado em {{orderDate}}.',
    parameters: Object.freeze([
      Object.freeze({ key: 'customerName', label: 'Nome do cliente', example: 'John Doe', position: 1 }),
      Object.freeze({ key: 'orderNumber', label: 'Número do pedido', example: '123456', position: 2 }),
      Object.freeze({ key: 'orderDate', label: 'Data do pedido', example: 'Jul 20, 2026', position: 3 }),
    ]),
  }),
  Object.freeze({
    value: 'plain_text',
    label: 'Texto sem formatação',
    description: 'Mensagem oficial de texto simples, sem campos variáveis.',
    templateName: 'jaspers_market_plain_text_v1',
    languageCode: 'en_US',
    preview: 'Mensagem de texto simples aprovada pela Meta.',
    parameters: Object.freeze([]),
  }),
  Object.freeze({
    value: 'hello_world',
    label: 'Olá mundo',
    description: 'Modelo hello_world disponibilizado pela Meta para o primeiro teste.',
    templateName: 'hello_world',
    languageCode: 'en_US',
    preview: 'Hello World',
    parameters: Object.freeze([]),
  }),
])

export const CUSTOM_WHATSAPP_CLOUD_TEMPLATE = Object.freeze({
  value: 'custom',
  label: 'Marketing / padrão',
  description: 'Perfil simplificado para templates de marketing já aprovados na Meta.',
  templateName: '',
  languageCode: 'pt_BR',
  preview: 'Configure a mídia, o texto e o botão exatamente como foram aprovados na Meta.',
  parameters: Object.freeze([]),
})

export const STANDARD_MARKETING_DEFAULTS = Object.freeze({
  body: 'Você foi convidado para acompanhar nossas novidades. Toque no botão abaixo para saber mais.',
  footer: 'Enviado pelo Notify Flow',
  buttonText: 'Saiba mais',
  buttonUrl: 'https://seudominio.com/',
})

export const SYSTEM_WHATSAPP_TEMPLATE_NAMES = Object.freeze([
  'jaspers_market_plain_text_v1',
  'jaspers_market_order_confirmation_v1',
  '3p_direct_integration_test_template',
])

export const META_TEST_NUMBER_TEMPLATE_NAMES = Object.freeze([
  'jaspers_market_plain_text_v1',
  'jaspers_market_order_confirmation_v1',
])

export function isSystemTemplateRecord(template = {}) {
  if (template.systemManaged === true || template.deletable === false) return true
  return normalizedTemplateChannel(template.channel || template.type) === 'whatsapp_cloud'
    && SYSTEM_WHATSAPP_TEMPLATE_NAMES.includes(String(template.externalTemplateName || '').trim())
}

export function templateCopyName(value = '', usedNames = []) {
  const base = String(value || 'Template').trim() || 'Template'
  const used = new Set((usedNames || []).map((name) => String(name || '').trim().toLocaleLowerCase('pt-BR')))
  const firstCopy = `${base} (cópia)`
  if (!used.has(firstCopy.toLocaleLowerCase('pt-BR'))) return firstCopy
  let suffix = 2
  while (used.has(`${base} (cópia ${suffix})`.toLocaleLowerCase('pt-BR'))) suffix += 1
  return `${base} (cópia ${suffix})`
}

export function cloneCloudComponentsForDraft(components = []) {
  return (components || []).map((component) => createCloudComponent({
    ...component,
    id: undefined,
    parameters: (component.parameters || []).map((parameter) => ({
      ...parameter,
      id: undefined,
      uploadFile: null,
      uploading: false,
    })),
  }))
}

export function templateFormatLabel(template = {}) {
  const externalName = String(template.externalTemplateName || '').trim()
  if (externalName === '3p_direct_integration_test_template') return 'OFICIAL META PROD NUMBER'
  if (META_TEST_NUMBER_TEMPLATE_NAMES.includes(externalName)) return 'OFICIAL META TEST NUMBER'
  return (template.templateType || template.format || 'text') === 'approved_template'
    ? 'OFICIAL META'
    : String(template.templateType || template.format || 'text').toUpperCase()
}

function normalizedTemplateChannel(value = '') {
  const key = String(value).toLowerCase().replaceAll('-', '_')
  if (['whatsappcloud', 'meta', 'whatsapp_official'].includes(key)) return 'whatsapp_cloud'
  return key
}

export const META_COMPONENT_OPTIONS = Object.freeze([
  Object.freeze({ label: 'Cabeçalho', value: 'header' }),
  Object.freeze({ label: 'Corpo', value: 'body' }),
  Object.freeze({ label: 'Rodapé', value: 'footer' }),
  Object.freeze({ label: 'Botão', value: 'button' }),
])

export const META_PARAMETER_OPTIONS = Object.freeze([
  Object.freeze({ label: 'Texto', value: 'text' }),
  Object.freeze({ label: 'Moeda', value: 'currency' }),
  Object.freeze({ label: 'Data e hora', value: 'date_time' }),
  Object.freeze({ label: 'Imagem (URL)', value: 'image' }),
  Object.freeze({ label: 'Documento (URL)', value: 'document' }),
  Object.freeze({ label: 'Vídeo (URL)', value: 'video' }),
  Object.freeze({ label: 'Payload do botão', value: 'payload' }),
  Object.freeze({ label: 'Código do cupom', value: 'coupon_code' }),
])

export const META_MEDIA_PARAMETER_TYPES = Object.freeze(['image', 'video', 'document'])
export const META_LANGUAGE_OPTIONS = Object.freeze([
  Object.freeze({ label: 'Português (Brasil) — pt_BR', value: 'pt_BR' }),
  Object.freeze({ label: 'Inglês (Estados Unidos) — en_US', value: 'en_US' }),
])

export const META_PARAMETER_DEFAULTS = Object.freeze({
  text: Object.freeze({ key: 'texto', label: 'Texto' }),
  currency: Object.freeze({ key: 'valor_moeda', label: 'Valor monetário' }),
  date_time: Object.freeze({ key: 'data_hora', label: 'Data e hora' }),
  image: Object.freeze({ key: 'imagem_cabecalho', label: 'Link da imagem' }),
  video: Object.freeze({ key: 'video_cabecalho', label: 'Link do vídeo' }),
  document: Object.freeze({ key: 'arquivo_cabecalho', label: 'Link do arquivo' }),
  payload: Object.freeze({ key: 'resposta_botao', label: 'Resposta do botão' }),
  coupon_code: Object.freeze({ key: 'codigo_cupom', label: 'Código do cupom' }),
})

export function isCloudMediaParameter(type) {
  return META_MEDIA_PARAMETER_TYPES.includes(String(type || ''))
}

export function cloudParameterDefault(type = 'text') {
  return META_PARAMETER_DEFAULTS[type] || META_PARAMETER_DEFAULTS.text
}

export function cloudMediaExampleLabel(type) {
  if (type === 'image') return 'Link da imagem'
  if (type === 'video') return 'Link do vídeo'
  if (type === 'document') return 'Link do arquivo'
  return 'Valor de exemplo'
}

export function cloudMediaAccept(type) {
  if (type === 'image') return 'image/jpeg,image/png'
  if (type === 'video') return 'video/mp4,video/3gpp'
  if (type === 'document') return '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,application/pdf,text/plain'
  return undefined
}

export function cloudMediaMaxBytes(type) {
  if (type === 'image') return 5 * 1024 * 1024
  if (type === 'video') return 16 * 1024 * 1024
  if (type === 'document') return 100 * 1024 * 1024
  return 0
}

export function cloudMediaLimitLabel(type) {
  const bytes = cloudMediaMaxBytes(type)
  return bytes ? `${Math.round(bytes / 1024 / 1024)} MB` : ''
}

let cloudBuilderSequence = 0

function nextCloudBuilderId(prefix) {
  cloudBuilderSequence += 1
  return `${prefix}-${Date.now()}-${cloudBuilderSequence}`
}

export function normalizeCloudVariableKey(value, fallback = 'campo') {
  let normalized = String(value || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
  if (normalized && !/^[a-zA-Z]/.test(normalized)) normalized = `campo_${normalized}`
  return normalized || fallback
}

export function createCloudParameter(overrides = {}) {
  const defaults = cloudParameterDefault(overrides.type || 'text')
  return {
    id: overrides.id || nextCloudBuilderId('parameter'),
    type: overrides.type || 'text',
    key: overrides.key || defaults.key,
    parameterName: overrides.parameterName || overrides.parameter_name || '',
    label: overrides.label || defaults.label,
    fixedValue: overrides.fixedValue || overrides.fixed_value || '',
    example: overrides.example || '',
    contentMode: overrides.contentMode || overrides.deliveryMode
      || (overrides.fixedValue || overrides.fixed_value ? 'fixed' : 'dynamic'),
    currencyCode: overrides.currencyCode || 'BRL',
    filename: overrides.filename || '',
    mediaSource: overrides.mediaSource || overrides.media_source || (overrides.mediaAssetId || overrides.assetId ? 'upload' : 'url'),
    mediaAssetId: overrides.mediaAssetId || overrides.assetId || overrides.media_id || '',
    mimeType: overrides.mimeType || overrides.mime_type || '',
    mediaType: overrides.mediaType || overrides.media_type || '',
    uploadedFilename: overrides.uploadedFilename || overrides.uploaded_filename || '',
    uploadFile: null,
    uploading: false,
  }
}

export function createCloudComponent(overrides = {}) {
  return {
    id: overrides.id || nextCloudBuilderId('component'),
    type: overrides.type || 'body',
    subType: overrides.subType || 'url',
    index: String(overrides.index ?? 0),
    text: String(overrides.text || ''),
    url: String(overrides.url || ''),
    parameters: (overrides.parameters || []).map((parameter) => createCloudParameter(parameter)),
  }
}

export function createStandardMarketingComponents(overrides = {}) {
  const media = overrides.media || {}
  const valueOrDefault = (value, fallback) => value === undefined || value === null ? fallback : String(value)
  return [
    createCloudComponent({
      type: 'header',
      parameters: [createCloudParameter({
        type: media.type || 'image',
        key: media.key || 'midia_cabecalho',
        label: media.label || 'Mídia do cabeçalho',
        fixedValue: media.fixedValue || '',
        example: media.example || '',
        mediaSource: media.mediaSource || 'url',
        mediaAssetId: media.mediaAssetId || '',
        mimeType: media.mimeType || '',
        mediaType: media.mediaType || media.type || 'image',
        uploadedFilename: media.uploadedFilename || '',
        filename: media.filename || '',
      })],
    }),
    createCloudComponent({ type: 'body', text: valueOrDefault(overrides.body, STANDARD_MARKETING_DEFAULTS.body) }),
    createCloudComponent({ type: 'footer', text: valueOrDefault(overrides.footer, STANDARD_MARKETING_DEFAULTS.footer) }),
    createCloudComponent({
      type: 'button',
      subType: 'url',
      index: '0',
      text: valueOrDefault(overrides.buttonText, STANDARD_MARKETING_DEFAULTS.buttonText),
      url: valueOrDefault(overrides.buttonUrl, STANDARD_MARKETING_DEFAULTS.buttonUrl),
    }),
  ]
}

export const OPTIONAL_STANDARD_COMPONENTS = Object.freeze([
  Object.freeze({ type: 'header', label: 'Cabeçalho / mídia', icon: 'perm_media' }),
  Object.freeze({ type: 'body', label: 'Corpo', icon: 'subject' }),
  Object.freeze({ type: 'footer', label: 'Rodapé', icon: 'short_text' }),
  Object.freeze({ type: 'button', label: 'Botão de link', icon: 'ads_click' }),
])

export function createOptionalStandardComponent(type) {
  if (type === 'header') {
    return createCloudComponent({
      type: 'header',
      parameters: [createCloudParameter({
        type: 'image',
        key: 'midia_cabecalho',
        label: 'Mídia do cabeçalho',
        mediaType: 'image',
        contentMode: 'fixed',
      })],
    })
  }
  if (type === 'button') return createCloudComponent({ type: 'button', subType: 'url', index: '0' })
  return createCloudComponent({ type })
}

const CLOUD_BODY_VARIABLE_DEFAULTS = Object.freeze({
  key: 'body_description',
  label: 'Descrição da mensagem',
  example: 'Confira os detalhes desta notificação.',
})

const CLOUD_BUTTON_SUFFIX_DEFAULTS = Object.freeze({
  key: 'invite_slug',
  label: 'Identificador do convite',
  example: 'grupo-alpha',
})

function namedCloudVariableKey(value, fallback) {
  return normalizeCloudVariableKey(value, fallback).toLowerCase()
}

function escapedCloudPlaceholderName(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function cloudPlaceholderPattern(value = '') {
  return new RegExp(`{{\\s*${escapedCloudPlaceholderName(value)}\\s*}}`, 'g')
}

function replaceCloudPlaceholder(text, previousNames, nextName) {
  let output = String(text || '')
  let replaced = false
  for (const name of [...new Set(previousNames.filter(Boolean))]) {
    const pattern = cloudPlaceholderPattern(name)
    if (!pattern.test(output)) continue
    pattern.lastIndex = 0
    output = output.replace(pattern, `{{${nextName}}}`)
    replaced = true
  }
  if (replaced) return output
  return [output.trim(), `{{${nextName}}}`].filter(Boolean).join('\n')
}

export function cloudBodyVariableParameter(component = {}) {
  return (component.parameters || []).find((parameter) => parameter.type === 'text') || null
}

export function cloudBodyContentMode(component = {}) {
  return cloudBodyVariableParameter(component) ? 'dynamic' : 'fixed'
}

export function cloudBodyHasAdvancedParameters(component = {}) {
  return (component.parameters || []).length > 1
}

export function setCloudBodyContentMode(component, mode) {
  if (!component) return component
  if (cloudBodyHasAdvancedParameters(component)) return component
  if (mode !== 'dynamic') {
    const parameter = cloudBodyVariableParameter(component)
    if (parameter) {
      const tokens = [parameter.parameterName, parameter.key].filter(Boolean)
      for (const token of tokens) component.text = String(component.text || '').replace(cloudPlaceholderPattern(token), '')
      component.text = String(component.text || '').trim()
    }
    component.parameters = []
    return component
  }

  const existing = cloudBodyVariableParameter(component)
  const key = namedCloudVariableKey(existing?.parameterName || existing?.key, CLOUD_BODY_VARIABLE_DEFAULTS.key)
  const parameter = existing || createCloudParameter({
    type: 'text',
    ...CLOUD_BODY_VARIABLE_DEFAULTS,
  })
  const previousNames = [parameter.parameterName, parameter.key]
  parameter.type = 'text'
  parameter.key = key
  parameter.parameterName = key
  parameter.label = parameter.label || CLOUD_BODY_VARIABLE_DEFAULTS.label
  parameter.example = parameter.example || CLOUD_BODY_VARIABLE_DEFAULTS.example
  parameter.fixedValue = ''
  component.parameters = [parameter]
  component.text = replaceCloudPlaceholder(component.text, previousNames, key)
  return component
}

export function renameCloudBodyVariable(component, value) {
  if (cloudBodyHasAdvancedParameters(component)) return null
  const parameter = cloudBodyVariableParameter(component)
  if (!parameter) return null
  const previousNames = [parameter.parameterName, parameter.key]
  const key = namedCloudVariableKey(value, CLOUD_BODY_VARIABLE_DEFAULTS.key)
  parameter.key = key
  parameter.parameterName = key
  component.text = replaceCloudPlaceholder(component.text, previousNames, key)
  return parameter
}

export function cloudButtonSuffixParameter(component = {}) {
  return (component.parameters || []).find((parameter) => parameter.type === 'text') || null
}

export function cloudButtonUrlMode(component = {}) {
  return cloudButtonSuffixParameter(component) ? 'dynamic' : 'fixed'
}

export function cloudButtonBaseUrl(component = {}) {
  return String(component.url || '').replace(/\{\{1\}\}\s*$/, '')
}

export function updateCloudButtonBaseUrl(component, value) {
  if (!component) return component
  const base = String(value || '').replace(/\{\{1\}\}\s*$/, '')
  component.url = base ? `${base}{{1}}` : ''
  return component
}

export function reconcileCloudButtonUrlParameter(component) {
  if (!component || component.type !== 'button' || component.subType !== 'url') return component
  const hasSuffix = String(component.url || '').includes('{{1}}')
  const parameter = cloudButtonSuffixParameter(component)
  if (parameter && !hasSuffix && String(component.url || '').trim()) {
    updateCloudButtonBaseUrl(component, component.url)
  } else if (!parameter && hasSuffix) {
    component.parameters = [createCloudParameter({
      type: 'text',
      ...CLOUD_BUTTON_SUFFIX_DEFAULTS,
      contentMode: 'dynamic',
    })]
  }
  return component
}

export function setCloudButtonUrlMode(component, mode) {
  if (!component) return component
  if (mode !== 'dynamic') {
    component.parameters = []
    component.url = cloudButtonBaseUrl(component)
    return component
  }

  const existing = cloudButtonSuffixParameter(component)
  const parameter = existing || createCloudParameter({
    type: 'text',
    ...CLOUD_BUTTON_SUFFIX_DEFAULTS,
  })
  parameter.type = 'text'
  parameter.key = normalizeCloudVariableKey(parameter.key, CLOUD_BUTTON_SUFFIX_DEFAULTS.key)
  parameter.parameterName = ''
  parameter.label = parameter.label || CLOUD_BUTTON_SUFFIX_DEFAULTS.label
  parameter.example = parameter.example || CLOUD_BUTTON_SUFFIX_DEFAULTS.example
  parameter.fixedValue = ''
  component.parameters = [parameter]
  updateCloudButtonBaseUrl(component, cloudButtonBaseUrl(component))
  return component
}

export function previewCloudComponentText(component = {}) {
  let output = String(component.text || '')
  ;(component.parameters || []).forEach((parameter, index) => {
    const value = String(parameter.fixedValue || parameter.example || `{{${parameter.key}}}`)
    const tokens = [String(index + 1), parameter.key, parameter.parameterName].filter(Boolean)
    for (const token of [...new Set(tokens)]) output = output.replace(cloudPlaceholderPattern(token), value)
  })
  return output
}

export function cloudMediaContentMode(parameter = {}) {
  return cloudParameterValueMode(parameter)
}

export function setCloudMediaContentMode(parameter, mode) {
  return setCloudParameterValueMode(parameter, mode)
}

export function updateCloudMediaValue(parameter, value) {
  if (!parameter) return parameter
  if (cloudMediaContentMode(parameter) === 'fixed') parameter.fixedValue = value
  else parameter.example = value
  return parameter
}

export function cloudMediaDisplayValue(parameter = {}) {
  return cloudParameterDisplayValue(parameter)
}

export function cloudParameterValueMode(parameter = {}) {
  if (['fixed', 'dynamic'].includes(parameter.contentMode)) return parameter.contentMode
  return String(parameter.fixedValue || '').trim() ? 'fixed' : 'dynamic'
}

export function setCloudParameterValueMode(parameter, mode, defaultFixedValue = '') {
  if (!parameter) return parameter
  parameter.contentMode = mode === 'fixed' ? 'fixed' : 'dynamic'
  if (parameter.contentMode === 'dynamic') {
    if (String(parameter.fixedValue || '').trim()) parameter.example = parameter.fixedValue
    parameter.fixedValue = ''
    return parameter
  }
  if (!String(parameter.fixedValue || '').trim()) {
    parameter.fixedValue = String(parameter.example || defaultFixedValue || '')
  }
  return parameter
}

export function updateCloudParameterValue(parameter, value) {
  if (!parameter) return parameter
  if (cloudParameterValueMode(parameter) === 'fixed') parameter.fixedValue = value
  else parameter.example = value
  return parameter
}

export function cloudParameterDisplayValue(parameter = {}) {
  return cloudParameterValueMode(parameter) === 'fixed'
    ? String(parameter.fixedValue || '')
    : String(parameter.example || '')
}

export function previewCloudButtonUrl(component = {}) {
  const parameter = cloudButtonSuffixParameter(component)
  const suffix = String(parameter?.fixedValue || parameter?.example || `{{${parameter?.key || CLOUD_BUTTON_SUFFIX_DEFAULTS.key}}}`)
  return String(component.url || '').replaceAll('{{1}}', suffix)
}

function cloudParameterHasContent(parameter = {}) {
  if (isCloudMediaParameter(parameter.type)) {
    return Boolean(String(parameter.fixedValue || parameter.example || parameter.mediaAssetId || '').trim())
  }
  return Boolean(
    String(parameter.key || parameter.parameterName || parameter.example || parameter.fixedValue || '').trim(),
  )
}

export function meaningfulCloudComponents(components = []) {
  return (components || []).filter((component) => {
    const hasParameters = (component.parameters || []).some(cloudParameterHasContent)
    if (component.type === 'header') return hasParameters || Boolean(String(component.text || '').trim())
    if (component.type === 'body' || component.type === 'footer') {
      return Boolean(String(component.text || '').trim()) || hasParameters
    }
    if (component.type === 'button') {
      return Boolean(String(component.text || component.url || '').trim()) || hasParameters
    }
    return hasParameters || Boolean(String(component.text || component.url || '').trim())
  })
}

export function isForbiddenWhatsAppButtonUrl(value) {
  const raw = String(value || '').trim()
  if (/^whatsapp:/i.test(raw)) return true
  try {
    const hostname = new URL(raw).hostname.toLowerCase().replace(/^www\./, '')
    return hostname === 'wa.me'
      || hostname.endsWith('.wa.me')
      || hostname === 'whatsapp.com'
      || hostname.endsWith('.whatsapp.com')
  } catch {
    return false
  }
}

export function isValidHttpsTemplateUrl(value) {
  try {
    const url = new URL(String(value || '').trim())
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
  } catch {
    return false
  }
}

export function renderWhatsAppPreviewMarkup(value = '') {
  const escaped = String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')

  return escaped
    .replace(/```([\s\S]+?)```/g, '<code>$1</code>')
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>')
    .replace(/\n/g, '<br>')
}

export function buildCustomWhatsAppCloudDefinition(input) {
  const builderComponents = meaningfulCloudComponents(input.components).map((component, componentIndex) => ({
    id: component.id,
    type: component.type,
    ...(component.type === 'button' ? {
      subType: component.subType,
      index: String(component.index ?? 0),
    } : {}),
    ...(String(component.text || '').trim() ? { text: String(component.text).trim() } : {}),
    ...(String(component.url || '').trim() ? { url: String(component.url).trim() } : {}),
    parameters: (component.parameters || []).filter(cloudParameterHasContent).map((parameter, parameterIndex) => ({
      id: parameter.id,
      type: parameter.type,
      key: normalizeCloudVariableKey(parameter.key || parameter.label, `campo_${componentIndex + 1}_${parameterIndex + 1}`),
      parameterName: String(parameter.parameterName || '').trim() || undefined,
      label: String(parameter.label || `Campo ${parameterIndex + 1}`).trim(),
      fixedValue: String(parameter.fixedValue || '').trim() || undefined,
      example: String(parameter.example || '').trim(),
      contentMode: ['fixed', 'dynamic'].includes(parameter.contentMode)
        ? parameter.contentMode
        : (String(parameter.fixedValue || '').trim() ? 'fixed' : 'dynamic'),
      currencyCode: parameter.type === 'currency' ? String(parameter.currencyCode || 'BRL').toUpperCase() : undefined,
      filename: parameter.type === 'document' ? String(parameter.filename || '').trim() || undefined : undefined,
      mediaSource: isCloudMediaParameter(parameter.type) ? String(parameter.mediaSource || 'url') : undefined,
      mediaAssetId: isCloudMediaParameter(parameter.type) ? String(parameter.mediaAssetId || '').trim() || undefined : undefined,
      mimeType: isCloudMediaParameter(parameter.type) ? String(parameter.mimeType || '').trim() || undefined : undefined,
      mediaType: isCloudMediaParameter(parameter.type) ? String(parameter.mediaType || parameter.type).trim() || undefined : undefined,
      uploadedFilename: isCloudMediaParameter(parameter.type) ? String(parameter.uploadedFilename || '').trim() || undefined : undefined,
    })),
  }))
  const variables = [...new Set(builderComponents.flatMap((component) => component.parameters
    .filter((parameter) => !parameter.fixedValue && !isCloudMediaParameter(parameter.type))
    .map((parameter) => parameter.key)))]
  const body = builderComponents.find((component) => component.type === 'body')?.text || ''

  return {
    whatsappCloudPreset: 'custom',
    templateType: 'approved_template',
    externalTemplateName: String(input.templateName || '').trim(),
    languageCode: String(input.languageCode || 'pt_BR').trim(),
    description: String(input.description || '').trim(),
    body: String(body || '').trim() || null,
    variables,
    payload: {
      builder: { version: 1, category: 'marketing', mode: 'standard', components: builderComponents },
    },
  }
}

function customPreviewParameter(parameter = {}) {
  const fallback = String(parameter.fixedValue || parameter.example || `{{${normalizeCloudVariableKey(parameter.key)}}}`).trim()
  const parameterName = String(parameter.parameterName || '').trim()
  const named = parameterName ? { parameter_name: parameterName } : {}
  if (parameter.type === 'image') return { type: 'image', image: { link: fallback }, ...named }
  if (parameter.type === 'video') return { type: 'video', video: { link: fallback }, ...named }
  if (parameter.type === 'document') {
    return {
      type: 'document',
      document: {
        link: fallback,
        ...(String(parameter.filename || parameter.uploadedFilename || '').trim()
          ? { filename: String(parameter.filename || parameter.uploadedFilename).trim() }
          : {}),
      },
      ...named,
    }
  }
  if (parameter.type === 'currency') {
    return {
      type: 'currency',
      currency: {
        fallback_value: fallback,
        code: String(parameter.currencyCode || 'BRL').toUpperCase(),
        amount_1000: 0,
      },
      ...named,
    }
  }
  if (parameter.type === 'date_time') return { type: 'date_time', date_time: { fallback_value: fallback }, ...named }
  if (parameter.type === 'payload') return { type: 'payload', payload: fallback }
  if (parameter.type === 'coupon_code') return { type: 'coupon_code', coupon_code: fallback }
  return { type: 'text', text: fallback, ...named }
}

export function buildCustomWhatsAppCloudPreviewPayload(input = {}) {
  const components = meaningfulCloudComponents(input.components)
    .filter((component) => Array.isArray(component.parameters) && component.parameters.length)
    .map((component) => ({
      type: component.type,
      ...(component.type === 'button' ? {
        sub_type: component.subType === 'otp_copy_code' ? 'url' : component.subType,
        index: String(component.index ?? 0),
      } : {}),
      parameters: component.parameters.map(customPreviewParameter),
    }))

  return {
    messaging_product: 'whatsapp',
    to: '{{telefone_do_contato}}',
    type: 'template',
    template: {
      name: String(input.templateName || 'nome_exato_na_meta').trim(),
      language: { code: String(input.languageCode || 'pt_BR').trim() },
      ...(components.length ? { components } : {}),
    },
  }
}

function placeholderKey(parameter, fallback) {
  const candidate = parameter?.text || parameter?.payload || parameter?.coupon_code || parameter?.currency?.fallback_value || parameter?.date_time?.fallback_value || parameter?.image?.link || parameter?.document?.link || parameter?.video?.link || ''
  return String(candidate).match(/{{\s*([a-zA-Z0-9_]+)\s*}}/)?.[1] || fallback
}

export function cloudBuilderFromTemplate(template = {}) {
  const stored = template.payload?.builder?.components
  if (Array.isArray(stored)) return stored.map((component) => createCloudComponent(component))
  return (template.payload?.components || []).map((component, componentIndex) => createCloudComponent({
    type: component.type,
    subType: component.sub_type,
    index: component.index,
    parameters: (component.parameters || []).map((parameter, parameterIndex) => ({
      type: parameter.type === 'payload' ? 'payload' : parameter.type,
      key: placeholderKey(parameter, `campo_${componentIndex + 1}_${parameterIndex + 1}`),
      parameterName: parameter.parameter_name || '',
      label: `Campo ${parameterIndex + 1}`,
      fixedValue: '',
      example: '',
      currencyCode: parameter.currency?.code || 'BRL',
      filename: parameter.document?.filename || '',
    })),
  }))
}

export function standardMarketingComponentsFromTemplate(template = {}) {
  const components = cloudBuilderFromTemplate(template)
  const header = components.find((component) => component.type === 'header')
  const legacyMedia = header?.parameters?.find((parameter) => isCloudMediaParameter(parameter.type))
  const body = components.find((component) => component.type === 'body')
  const footer = components.find((component) => component.type === 'footer')
  const button = components.find((component) => component.type === 'button')
  const restored = []
  if (legacyMedia) {
    restored.push(createCloudComponent({
      ...header,
      parameters: [{ ...legacyMedia }],
    }))
  }
  const legacyBody = String(body?.text || template.body || '').trim()
  const officialName = String(template.externalTemplateName || template.metadata?.approvedName || '').trim()
  if (body || (legacyBody && legacyBody !== officialName)) {
    restored.push(createCloudComponent({ ...body, type: 'body', text: legacyBody }))
  }
  if (footer && String(footer.text || '').trim()) restored.push(createCloudComponent(footer))
  if (button && (String(button.text || '').trim() || String(button.url || '').trim() || button.parameters?.length)) {
    restored.push(reconcileCloudButtonUrlParameter(createCloudComponent({
      ...button,
      text: button.text || button.parameters?.[0]?.label || '',
      url: button.url || button.parameters?.[0]?.fixedValue || button.parameters?.[0]?.example || '',
    })))
  }
  return restored
}

export function findWhatsAppCloudPreset(value) {
  if (value === 'custom') return CUSTOM_WHATSAPP_CLOUD_TEMPLATE
  return WHATSAPP_CLOUD_PRESETS.find((preset) => (
    preset.value === value || preset.templateName === value
  )) || WHATSAPP_CLOUD_PRESETS[0]
}

export function buildWhatsAppCloudTemplateDefinition(value) {
  const preset = findWhatsAppCloudPreset(value)
  const components = preset.parameters.length
    ? [{
        type: 'body',
        parameters: preset.parameters.map((parameter) => ({
          type: 'text',
          text: `{{${parameter.key}}}`,
        })),
      }]
    : []

  return {
    whatsappCloudPreset: preset.value,
    templateType: 'approved_template',
    externalTemplateName: preset.templateName,
    languageCode: preset.languageCode,
    body: preset.preview,
    variables: preset.parameters.map((parameter) => parameter.key),
    payload: components.length ? { components } : {},
  }
}

function optionalCloudButtonUrlError(value) {
  if (!String(value || '').trim()) return null
  if (!isValidHttpsTemplateUrl(value)) return 'Use um link HTTPS público, sem usuário ou senha na URL'
  if (isForbiddenWhatsAppButtonUrl(value)) return 'Links para WhatsApp e wa.me não são permitidos neste botão'
  return null
}

export function validateCustomWhatsAppCloudTemplate(input = {}) {
  const templateName = String(input.templateName || '').trim()
  const languageCode = String(input.languageCode || '').trim()
  const components = meaningfulCloudComponents(input.components)
  if (!templateName) return 'Informe o nome exato aprovado na Meta.'
  if (!/^[a-z0-9_]{1,512}$/.test(templateName)) return 'O nome Meta aceita somente letras minúsculas, números e sublinhado.'
  if (languageCode && !META_LANGUAGE_OPTIONS.some((option) => option.value === languageCode)) return 'Escolha pt_BR ou en_US, conforme o idioma aprovado na Meta.'
  const parameters = components.flatMap((component) => component.parameters || []).filter(cloudParameterHasContent)
  const incompleteFixedParameter = parameters.find((parameter) => (
    parameter.contentMode === 'fixed' && !String(parameter.fixedValue || '').trim()
  ))
  if (incompleteFixedParameter) {
    return `Preencha o valor fixo de ${String(incompleteFixedParameter.label || 'este campo').toLowerCase()} ou escolha definir em cada disparo.`
  }
  const bodies = components.filter((component) => component.type === 'body')
  const footers = components.filter((component) => component.type === 'footer')
  const buttons = components.filter((component) => component.type === 'button')
  if (bodies.some((body) => String(body.text || '').length > 1024)) return 'O corpo deve ter no máximo 1.024 caracteres.'
  for (const body of bodies) {
    const bodyText = String(body.text || '')
    for (const [index, parameter] of (body.parameters || []).filter(cloudParameterHasContent).entries()) {
      const placeholder = parameter.parameterName || String(index + 1)
      if (!cloudPlaceholderPattern(placeholder).test(bodyText)) {
        return `Inclua {{${placeholder}}} no texto do corpo, exatamente como no modelo aprovado na Meta.`
      }
    }
  }
  if (footers.some((footer) => String(footer.text || '').length > 60)) return 'O rodapé deve ter no máximo 60 caracteres.'
  for (const button of buttons) {
    const hasText = Boolean(String(button.text || '').trim())
    const hasUrl = Boolean(String(button.url || '').trim())
    const hasParameters = (button.parameters || []).some(cloudParameterHasContent)
    const hasDynamicSuffix = String(button.url || '').includes('{{1}}')
    if (hasText !== hasUrl || (hasParameters && (!hasText || !hasUrl))) return 'Para usar o botão opcional, informe o texto e o link HTTPS.'
    if (hasParameters !== hasDynamicSuffix) return 'O link dinâmico exige exatamente um sufixo {{1}}; links fixos não usam parâmetro.'
    if (String(button.text || '').length > 25) return 'O texto do botão deve ter no máximo 25 caracteres.'
    const urlError = optionalCloudButtonUrlError(button.url)
    if (urlError) return urlError
  }
  if (components.filter((component) => component.type === 'header').length > 1) return 'Use no máximo um componente de cabeçalho.'
  if (components.filter((component) => component.type === 'body').length > 1) return 'Use no máximo um componente de corpo.'
  if (components.some((component) => ['header', 'button'].includes(component.type) && (component.parameters || []).filter(cloudParameterHasContent).length > 1)) return 'Cabeçalhos e botões aceitam somente um parâmetro por componente.'
  const buttonIndexes = buttons.map((component) => String(component.index))
  if (new Set(buttonIndexes).size !== buttonIndexes.length) return 'Cada botão deve usar um índice diferente.'
  const keys = parameters.map((parameter, index) => normalizeCloudVariableKey(parameter.key || parameter.label, `campo_${index + 1}`))
  if (keys.some((key) => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))) return 'As variáveis devem começar com letra e ter no máximo 64 caracteres.'
  if (components.some((component) => {
    const componentKeys = (component.parameters || []).filter(cloudParameterHasContent).map((parameter, index) => normalizeCloudVariableKey(parameter.key || parameter.label, `campo_${index + 1}`))
    return new Set(componentKeys).size !== componentKeys.length
  })) return 'Cada parâmetro do mesmo componente deve usar uma variável diferente.'
  if (parameters.some((parameter) => !String(parameter.label || '').trim())) return 'Informe um rótulo para cada parâmetro.'
  for (const parameter of parameters.filter((item) => isCloudMediaParameter(item.type))) {
    const fixedValue = String(parameter.fixedValue || parameter.example || '').trim()
    if (parameter.mediaSource !== 'upload') {
      if (!isValidHttpsTemplateUrl(fixedValue)) return `${cloudMediaExampleLabel(parameter.type)} deve usar uma URL HTTPS pública.`
    } else if (!/^[a-f\d]{24}$/i.test(String(parameter.mediaAssetId || ''))) {
      return `Faça o upload do arquivo para preencher ${cloudMediaExampleLabel(parameter.type).toLowerCase()}.`
    }
  }
  for (const component of components) {
    const metaNames = (component.parameters || []).filter(cloudParameterHasContent).map((parameter) => String(parameter.parameterName || '').trim())
    if (component.type === 'button' && metaNames.some(Boolean)) return 'Botões usam parâmetros posicionais; remova o nome Meta do botão.'
    if (metaNames.some((name) => name && !/^[a-z][a-z0-9_]{0,63}$/.test(name))) return 'O nome do parâmetro na Meta aceita letras minúsculas, números e sublinhado.'
    if (metaNames.some(Boolean) && !metaNames.every(Boolean)) return 'Em cada componente, use todos os parâmetros nomeados ou todos posicionais.'
  }
  if (parameters.some((parameter) => parameter.type === 'currency' && !/^[A-Za-z]{3}$/.test(parameter.currencyCode || ''))) return 'Parâmetros de moeda exigem um código ISO de três letras, como BRL.'
  if (buttons.some((component) => !/^[0-9]$/.test(String(component.index)))) return 'O índice de cada botão deve estar entre 0 e 9.'
  return null
}

export function renderWhatsAppCloudPreview(value) {
  const preset = findWhatsAppCloudPreset(value)
  return preset.parameters.reduce(
    (preview, parameter) => preview.replaceAll(`{{${parameter.key}}}`, parameter.example),
    preset.preview,
  )
}
</script>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import DOMPurify from 'dompurify'
import { useQuasar } from 'quasar'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import ContextHelp from '../components/ContextHelp.vue'
import TelegramTemplateBuilder from '../components/TelegramTemplateBuilder.vue'
import { emailHtmlToPlainText, looksLikeFlattenedEmailHtml } from '../services/email-templates.js'
import { asList, errorMessage, fetchAll, http, paginationOf, unwrap } from '../services/http.js'
import {
  TEMPLATE_SET_CHANNELS,
  templateSetChannels,
  templateSetContains,
  templateSetId,
  templateSetLinkResultSummary,
  templateSetPayload,
  templateSetTemplateIds,
  templateSetWithTemplate,
} from '../services/template-sets.js'
import {
  createTelegramDefinition,
  normalizeTelegramDefinition,
  telegramDefinitionBody,
  telegramDefinitionError,
  telegramDefinitionFromTemplate,
  telegramVariables,
} from '../services/telegram-templates.js'

const $q = useQuasar()
const loading = ref(false)
const saving = ref(false)
const dialog = ref(false)
const cloudPreviewMode = ref('visual')
const tab = ref('all')
const search = ref('')
const editingId = ref(null)
const cloningSourceId = ref(null)
const templates = ref([])
const invites = ref([])
const templateSets = ref([])
const allTemplateSets = ref([])
const templateSetLoading = ref(false)
const templateSetSaving = ref(false)
const templateSetDialog = ref(false)
const templateSetEditingId = ref(null)
const templateSetSearch = ref('')
const templateSetInviteFilter = ref(null)
const templateSetPagination = ref({
  page: 1,
  rowsPerPage: 10,
  rowsNumber: 0,
  sortBy: 'updatedAt',
  descending: true,
})
const linkSetDialog = ref(false)
const linkSetSaving = ref(false)
const linkSetTemplate = ref(null)
const linkSetIds = ref([])
const pendingCloudMediaAssetIds = new Set()

const channelOptions = [
  { label: 'WhatsApp Cloud', value: 'whatsapp_cloud', icon: 'mdi-whatsapp', tone: 'whatsapp' },
  { label: 'Telegram', value: 'telegram', icon: 'bi-telegram', tone: 'telegram' },
  { label: 'Gmail', value: 'email', icon: 'mdi-gmail', tone: 'gmail' },
]

const templateSetChannelOptions = channelOptions.map((channel) => ({
  ...channel,
  label: channel.value === 'email' ? 'Gmail' : channel.label,
}))

const emptyTemplateSetForm = () => ({
  name: '',
  description: '',
  inviteId: null,
  templateIds: {
    whatsapp_cloud: null,
    telegram: null,
    email: null,
  },
})
const templateSetForm = reactive(emptyTemplateSetForm())

const cloudPresetOptions = [...WHATSAPP_CLOUD_PRESETS, CUSTOM_WHATSAPP_CLOUD_TEMPLATE].map((preset) => ({
  label: preset.label,
  value: preset.value,
  description: preset.description,
}))

const emptyForm = () => ({
  name: '',
  channel: 'telegram',
  format: 'text',
  subject: '',
  body: '',
  description: '',
  cloudPreset: 'custom',
  cloudComponents: [],
  variablesText: '',
  metadata: { approvedName: '', language: 'pt_BR' },
  telegramDefinition: createTelegramDefinition('text'),
})
const form = reactive(emptyForm())
const selectedCloudPreset = computed(() => findWhatsAppCloudPreset(form.cloudPreset))
const isCustomCloudTemplate = computed(() => form.channel === 'whatsapp_cloud' && form.cloudPreset === 'custom')
const editingTemplateRecord = computed(() => templates.value.find((template) => recordId(template) === editingId.value) || null)
const isEditingFixedCloudTemplate = computed(() => Boolean(
  editingTemplateRecord.value
  && isSystemTemplateRecord(editingTemplateRecord.value)
  && form.cloudPreset !== 'custom',
))
const cloudPresetOptionsForForm = computed(() => (
  isEditingFixedCloudTemplate.value
    ? cloudPresetOptions.filter((option) => option.value === form.cloudPreset)
    : cloudPresetOptions.filter((option) => option.value === 'custom')
))
const cloudStandardHeader = computed(() => form.cloudComponents.find((component) => component.type === 'header') || null)
const cloudStandardMedia = computed(() => cloudStandardHeader.value?.parameters?.[0] || null)
const cloudStandardMediaMode = computed(() => cloudMediaContentMode(cloudStandardMedia.value || {}))
const cloudStandardBody = computed(() => form.cloudComponents.find((component) => component.type === 'body') || null)
const cloudStandardFooter = computed(() => form.cloudComponents.find((component) => component.type === 'footer') || null)
const cloudStandardButton = computed(() => form.cloudComponents.find((component) => component.type === 'button') || null)
const cloudStandardBodyMode = computed(() => cloudBodyContentMode(cloudStandardBody.value || {}))
const cloudStandardBodyHasAdvancedParameters = computed(() => cloudBodyHasAdvancedParameters(cloudStandardBody.value || {}))
const cloudStandardBodyVariable = computed(() => cloudBodyVariableParameter(cloudStandardBody.value || {}))
const cloudStandardBodyValueMode = computed(() => cloudParameterValueMode(cloudStandardBodyVariable.value || {}))
const cloudStandardButtonMode = computed(() => cloudButtonUrlMode(cloudStandardButton.value || {}))
const cloudStandardButtonSuffix = computed(() => cloudButtonSuffixParameter(cloudStandardButton.value || {}))
const cloudStandardButtonValueMode = computed(() => cloudParameterValueMode(cloudStandardButtonSuffix.value || {}))
const availableCloudStandardComponents = computed(() => OPTIONAL_STANDARD_COMPONENTS.filter((option) => (
  !form.cloudComponents.some((component) => component.type === option.type)
)))
const cloudPreviewText = computed(() => (
  isCustomCloudTemplate.value
    ? previewCloudComponentText(cloudStandardBody.value || {}) || 'Nenhum conteúdo visual opcional foi configurado.'
    : renderWhatsAppCloudPreview(form.cloudPreset)
))
const cloudPreviewFooter = computed(() => isCustomCloudTemplate.value ? String(cloudStandardFooter.value?.text || '').trim() : '')
const cloudPreviewButton = computed(() => isCustomCloudTemplate.value ? {
  text: String(cloudStandardButton.value?.text || '').trim(),
  url: previewCloudButtonUrl(cloudStandardButton.value || {}).trim(),
} : null)
const cloudPreviewPayload = computed(() => {
  if (isCustomCloudTemplate.value) {
    return buildCustomWhatsAppCloudPreviewPayload({
      templateName: form.metadata.approvedName,
      languageCode: form.metadata.language,
      components: form.cloudComponents,
    })
  }
  const definition = buildWhatsAppCloudTemplateDefinition(form.cloudPreset)
  return {
    messaging_product: 'whatsapp',
    to: '{{telefone_do_contato}}',
    type: 'template',
    template: {
      name: definition.externalTemplateName,
      language: { code: definition.languageCode },
      ...(definition.payload?.components?.length ? { components: definition.payload.components } : {}),
    },
  }
})
const cloudPreviewPayloadJson = computed(() => JSON.stringify(cloudPreviewPayload.value, null, 2))
const cloudHeaderMediaPreview = computed(() => {
  if (!isCustomCloudTemplate.value) return null
  const header = form.cloudComponents.find((component) => component.type === 'header')
  const parameter = header?.parameters?.find((item) => isCloudMediaParameter(item.type))
  const url = String(parameter?.fixedValue || parameter?.example || '').trim()
  if (!parameter || !url) return null
  return {
    type: parameter.type,
    url,
    filename: String(parameter.filename || parameter.uploadedFilename || '').trim() || 'Documento',
    uploaded: parameter.mediaSource === 'upload',
  }
})
const cloudMediaPreviewFailed = ref(false)
watch(() => cloudHeaderMediaPreview.value?.url, () => {
  cloudMediaPreviewFailed.value = false
})

const columns = [
  { name: 'name', label: 'Template', field: 'name', align: 'left', sortable: true },
  { name: 'channel', label: 'Canal', field: 'channel', align: 'left', sortable: true },
  { name: 'format', label: 'Formato', field: 'format', align: 'left' },
  { name: 'updatedAt', label: 'Atualizado', field: 'updatedAt', align: 'left', sortable: true },
  { name: 'actions', label: '', field: 'actions', align: 'right' },
]

const templateSetColumns = [
  { name: 'name', label: 'Conjunto', field: 'name', align: 'left' },
  { name: 'invite', label: 'Convite associado', field: 'inviteId', align: 'left' },
  { name: 'channels', label: 'Templates por canal', field: 'templates', align: 'left' },
  { name: 'updatedAt', label: 'Atualizado', field: 'updatedAt', align: 'left' },
  { name: 'actions', label: '', field: 'actions', align: 'right' },
]

const inviteOptions = computed(() => invites.value.map((invite) => ({
  label: invite.title || invite.name || invite.slug || 'Convite sem título',
  caption: invite.slug ? `/${invite.slug}` : '',
  value: recordId(invite),
})))

const templatesByChannel = computed(() => Object.fromEntries(TEMPLATE_SET_CHANNELS.map((channel) => [
  channel,
  templates.value
    .filter((template) => template.active !== false && normalizedChannel(template.channel || template.type) === channel)
    .map((template) => ({
      label: template.name || template.title || 'Template sem nome',
      caption: template.description || template.subject || '',
      value: recordId(template),
    })),
])))

const selectedLinkSetChannel = computed(() => normalizedChannel(
  linkSetTemplate.value?.channel || linkSetTemplate.value?.type,
))

const eligibleLinkSets = computed(() => allTemplateSets.value.filter((set) => {
  const channel = selectedLinkSetChannel.value
  return TEMPLATE_SET_CHANNELS.includes(channel)
    && (!templateSetTemplateIds(set)[channel]
      || templateSetContains(set, channel, recordId(linkSetTemplate.value)))
}))

const filteredTemplates = computed(() => {
  const needle = search.value.toLowerCase().trim()
  return templates.value.filter((template) => {
    const channel = normalizedChannel(template.channel || template.type)
    if (!channelOptions.some((option) => option.value === channel)) return false
    const matchesTab = tab.value === 'all' || channel === tab.value
    const matchesSearch = !needle || [template.name, template.subject, template.body]
      .some((value) => String(value || '').toLowerCase().includes(needle))
    return matchesTab && matchesSearch
  })
})

const safePreview = computed(() => {
  if (form.channel === 'whatsapp_cloud') {
    return DOMPurify.sanitize(`<p>${renderWhatsAppPreviewMarkup(cloudPreviewText.value)}</p>`)
  }
  if (form.channel === 'telegram') {
    const text = telegramDefinitionBody(form.telegramDefinition) || 'Comece a escrever para visualizar o conteúdo.'
    const escaped = document.createElement('div')
    escaped.textContent = text
    return `<p>${escaped.innerHTML.replace(/\n/g, '<br>')}</p>`
  }
  const body = form.body || 'Comece a escrever para visualizar o conteúdo.'
  if (form.channel === 'email' && form.format === 'html') {
    return DOMPurify.sanitize(body, { USE_PROFILES: { html: true } })
  }
  const escaped = document.createElement('div')
  escaped.textContent = body
  return `<p>${escaped.innerHTML.replace(/\n/g, '<br>')}</p>`
})

const flattenedEmailHtml = computed(() => (
  form.channel === 'email'
  && form.format === 'html'
  && looksLikeFlattenedEmailHtml(form.body)
))

const telegramMediaPreview = computed(() => {
  if (form.channel !== 'telegram') return null
  const definition = normalizeTelegramDefinition(form.telegramDefinition)
  if (!['photo', 'video'].includes(definition.kind)) return null
  try {
    const url = new URL(String(definition.mediaUrl || ''))
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return { kind: definition.kind, url: url.toString() }
  } catch {
    return null
  }
})
const telegramMediaPreviewFailed = ref(false)
watch(() => telegramMediaPreview.value?.url, () => {
  telegramMediaPreviewFailed.value = false
})

function recordId(record) {
  return record?.id || record?._id
}

function normalizedChannel(value = '') {
  const key = String(value).toLowerCase().replaceAll('-', '_')
  if (['whatsappcloud', 'meta', 'whatsapp_official'].includes(key)) return 'whatsapp_cloud'
  if (key === 'gmail') return 'email'
  return key
}

function channelLabel(value) {
  if (normalizedChannel(value) === 'global') return 'Global (legado)'
  return channelOptions.find((option) => option.value === normalizedChannel(value))?.label || value || '—'
}

function channelIcon(value) {
  if (normalizedChannel(value) === 'global') return 'hub'
  return channelOptions.find((option) => option.value === normalizedChannel(value))?.icon || 'description'
}

function channelTone(value) {
  if (normalizedChannel(value) === 'global') return 'global'
  return channelOptions.find((option) => option.value === normalizedChannel(value))?.tone || 'neutral'
}

function templateRowClass(row) {
  return `template-list-row template-list-row--${channelTone(row?.channel || row?.type)}`
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function inviteLabel(value) {
  const id = typeof value === 'object' ? recordId(value) : value
  if (!id) return 'Sem convite'
  const invite = invites.value.find((item) => String(recordId(item)) === String(id))
  return invite?.title || invite?.name || invite?.slug || 'Convite não encontrado'
}

function templateSetTemplateName(set, channel) {
  const id = templateSetTemplateIds(set)[channel]
  const template = templates.value.find((item) => String(recordId(item)) === String(id))
  return template?.name || template?.title || 'Template não encontrado'
}

async function loadTemplates() {
  loading.value = true
  try {
    templates.value = await fetchAll('/templates', { preferredKey: 'templates' })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível carregar os templates.') })
  } finally {
    loading.value = false
  }
}

async function loadTemplateSets(request = {}) {
  templateSetLoading.value = true
  const requestedPagination = request.pagination || templateSetPagination.value
  try {
    const payload = unwrap(await http.get('/template-sets', {
      params: {
        page: requestedPagination.page,
        limit: requestedPagination.rowsPerPage,
        search: templateSetSearch.value.trim() || undefined,
        inviteId: templateSetInviteFilter.value || undefined,
      },
    }))
    templateSets.value = asList(payload, 'templateSets')
    templateSetPagination.value = {
      ...requestedPagination,
      ...paginationOf(payload, {
        page: requestedPagination.page,
        rowsPerPage: requestedPagination.rowsPerPage,
        rowsNumber: templateSets.value.length,
      }),
    }
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível carregar os conjuntos.') })
  } finally {
    templateSetLoading.value = false
  }
}

async function loadAllTemplateSets() {
  allTemplateSets.value = await fetchAll('/template-sets', {
    preferredKey: 'templateSets',
    limit: 100,
  })
}

async function loadPageData() {
  loading.value = true
  try {
    const [templateItems, inviteItems] = await Promise.all([
      fetchAll('/templates', { preferredKey: 'templates' }),
      fetchAll('/invites', { preferredKey: 'invites' }),
    ])
    templates.value = templateItems
    invites.value = inviteItems
    await loadTemplateSets()
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível carregar a biblioteca de templates.') })
  } finally {
    loading.value = false
  }
}

function reloadTemplateSets() {
  templateSetPagination.value.page = 1
  loadTemplateSets()
}

let templateSetSearchTimer
watch(templateSetSearch, () => {
  clearTimeout(templateSetSearchTimer)
  templateSetSearchTimer = setTimeout(reloadTemplateSets, 300)
})
watch(templateSetInviteFilter, reloadTemplateSets)

function openCreateTemplateSet() {
  templateSetEditingId.value = null
  Object.assign(templateSetForm, emptyTemplateSetForm())
  templateSetDialog.value = true
}

function openEditTemplateSet(set) {
  templateSetEditingId.value = templateSetId(set)
  Object.assign(templateSetForm, emptyTemplateSetForm(), {
    name: set.name || '',
    description: set.description || '',
    inviteId: typeof set.inviteId === 'object' ? recordId(set.inviteId) : set.inviteId || recordId(set.invite),
    templateIds: templateSetTemplateIds(set),
  })
  templateSetDialog.value = true
}

async function saveTemplateSet() {
  if (!templateSetForm.name.trim()) {
    $q.notify({ type: 'warning', message: 'Informe o nome do conjunto.' })
    return
  }
  if (!TEMPLATE_SET_CHANNELS.some((channel) => Boolean(templateSetForm.templateIds[channel]))) {
    $q.notify({ type: 'warning', message: 'Vincule ao menos um template ao conjunto.' })
    return
  }
  templateSetSaving.value = true
  try {
    const payload = templateSetPayload(templateSetForm)
    if (templateSetEditingId.value) {
      await http.put(`/template-sets/${templateSetEditingId.value}`, payload)
    } else {
      await http.post('/template-sets', payload)
    }
    templateSetDialog.value = false
    $q.notify({ type: 'positive', message: 'Conjunto salvo com sucesso.' })
    await Promise.all([loadTemplateSets(), loadAllTemplateSets()])
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível salvar o conjunto.') })
  } finally {
    templateSetSaving.value = false
  }
}

function removeTemplateSet(set) {
  $q.dialog({
    title: 'Remover conjunto?',
    message: `O conjunto “${set.name}” deixará de estar disponível para novos disparos. Os templates vinculados não serão removidos.`,
    cancel: { flat: true, label: 'Cancelar' },
    ok: { color: 'negative', label: 'Remover conjunto' },
  }).onOk(async () => {
    try {
      await http.delete(`/template-sets/${templateSetId(set)}`)
      if (templateSets.value.length === 1 && templateSetPagination.value.page > 1) {
        templateSetPagination.value.page -= 1
      }
      $q.notify({ type: 'positive', message: 'Conjunto removido.' })
      await Promise.all([loadTemplateSets(), loadAllTemplateSets()])
    } catch (error) {
      $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível remover o conjunto.') })
    }
  })
}

async function openLinkSetDialog(template) {
  linkSetTemplate.value = template
  try {
    await loadAllTemplateSets()
    linkSetIds.value = allTemplateSets.value
      .filter((set) => templateSetContains(set, normalizedChannel(template.channel || template.type), recordId(template)))
      .map(templateSetId)
    linkSetDialog.value = true
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível carregar os conjuntos disponíveis.') })
  }
}

async function saveTemplateSetLinks() {
  const template = linkSetTemplate.value
  const channel = selectedLinkSetChannel.value
  if (!template || !TEMPLATE_SET_CHANNELS.includes(channel)) return
  const currentSetIds = new Set(allTemplateSets.value
    .filter((set) => templateSetContains(set, channel, recordId(template)))
    .map((set) => String(templateSetId(set))))
  const selectedSetIds = new Set(linkSetIds.value.map(String))
  const setsToLink = eligibleLinkSets.value.filter((set) => (
    selectedSetIds.has(String(templateSetId(set)))
    && !currentSetIds.has(String(templateSetId(set)))
  ))
  if (!setsToLink.length) {
    linkSetDialog.value = false
    $q.notify({ type: 'info', message: 'O template já está vinculado aos conjuntos selecionados.' })
    return
  }
  linkSetSaving.value = true
  const results = await Promise.allSettled(setsToLink.map((set) => http.put(
      `/template-sets/${templateSetId(set)}`,
      templateSetWithTemplate(set, channel, recordId(template)),
    )))
  const summary = templateSetLinkResultSummary(results)
  await Promise.allSettled([loadTemplateSets(), loadAllTemplateSets()])
  linkSetSaving.value = false

  if (!summary.failed) {
    linkSetDialog.value = false
    $q.notify({ type: 'positive', message: `Template vinculado a ${summary.succeeded} conjunto(s).` })
    return
  }
  if (summary.succeeded) {
    linkSetDialog.value = false
    $q.notify({
      type: 'warning',
      message: `Vínculo parcial: ${summary.succeeded} concluído(s) e ${summary.failed} com falha.`,
      caption: errorMessage(summary.firstError, 'Reabra o vínculo para tentar novamente nos conjuntos restantes.'),
      timeout: 7000,
    })
    return
  }
  $q.notify({
    type: 'negative',
    message: `Nenhum vínculo foi concluído (${summary.failed} falha(s)).`,
    caption: errorMessage(summary.firstError, 'Revise os conjuntos e tente novamente.'),
    timeout: 7000,
  })
}

function openCreate(channel = tab.value) {
  cleanupPendingCloudMedia().catch(() => {})
  editingId.value = null
  cloningSourceId.value = null
  Object.assign(form, emptyForm(), { channel: channel === 'all' ? 'telegram' : channel })
  if (form.channel === 'email') form.format = 'html'
  if (form.channel === 'telegram') form.format = 'telegram_text'
  if (form.channel === 'whatsapp_cloud') applyCloudPreset('custom', { suggestName: true })
  cloudPreviewMode.value = 'visual'
  dialog.value = true
}

function applyCloudPreset(value, { suggestName = false } = {}) {
  const previousPreset = findWhatsAppCloudPreset(form.cloudPreset)
  const preset = findWhatsAppCloudPreset(value)
  const canSuggestName = suggestName || !form.name || form.name === previousPreset.label
  form.cloudPreset = preset.value
  form.format = 'approved_template'
  if (preset.value === 'custom') {
    form.metadata.approvedName = ''
    form.metadata.language = form.metadata.language || 'pt_BR'
    form.description = ''
    form.body = ''
    form.variablesText = ''
    form.cloudComponents = []
    if (canSuggestName) form.name = 'Campanha oficial do WhatsApp'
    return
  }
  form.metadata.approvedName = preset.templateName
  form.metadata.language = preset.languageCode
  form.body = preset.preview
  form.variablesText = preset.parameters.map((parameter) => parameter.key).join(', ')
  if (canSuggestName) form.name = preset.label
}

function onChannelChange(value) {
  if (value !== 'whatsapp_cloud') cleanupPendingCloudMedia().catch(() => {})
  if (value === 'email') {
    form.format = 'html'
    return
  }
  if (value === 'telegram') {
    form.format = 'telegram_text'
    form.telegramDefinition = createTelegramDefinition('text')
    return
  }
  if (value === 'whatsapp_cloud') {
    applyCloudPreset(editingId.value ? form.cloudPreset : 'custom', { suggestName: !editingId.value })
    return
  }
  if (form.format === 'approved_template') form.format = 'text'
}

function onCloudPresetChange(value) {
  applyCloudPreset(value, { suggestName: true })
}

function addCloudComponent() {
  const usedTypes = new Set(form.cloudComponents.map((component) => component.type))
  const type = !usedTypes.has('body') ? 'body' : !usedTypes.has('header') ? 'header' : 'button'
  form.cloudComponents.push(createCloudComponent({ type, parameters: [] }))
}

function removeCloudComponent(index) {
  const [component] = form.cloudComponents.splice(index, 1)
  for (const parameter of component?.parameters || []) discardPendingCloudMedia(parameter.mediaAssetId)
}

function moveItem(list, index, direction) {
  const target = index + direction
  if (target < 0 || target >= list.length) return
  const [item] = list.splice(index, 1)
  list.splice(target, 0, item)
}

function addCloudParameter(component) {
  if (['header', 'button'].includes(component.type) && component.parameters.length >= 1) {
    $q.notify({ type: 'warning', message: component.type === 'header' ? 'O cabeçalho aceita somente um parâmetro.' : 'Cada botão aceita somente um parâmetro.' })
    return
  }
  const type = component.type === 'button' && component.subType === 'copy_code'
      ? 'coupon_code'
      : component.type === 'button' && component.subType === 'quick_reply'
        ? 'payload'
        : 'text'
  const defaults = cloudParameterDefault(type)
  component.parameters.push(createCloudParameter({
    type,
    key: uniqueCloudParameterKey(defaults.key),
    label: defaults.label,
    example: '',
  }))
}

function uniqueCloudParameterKey(base, currentParameter = null) {
  const normalized = normalizeCloudVariableKey(base)
  const used = new Set(form.cloudComponents.flatMap((component) => component.parameters
    .filter((parameter) => parameter !== currentParameter)
    .map((parameter) => normalizeCloudVariableKey(parameter.key))))
  if (!used.has(normalized)) return normalized
  let suffix = 2
  while (used.has(`${normalized}_${suffix}`)) suffix += 1
  return `${normalized}_${suffix}`
}

function onCloudParameterTypeChange(parameter) {
  discardPendingCloudMedia(parameter.mediaAssetId)
  const defaults = cloudParameterDefault(parameter.type)
  const autoKeys = Object.values(META_PARAMETER_DEFAULTS).map((item) => item.key)
  const autoLabels = Object.values(META_PARAMETER_DEFAULTS).map((item) => item.label)
  if (!parameter.key || /^campo_\d+$/.test(parameter.key) || autoKeys.some((key) => parameter.key === key || parameter.key.startsWith(`${key}_`))) {
    parameter.key = uniqueCloudParameterKey(defaults.key, parameter)
  }
  if (!parameter.label || /^Campo \d+$/.test(parameter.label) || autoLabels.includes(parameter.label)) {
    parameter.label = defaults.label
  }
  if (isCloudMediaParameter(parameter.type)) {
    parameter.fixedValue = ''
    parameter.example = ''
    parameter.mediaSource = 'url'
    parameter.mediaAssetId = ''
    parameter.mimeType = ''
    parameter.mediaType = parameter.type
    parameter.uploadedFilename = ''
    parameter.uploadFile = null
    if (parameter.type !== 'document') parameter.filename = ''
  } else {
    parameter.fixedValue = ''
    parameter.example = ''
    parameter.mediaSource = 'url'
    parameter.mediaAssetId = ''
    parameter.mimeType = ''
    parameter.mediaType = ''
    parameter.uploadedFilename = ''
    parameter.uploadFile = null
  }
}

function parameterOptionsFor(component) {
  if (component.type === 'button') {
    const allowed = ['url', 'otp_copy_code'].includes(component.subType)
      ? ['text']
      : component.subType === 'copy_code'
        ? ['coupon_code']
        : ['payload']
    return META_PARAMETER_OPTIONS.filter((option) => allowed.includes(option.value))
  }
  if (component.type === 'body') return META_PARAMETER_OPTIONS.filter((option) => ['text', 'currency', 'date_time'].includes(option.value))
  return META_PARAMETER_OPTIONS.filter((option) => ['text', 'image', 'document', 'video'].includes(option.value))
}

function onCloudComponentTypeChange(component) {
  const allowed = new Set(parameterOptionsFor(component).map((option) => option.value))
  const fallbackType = parameterOptionsFor(component)[0]?.value || 'text'
  for (const parameter of component.parameters) {
    if (!allowed.has(parameter.type)) {
      parameter.type = fallbackType
      onCloudParameterTypeChange(parameter)
    }
  }
}

function onCloudButtonSubTypeChange(component) {
  onCloudComponentTypeChange(component)
}

function removeCloudParameter(component, index) {
  const [parameter] = component.parameters.splice(index, 1)
  discardPendingCloudMedia(parameter?.mediaAssetId)
}

function cloudMediaAssetIds() {
  return form.cloudComponents.flatMap((component) => (
    (component.parameters || []).map((parameter) => String(parameter.mediaAssetId || '').trim()).filter(Boolean)
  ))
}

async function discardPendingCloudMedia(assetId) {
  const id = String(assetId || '').trim()
  if (!id || !pendingCloudMediaAssetIds.has(id)) return
  pendingCloudMediaAssetIds.delete(id)
  await http.delete(`/media/${id}`).catch(() => {})
}

async function cleanupPendingCloudMedia(keepIds = []) {
  const keep = new Set(keepIds.map(String))
  await Promise.all([...pendingCloudMediaAssetIds]
    .filter((id) => !keep.has(id))
    .map((id) => discardPendingCloudMedia(id)))
}

function onCloudMediaSourceChange(parameter, source) {
  const contentMode = cloudMediaContentMode(parameter)
  discardPendingCloudMedia(parameter.mediaAssetId)
  parameter.mediaSource = source
  parameter.contentMode = contentMode
  parameter.fixedValue = ''
  parameter.example = ''
  parameter.mediaAssetId = ''
  parameter.mimeType = ''
  parameter.mediaType = parameter.type
  parameter.uploadedFilename = ''
  parameter.uploadFile = null
}

function onStandardMediaTypeChange(type) {
  const parameter = cloudStandardMedia.value
  if (!parameter) return
  parameter.type = type
  onCloudParameterTypeChange(parameter)
  parameter.key = 'midia_cabecalho'
  parameter.label = 'Mídia do cabeçalho'
  parameter.mediaType = type
}

function onCloudMediaModeChange(mode) {
  setCloudMediaContentMode(cloudStandardMedia.value, mode)
}

function onCloudMediaValueChange(value) {
  updateCloudMediaValue(cloudStandardMedia.value, value)
}

function addCloudStandardComponent(type) {
  if (form.cloudComponents.some((component) => component.type === type)) return
  form.cloudComponents.push(createOptionalStandardComponent(type))
  const order = new Map(OPTIONAL_STANDARD_COMPONENTS.map((option, index) => [option.type, index]))
  form.cloudComponents.sort((left, right) => (order.get(left.type) ?? 99) - (order.get(right.type) ?? 99))
}

function removeCloudStandardComponent(type) {
  const index = form.cloudComponents.findIndex((component) => component.type === type)
  if (index < 0) return
  const [component] = form.cloudComponents.splice(index, 1)
  if (type === 'header') {
    for (const parameter of component.parameters || []) discardPendingCloudMedia(parameter.mediaAssetId).catch(() => {})
  }
}

function onCloudBodyModeChange(mode) {
  if (cloudStandardBodyHasAdvancedParameters.value) {
    $q.notify({
      type: 'warning',
      message: 'Este template legado possui múltiplos parâmetros no corpo.',
      caption: 'A estrutura original foi preservada para evitar alterações incompatíveis com o modelo aprovado na Meta.',
    })
    return
  }
  const hadVariable = Boolean(cloudStandardBodyVariable.value)
  setCloudBodyContentMode(cloudStandardBody.value, mode)
  if (mode === 'dynamic' && !hadVariable && cloudStandardBodyVariable.value) {
    setCloudParameterValueMode(
      cloudStandardBodyVariable.value,
      'fixed',
      CLOUD_BODY_VARIABLE_DEFAULTS.example,
    )
  }
}

function onCloudBodyVariableChange(value) {
  renameCloudBodyVariable(cloudStandardBody.value, value)
}

function onCloudBodyValueModeChange(mode) {
  setCloudParameterValueMode(
    cloudStandardBodyVariable.value,
    mode,
    CLOUD_BODY_VARIABLE_DEFAULTS.example,
  )
}

function onCloudBodyValueChange(value) {
  updateCloudParameterValue(cloudStandardBodyVariable.value, value)
}

function onCloudButtonModeChange(mode) {
  const hadSuffix = Boolean(cloudStandardButtonSuffix.value)
  setCloudButtonUrlMode(cloudStandardButton.value, mode)
  if (mode === 'dynamic' && !hadSuffix && cloudStandardButtonSuffix.value) {
    setCloudParameterValueMode(
      cloudStandardButtonSuffix.value,
      'fixed',
      CLOUD_BUTTON_SUFFIX_DEFAULTS.example,
    )
  }
}

function onCloudButtonBaseUrlChange(value) {
  updateCloudButtonBaseUrl(cloudStandardButton.value, value)
}

function onCloudButtonSuffixKeyChange(value) {
  const parameter = cloudStandardButtonSuffix.value
  if (!parameter) return
  parameter.key = normalizeCloudVariableKey(value, CLOUD_BUTTON_SUFFIX_DEFAULTS.key)
  parameter.parameterName = ''
}

function onCloudButtonValueModeChange(mode) {
  setCloudParameterValueMode(
    cloudStandardButtonSuffix.value,
    mode,
    CLOUD_BUTTON_SUFFIX_DEFAULTS.example,
  )
}

function onCloudButtonValueChange(value) {
  updateCloudParameterValue(cloudStandardButtonSuffix.value, value)
}

function cloudButtonUrlRule(value) {
  return optionalCloudButtonUrlError(value) || true
}

function warnForbiddenCloudButtonUrl() {
  if (!isForbiddenWhatsAppButtonUrl(cloudStandardButton.value?.url)) return
  $q.notify({
    type: 'warning',
    message: 'Use um destino externo para este botão.',
    caption: 'Links para WhatsApp, api.whatsapp.com e wa.me não são permitidos.',
    timeout: 6500,
  })
}

function componentHelpTitle(component) {
  if (component.type === 'header') return 'Cabeçalho do template na Meta'
  if (component.type === 'button') return 'Botão do template na Meta'
  return 'Corpo do template na Meta'
}

function componentHelpText(component) {
  if (component.type === 'header') {
    return [
      'No criador oficial da Meta, o cabeçalho pode ser texto ou uma amostra de imagem, vídeo ou documento. Repita aqui exatamente o mesmo tipo aprovado.',
      'Cabeçalhos de mídia aceitam um único parâmetro. O arquivo pode vir de um link HTTPS público ou do upload seguro para o Notify Flow.',
    ]
  }
  if (component.type === 'button') {
    return [
      'Escolha o mesmo subtipo configurado no criador da Meta e informe o índice visual do botão, começando em 0.',
      'URL dinâmica e copiar código usam um parâmetro; botões estáticos não precisam ser adicionados ao payload.',
    ]
  }
  return [
    'Cada variável do corpo deve aparecer na mesma ordem do modelo aprovado na Meta.',
    'Se o modelo usa parâmetros nomeados, preencha todos os nomes deste componente; se usa {{1}}, {{2}}, mantenha os nomes Meta vazios.',
  ]
}

function parameterHelpText(parameter) {
  if (parameter.type === 'image') return ['Use a mesma imagem de cabeçalho esperada pelo modelo aprovado.', 'O link precisa ser HTTPS e acessível pela Meta, ou você pode enviar a imagem para o Notify Flow.']
  if (parameter.type === 'video') return ['Use um vídeo MP4 ou 3GPP compatível com o cabeçalho aprovado na Meta.', 'O upload gera um link hospedado pelo Notify Flow para compor o payload automaticamente.']
  if (parameter.type === 'document') return ['Use um documento compatível com o cabeçalho aprovado e, se desejar, informe o nome exibido ao destinatário.', 'O arquivo enviado fica associado ao template e o link é montado automaticamente no payload.']
  if (parameter.type === 'currency') return ['Informe um exemplo legível e o código ISO de três letras, como BRL.', 'No disparo, o Notify Flow converte o valor para o objeto currency exigido pela Meta.']
  if (parameter.type === 'date_time') return ['O exemplo ajuda o operador a reconhecer o campo de data e hora.', 'O valor será convertido para date_time no payload final.']
  return ['A variável interna identifica este valor dentro do Notify Flow.', 'O nome Meta só deve ser preenchido quando o modelo oficial usa parâmetros nomeados em vez de posições como {{1}}.']
}

async function uploadCloudParameterMedia(parameter, selectedFile) {
  const file = Array.isArray(selectedFile) ? selectedFile[0] : selectedFile
  if (!file) return
  const contentMode = cloudMediaContentMode(parameter)
  parameter.uploading = true
  try {
    await discardPendingCloudMedia(parameter.mediaAssetId)
    parameter.fixedValue = ''
    parameter.example = ''
    parameter.mediaAssetId = ''
    parameter.mimeType = ''
    parameter.uploadedFilename = ''
    const body = new FormData()
    body.append('file', file)
    body.append('mediaType', parameter.type)
    body.append('purpose', 'template')
    const uploaded = unwrap(await http.post('/media', body, { timeout: 600000 })) || {}
    if (!uploaded.url) throw new Error('O servidor não retornou o link público da mídia.')
    if (uploaded.mediaType && uploaded.mediaType !== parameter.type) {
      throw new Error(`O arquivo enviado é do tipo ${uploaded.mediaType}, mas este campo exige ${parameter.type}.`)
    }
    parameter.mediaSource = 'upload'
    parameter.contentMode = contentMode
    parameter.fixedValue = contentMode === 'fixed' ? uploaded.url : ''
    parameter.example = uploaded.url
    parameter.mediaAssetId = uploaded.id || ''
    if (parameter.mediaAssetId) pendingCloudMediaAssetIds.add(String(parameter.mediaAssetId))
    parameter.mimeType = uploaded.mimeType || file.type || ''
    parameter.mediaType = uploaded.mediaType || parameter.type
    parameter.uploadedFilename = uploaded.filename || file.name || ''
    if (parameter.type === 'document' && !parameter.filename) parameter.filename = uploaded.filename || file.name || ''
    $q.notify({ type: 'positive', message: 'Mídia enviada e vinculada ao template.' })
  } catch (error) {
    parameter.uploadFile = null
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível enviar a mídia.') })
  } finally {
    parameter.uploading = false
  }
}

function onCloudMediaRejected(parameter, rejectedEntries = []) {
  const reason = rejectedEntries[0]?.failedPropValidation
  const fallback = `Use um arquivo compatível de até ${cloudMediaLimitLabel(parameter.type)}.`
  $q.notify({
    type: 'warning',
    message: reason === 'max-file-size' ? `O arquivo excede o limite de ${cloudMediaLimitLabel(parameter.type)}.` : fallback,
  })
}

function customCloudValidationError() {
  return validateCustomWhatsAppCloudTemplate({
    templateName: form.metadata.approvedName,
    languageCode: form.metadata.language,
    components: form.cloudComponents,
  })
}

function openEdit(template) {
  cleanupPendingCloudMedia().catch(() => {})
  const channel = normalizedChannel(template.channel || template.type)
  if (channel === 'global') {
    $q.notify({ type: 'info', message: 'Templates globais antigos ficam disponíveis apenas para consulta. Crie um template separado por canal.' })
    return
  }
  editingId.value = recordId(template)
  cloningSourceId.value = null
  const metadata = template.metadata || {}
  const variables = template.variables || []
  const cloudPreset = findWhatsAppCloudPreset(template.whatsappCloudPreset || template.externalTemplateName).value
  Object.assign(form, emptyForm(), {
    name: template.name || template.title || '',
    channel,
    cloudPreset,
    format: template.templateType || template.format || (channel === 'email' && template.html ? 'html' : 'text'),
    subject: template.subject || '',
    body: template.html || template.body || template.content || template.message || '',
    description: template.description || '',
    cloudComponents: channel === 'whatsapp_cloud' && cloudPreset === 'custom' ? standardMarketingComponentsFromTemplate(template) : [],
    variablesText: Array.isArray(variables) ? variables.join(', ') : String(variables || ''),
    metadata: {
      approvedName: template.externalTemplateName || metadata.approvedName || template.approvedName || '',
      language: META_LANGUAGE_OPTIONS.some((option) => option.value === (template.languageCode || metadata.language || template.language))
        ? (template.languageCode || metadata.language || template.language)
        : 'pt_BR',
    },
    telegramDefinition: channel === 'telegram' ? telegramDefinitionFromTemplate(template) : createTelegramDefinition('text'),
  })
  if (channel === 'whatsapp_cloud' && cloudPreset !== 'custom') applyCloudPreset(cloudPreset)
  cloudPreviewMode.value = 'visual'
  dialog.value = true
}

function copiedMetaTemplateName(value = '') {
  const base = normalizeCloudVariableKey(value, 'modelo_meta').toLowerCase()
  const copyBase = `${base.slice(0, 506)}_copia`
  const used = new Set(templates.value.map((template) => String(template.externalTemplateName || '').trim().toLowerCase()))
  let candidate = copyBase
  let suffix = 2
  while (used.has(candidate)) {
    candidate = `${copyBase.slice(0, Math.max(1, 511 - String(suffix).length))}_${suffix}`
    suffix += 1
  }
  return candidate
}

function openClone(template) {
  const channel = normalizedChannel(template.channel || template.type)
  if (channel === 'global') {
    $q.notify({ type: 'info', message: 'Templates globais antigos são somente leitura e não podem ser clonados.' })
    return
  }

  openEdit(template)
  if (!dialog.value) return

  editingId.value = null
  cloningSourceId.value = recordId(template)
  form.name = templateCopyName(
    template.name || template.title || 'Template',
    templates.value.map((item) => item.name || item.title),
  )

  if (channel === 'whatsapp_cloud') {
    const restoredComponents = isSystemTemplateRecord(template)
      ? standardMarketingComponentsFromTemplate(template)
      : form.cloudComponents
    form.cloudComponents = cloneCloudComponentsForDraft(restoredComponents)

    if (isSystemTemplateRecord(template)) {
      form.cloudPreset = 'custom'
      form.metadata.approvedName = copiedMetaTemplateName(
        template.externalTemplateName || template.metadata?.approvedName || template.name,
      )
      form.body = ''
      form.variablesText = ''
    }
  }

  cloudPreviewMode.value = 'visual'
}

async function save() {
  saving.value = true
  if (flattenedEmailHtml.value) {
    $q.notify({
      type: 'negative',
      message: 'O conteúdo parece HTML colado como texto.',
      caption: 'Cole novamente o código-fonte mantendo as tags entre < e >.',
      timeout: 7000,
    })
    saving.value = false
    return
  }
  const validationError = isCustomCloudTemplate.value ? customCloudValidationError() : null
  if (validationError) {
    $q.notify({ type: 'warning', message: validationError })
    saving.value = false
    return
  }
  const telegramDefinition = form.channel === 'telegram'
    ? normalizeTelegramDefinition(form.telegramDefinition)
    : null
  const telegramError = telegramDefinition ? telegramDefinitionError(telegramDefinition) : null
  if (telegramError) {
    $q.notify({ type: 'warning', message: telegramError })
    saving.value = false
    return
  }
  const cloudDefinition = form.channel === 'whatsapp_cloud'
    ? (isCustomCloudTemplate.value
        ? buildCustomWhatsAppCloudDefinition({
            templateName: form.metadata.approvedName,
            languageCode: form.metadata.language,
            description: form.description,
            components: form.cloudComponents,
          })
        : buildWhatsAppCloudTemplateDefinition(form.cloudPreset))
    : null
  const isEmailHtml = form.channel === 'email' && form.format === 'html'
  const payload = {
    name: form.name,
    channel: form.channel,
    templateType: cloudDefinition?.templateType || (telegramDefinition ? `telegram_${telegramDefinition.kind}` : form.format),
    format: cloudDefinition?.templateType || (telegramDefinition ? `telegram_${telegramDefinition.kind}` : form.format),
    subject: form.channel === 'email' ? form.subject || undefined : undefined,
    description: cloudDefinition?.description || form.description || undefined,
    body: cloudDefinition?.body || (telegramDefinition
      ? telegramDefinitionBody(telegramDefinition)
      : isEmailHtml
        ? emailHtmlToPlainText(form.body)
        : form.body),
    html: form.channel === 'email' ? (isEmailHtml ? form.body : null) : undefined,
    variables: cloudDefinition?.variables || (telegramDefinition ? telegramVariables(telegramDefinition) : form.variablesText.split(',').map((item) => item.trim()).filter(Boolean)),
    payload: cloudDefinition?.payload || (telegramDefinition ? { telegram: telegramDefinition } : null),
    whatsappCloudPreset: cloudDefinition?.whatsappCloudPreset,
    externalTemplateName: cloudDefinition?.externalTemplateName,
    languageCode: cloudDefinition?.languageCode,
  }
  try {
    if (editingId.value) await http.put(`/templates/${editingId.value}`, payload)
    else await http.post('/templates', payload)
    for (const id of cloudMediaAssetIds()) pendingCloudMediaAssetIds.delete(id)
    await cleanupPendingCloudMedia()
    dialog.value = false
    $q.notify({ type: 'positive', message: cloningSourceId.value ? 'Cópia do template salva com sucesso.' : 'Template salvo com sucesso.' })
    cloningSourceId.value = null
    await loadTemplates()
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error) })
  } finally {
    saving.value = false
  }
}

watch(dialog, (open) => {
  if (!open) {
    cloningSourceId.value = null
    cleanupPendingCloudMedia().catch(() => {})
  }
})

onBeforeUnmount(() => {
  cleanupPendingCloudMedia().catch(() => {})
})

function remove(template) {
  if (isSystemTemplateRecord(template)) {
    $q.notify({ type: 'info', message: 'Este é um template padrão do sistema e não pode ser removido.' })
    return
  }
  $q.dialog({
    title: 'Remover template?',
    message: `O template “${template.name || template.title}” deixará de estar disponível para novos envios.`,
    cancel: { flat: true, label: 'Cancelar' },
    ok: { color: 'negative', label: 'Remover' },
  }).onOk(async () => {
    try {
      await http.delete(`/templates/${recordId(template)}`)
      $q.notify({ type: 'positive', message: 'Template removido.' })
      await loadTemplates()
    } catch (error) {
      $q.notify({ type: 'negative', message: errorMessage(error) })
    }
  })
}

onMounted(loadPageData)
</script>

<template>
  <q-page class="page-container">
    <PageHeader
      eyebrow="Biblioteca de conteúdo"
      title="Templates por canal"
      icon="dashboard_customize"
    />

    <q-card flat class="glass-card section-card template-sets-panel q-mb-lg">
      <div class="template-sets-heading">
        <div>
          <div class="text-overline text-primary">Campanhas multicanal</div>
          <h2 class="section-title">Conjuntos de templates</h2>
        </div>
        <q-btn color="primary" unelevated no-caps icon="add" label="Novo conjunto" @click="openCreateTemplateSet" />
      </div>

      <div class="template-set-filters">
        <q-input
          v-model="templateSetSearch"
          dense
          outlined
          clearable
          debounce="0"
          placeholder="Buscar conjunto ou convite"
        >
          <template #prepend><q-icon name="search" /></template>
        </q-input>
        <q-select
          v-model="templateSetInviteFilter"
          dense
          outlined
          clearable
          emit-value
          map-options
          :options="inviteOptions"
          label="Filtrar por convite"
        />
      </div>

      <EmptyState
        v-if="!templateSetLoading && !templateSets.length"
        icon="library_add"
        title="Nenhum conjunto neste filtro"
        description="Crie uma seleção reutilizável com os canais necessários para cada campanha."
      >
        <q-btn color="primary" unelevated no-caps label="Criar conjunto" @click="openCreateTemplateSet" />
      </EmptyState>
      <q-table
        v-else
        v-model:pagination="templateSetPagination"
        flat
        :rows="templateSets"
        :columns="templateSetColumns"
        :row-key="templateSetId"
        :loading="templateSetLoading"
        :rows-per-page-options="[5, 10, 25]"
        @request="loadTemplateSets"
      >
        <template #body-cell-name="props">
          <q-td :props="props">
            <div class="template-set-name">
              <span class="template-set-icon"><q-icon name="hub" /></span>
              <div>
                <strong>{{ props.row.name }}</strong>
                <span>{{ props.row.description || `${templateSetChannels(props.row).length} canal(is) vinculado(s)` }}</span>
              </div>
            </div>
          </q-td>
        </template>
        <template #body-cell-invite="props">
          <q-td :props="props">
            <q-chip
              dense
              :outline="!props.row.inviteId"
              :color="props.row.inviteId ? 'primary' : 'grey-5'"
              :text-color="props.row.inviteId ? 'white' : 'grey-8'"
              icon="link"
            >
              {{ inviteLabel(props.row.inviteId || props.row.invite) }}
            </q-chip>
          </q-td>
        </template>
        <template #body-cell-channels="props">
          <q-td :props="props">
            <div class="template-set-channel-list">
              <q-chip
                v-for="channel in templateSetChannels(props.row)"
                :key="channel"
                dense
                outline
                :class="['template-channel-chip', `template-channel-chip--${channelTone(channel)}`]"
                :icon="channelOptions.find((item) => item.value === channel)?.icon"
              >
                {{ templateSetTemplateName(props.row, channel) }}
                <q-tooltip>{{ channelLabel(channel) }}</q-tooltip>
              </q-chip>
            </div>
          </q-td>
        </template>
        <template #body-cell-updatedAt="props">
          <q-td :props="props">{{ formatDate(props.row.updatedAt) }}</q-td>
        </template>
        <template #body-cell-actions="props">
          <q-td :props="props">
            <q-btn flat round dense icon="edit" aria-label="Editar conjunto" @click="openEditTemplateSet(props.row)">
              <q-tooltip>Editar conjunto</q-tooltip>
            </q-btn>
            <q-btn flat round dense color="negative" icon="delete" aria-label="Remover conjunto" @click="removeTemplateSet(props.row)">
              <q-tooltip>Remover conjunto sem apagar os templates</q-tooltip>
            </q-btn>
          </q-td>
        </template>
      </q-table>
    </q-card>

    <q-card flat class="glass-card section-card">
      <div class="template-library-heading">
        <div>
          <div class="text-overline text-primary">Biblioteca por canal</div>
          <h2 class="section-title">Templates por canal</h2>
        </div>
        <q-btn color="primary" unelevated no-caps icon="add" label="Novo template" @click="openCreate()" />
      </div>

      <div class="toolbar-row">
        <div class="template-tabs-row">
          <q-tabs v-model="tab" dense no-caps outside-arrows mobile-arrows indicator-color="transparent">
            <q-tab name="all" icon="view_list" label="Todos" class="template-channel-tab template-channel-tab--all" />
            <q-tab
              v-for="channel in channelOptions"
              :key="channel.value"
              :name="channel.value"
              :icon="channel.icon"
              :label="channel.label"
              :class="['template-channel-tab', `template-channel-tab--${channel.tone}`]"
            />
          </q-tabs>
          <ContextHelp
            title="Templates oficiais e número remetente"
            tooltip="Entenda quais templates pertencem a cada número"
            :text="[
              'Templates oficiais dependem do número remetente. Os itens OFICIAL META TEST NUMBER pertencem ao fluxo com o número de teste.',
              'O item OFICIAL META PROD NUMBER valida o modo de teste com um número de produção. Antes do envio, confirme que o modelo com o mesmo nome e idioma está disponível e aprovado na conta do WhatsApp Business que atende o número correspondente.',
            ]"
          />
        </div>
        <q-input v-model="search" dense outlined clearable placeholder="Buscar template" class="search-field">
          <template #prepend><q-icon name="search" /></template>
        </q-input>
      </div>

      <EmptyState v-if="!loading && !filteredTemplates.length" icon="note_add" title="Nenhum template neste filtro" description="Crie uma mensagem reutilizável para começar.">
        <q-btn color="primary" unelevated no-caps label="Criar template" @click="openCreate()" />
      </EmptyState>
      <q-table
        v-else
        flat
        class="template-library-table"
        :rows="filteredTemplates"
        :columns="columns"
        row-key="id"
        :loading="loading"
        :rows-per-page-options="[10, 25, 50]"
        :table-row-class-fn="templateRowClass"
      >
        <template #body-cell-name="props">
          <q-td :props="props">
            <div class="template-name">
              <span :class="['template-icon', `template-icon--${channelTone(props.row.channel || props.row.type)}`]" aria-hidden="true">
                <q-icon :name="channelIcon(props.row.channel || props.row.type)" size="22px" />
              </span>
              <div class="template-name__copy">
                <strong>
                  {{ props.row.name || props.row.title }}
                  <q-icon v-if="isSystemTemplateRecord(props.row)" name="lock" size="14px" color="primary"><q-tooltip>Template padrão do sistema</q-tooltip></q-icon>
                </strong>
                <span>{{ props.row.description || props.row.subject || String(props.row.body || props.row.content || '').slice(0, 78) || 'Sem descrição' }}</span>
              </div>
            </div>
          </q-td>
        </template>
        <template #body-cell-channel="props">
          <q-td :props="props">
            <q-badge
              outline
              :class="['template-channel-badge', `template-channel-badge--${channelTone(props.row.channel || props.row.type)}`]"
            >
              <q-icon :name="channelIcon(props.row.channel || props.row.type)" size="13px" />
              <span>{{ channelLabel(props.row.channel || props.row.type) }}</span>
            </q-badge>
          </q-td>
        </template>
        <template #body-cell-format="props">
          <q-td :props="props">
            {{ templateFormatLabel(props.row) }}
          </q-td>
        </template>
        <template #body-cell-updatedAt="props"><q-td :props="props">{{ formatDate(props.row.updatedAt) }}</q-td></template>
        <template #body-cell-actions="props">
          <q-td :props="props">
            <q-btn
              v-if="TEMPLATE_SET_CHANNELS.includes(normalizedChannel(props.row.channel || props.row.type))"
              flat
              round
              dense
              color="primary"
              icon="playlist_add"
              aria-label="Vincular template a conjuntos"
              @click="openLinkSetDialog(props.row)"
            >
              <q-tooltip>Vincular este template a um ou mais conjuntos</q-tooltip>
            </q-btn>
            <q-btn
              v-if="normalizedChannel(props.row.channel || props.row.type) !== 'global'"
              flat
              round
              dense
              color="primary"
              icon="content_copy"
              aria-label="Clonar template"
              @click="openClone(props.row)"
            >
              <q-tooltip>Clonar como um novo template editável</q-tooltip>
            </q-btn>
            <q-btn
              v-if="normalizedChannel(props.row.channel || props.row.type) !== 'global'"
              flat
              round
              dense
              icon="edit"
              aria-label="Editar template"
              @click="openEdit(props.row)"
            />
            <q-icon v-else name="history" color="grey-6" size="20px">
              <q-tooltip>Template global legado: somente leitura</q-tooltip>
            </q-icon>
            <q-icon v-if="isSystemTemplateRecord(props.row)" name="lock" color="primary" size="20px" aria-label="Template padrão protegido">
              <q-tooltip>Template padrão do sistema: não pode ser removido</q-tooltip>
            </q-icon>
            <q-btn v-else flat round dense color="negative" icon="delete" aria-label="Remover template" @click="remove(props.row)" />
          </q-td>
        </template>
      </q-table>
    </q-card>

    <q-dialog v-model="templateSetDialog" persistent :maximized="$q.screen.lt.sm">
      <q-card class="template-set-dialog">
        <q-card-section class="template-set-dialog__header">
          <div>
            <div class="text-overline text-primary">Seleção reutilizável</div>
            <h2>{{ templateSetEditingId ? 'Editar conjunto' : 'Novo conjunto' }}</h2>
            <p>Escolha ao menos um canal. O mesmo template pode participar de vários conjuntos.</p>
          </div>
          <q-btn flat round dense icon="close" aria-label="Fechar" :disable="templateSetSaving" @click="templateSetDialog = false" />
        </q-card-section>
        <q-separator />
        <q-form @submit.prevent="saveTemplateSet">
          <q-card-section class="template-set-dialog__content scroll">
            <div class="template-set-form">
              <q-input
                v-model.trim="templateSetForm.name"
                outlined
                label="Nome do conjunto *"
                :rules="[(value) => Boolean(value) || 'Informe o nome']"
              />
              <q-select
                v-model="templateSetForm.inviteId"
                outlined
                clearable
                emit-value
                map-options
                :options="inviteOptions"
                label="Convite associado (opcional)"
              >
                <template #option="scope">
                  <q-item v-bind="scope.itemProps">
                    <q-item-section>
                      <q-item-label>{{ scope.opt.label }}</q-item-label>
                      <q-item-label v-if="scope.opt.caption" caption>{{ scope.opt.caption }}</q-item-label>
                    </q-item-section>
                  </q-item>
                </template>
              </q-select>
              <q-input
                v-model="templateSetForm.description"
                outlined
                type="textarea"
                autogrow
                maxlength="2000"
                counter
                label="Descrição"
                class="full-span"
              />
            </div>

            <div class="template-set-channel-grid">
              <article
                v-for="channel in templateSetChannelOptions"
                :key="channel.value"
                :class="['template-set-channel-card', `template-set-channel-card--${channel.tone}`]"
              >
                <header>
                  <span><q-icon :name="channel.icon" /></span>
                  <div>
                    <strong>{{ channel.label }}</strong>
                    <small>Um template deste canal</small>
                  </div>
                </header>
                <q-select
                  v-model="templateSetForm.templateIds[channel.value]"
                  outlined
                  clearable
                  emit-value
                  map-options
                  :options="templatesByChannel[channel.value]"
                  :label="`Template ${channel.label} (opcional)`"
                  :disable="!templatesByChannel[channel.value]?.length"
                >
                  <template #option="scope">
                    <q-item v-bind="scope.itemProps">
                      <q-item-section>
                        <q-item-label>{{ scope.opt.label }}</q-item-label>
                        <q-item-label v-if="scope.opt.caption" caption>{{ scope.opt.caption }}</q-item-label>
                      </q-item-section>
                    </q-item>
                  </template>
                </q-select>
              </article>
            </div>
          </q-card-section>
          <q-separator />
          <q-card-actions align="right" class="template-set-dialog__actions">
            <q-btn flat no-caps label="Cancelar" :disable="templateSetSaving" @click="templateSetDialog = false" />
            <q-btn color="primary" unelevated no-caps icon="save" label="Salvar conjunto" type="submit" :loading="templateSetSaving" />
          </q-card-actions>
        </q-form>
      </q-card>
    </q-dialog>

    <q-dialog v-model="linkSetDialog" :maximized="$q.screen.lt.sm">
      <q-card class="template-link-dialog">
        <q-card-section class="template-set-dialog__header">
          <div>
            <div class="text-overline text-primary">Vincular a conjuntos</div>
            <h2>{{ linkSetTemplate?.name || linkSetTemplate?.title }}</h2>
            <p>Selecione outros conjuntos que ainda não possuem um template de {{ channelLabel(selectedLinkSetChannel) }}.</p>
          </div>
          <q-btn flat round dense icon="close" aria-label="Fechar" :disable="linkSetSaving" @click="linkSetDialog = false" />
        </q-card-section>
        <q-separator />
        <q-card-section class="template-link-dialog__content scroll">
          <EmptyState
            v-if="!eligibleLinkSets.length"
            icon="playlist_add_check"
            title="Nenhum conjunto disponível"
            description="Crie um conjunto ou libere o canal desejado editando um conjunto existente."
          />
          <q-list v-else bordered separator class="rounded-borders">
            <q-item v-for="set in eligibleLinkSets" :key="templateSetId(set)" tag="label" clickable>
              <q-item-section avatar>
                <q-checkbox
                  v-model="linkSetIds"
                  :val="templateSetId(set)"
                  :disable="templateSetContains(set, selectedLinkSetChannel, recordId(linkSetTemplate))"
                />
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ set.name }}</q-item-label>
                <q-item-label caption>
                  {{ inviteLabel(set.inviteId || set.invite) }} · {{ templateSetChannels(set).length }} canal(is)
                </q-item-label>
              </q-item-section>
              <q-item-section v-if="templateSetContains(set, selectedLinkSetChannel, recordId(linkSetTemplate))" side>
                <q-badge color="positive" label="Já vinculado" />
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>
        <q-separator />
        <q-card-actions align="right" class="template-set-dialog__actions">
          <q-btn flat no-caps label="Cancelar" :disable="linkSetSaving" @click="linkSetDialog = false" />
          <q-btn color="primary" unelevated no-caps icon="playlist_add" label="Vincular selecionados" :loading="linkSetSaving" @click="saveTemplateSetLinks" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="dialog" persistent :maximized="$q.screen.lt.md">
      <q-card class="template-dialog">
        <q-card-section class="row items-center q-px-lg q-py-md template-dialog__header">
          <div>
            <div class="text-h6 text-weight-bold">{{ cloningSourceId ? 'Clonar template' : editingId ? 'Editar template' : 'Novo template' }}</div>
            <div class="dialog-subtitle">
              {{ form.channel === 'whatsapp_cloud'
                ? 'Escolha um modelo aprovado pela Meta; o sistema monta o payload automaticamente.'
                : 'Use variáveis entre chaves duplas para personalizar o conteúdo.' }}
            </div>
          </div>
          <q-space />
          <q-btn v-close-popup flat round dense icon="close" aria-label="Fechar" />
        </q-card-section>
        <q-separator />
        <q-form @submit.prevent="save">
          <q-card-section class="template-builder q-pa-lg">
            <div class="editor-column">
              <section class="builder-section">
                <div class="section-heading">
                  <div>
                    <strong>Identificação</strong>
                    <span>Defina como este template aparecerá no Notify App.</span>
                  </div>
                </div>
                <div class="form-grid template-basics-grid">
                  <q-input
                    v-model.trim="form.name"
                    outlined
                    stack-label
                    label="Nome no Notify App *"
                    class="template-field"
                    :rules="[(value) => Boolean(value) || 'Informe o nome']"
                  />
                  <q-select
                    v-model="form.channel"
                    outlined
                    stack-label
                    emit-value
                    map-options
                    :options="channelOptions"
                    label="Canal de envio"
                    class="template-field"
                    @update:model-value="onChannelChange"
                  />
                  <q-select
                    v-if="form.channel === 'email'"
                    v-model="form.format"
                    outlined
                    stack-label
                    emit-value
                    map-options
                    label="Formato do conteúdo"
                    class="template-field"
                    :options="[{ label: 'Texto', value: 'text' }, { label: 'HTML', value: 'html' }]"
                  />
                  <q-input
                    v-if="form.channel === 'email'"
                    v-model="form.subject"
                    outlined
                    stack-label
                    label="Assunto do email"
                    class="template-field"
                  />
                </div>
              </section>

              <template v-if="form.channel === 'telegram'">
                <section class="builder-section telegram-template-section">
                  <div class="section-heading">
                    <span class="step-number">1</span>
                    <div>
                      <strong>Escolha a experiência no Telegram</strong>
                      <span>Monte texto, mídia ou um fluxo de páginas sem escrever JSON.</span>
                    </div>
                  </div>
                  <TelegramTemplateBuilder v-model="form.telegramDefinition" />
                </section>
                <q-banner rounded class="automatic-payload-banner">
                  <template #avatar><q-icon name="auto_awesome" color="primary" /></template>
                  <strong>Payload protegido e automático.</strong>
                  O servidor converte este formulário para a Bot API, valida links e cria os callbacks dos submenus.
                </q-banner>
              </template>

              <template v-else-if="form.channel === 'whatsapp_cloud'">
                <section class="builder-section cloud-builder-section">
                  <div class="section-heading">
                    <span class="step-number">1</span>
                    <div>
                      <strong>Perfil do modelo oficial</strong>
                    </div>
                  </div>

                  <q-select
                    v-model="form.cloudPreset"
                    outlined
                    stack-label
                    emit-value
                    map-options
                    :options="cloudPresetOptionsForForm"
                    :readonly="isEditingFixedCloudTemplate"
                    :hide-dropdown-icon="isEditingFixedCloudTemplate"
                    label="Perfil do template"
                    class="template-field cloud-preset-select"
                    @update:model-value="onCloudPresetChange"
                  >
                    <template #option="scope">
                      <q-item v-bind="scope.itemProps" class="cloud-preset-option">
                        <q-item-section avatar><q-icon name="verified" color="primary" /></q-item-section>
                        <q-item-section>
                          <q-item-label>{{ scope.opt.label }}</q-item-label>
                          <q-item-label caption>{{ scope.opt.description }}</q-item-label>
                        </q-item-section>
                      </q-item>
                    </template>
                  </q-select>

                  <div v-if="!isCustomCloudTemplate" class="official-fields">
                    <q-input
                      :model-value="selectedCloudPreset.templateName"
                      outlined
                      stack-label
                      readonly
                      label="Nome oficial na Meta"
                      class="template-field official-name-field"
                    >
                      <template #prepend><q-icon name="verified" color="primary" /></template>
                    </q-input>
                    <q-input
                      :model-value="selectedCloudPreset.languageCode"
                      outlined
                      stack-label
                      readonly
                      label="Idioma aprovado"
                      class="template-field language-field"
                    />
                  </div>
                  <div v-else class="custom-official-fields">
                    <q-input
                      v-model.trim="form.metadata.approvedName"
                      outlined
                      stack-label
                      label="Nome exato aprovado na Meta *"
                      hint="Exemplo: confirmacao_pagamento_v2"
                      class="template-field full-span official-name-field"
                      :rules="[(value) => Boolean(value) || 'Informe o nome oficial']"
                    >
                      <template #prepend><q-icon name="verified" color="primary" /></template>
                    </q-input>
                    <q-select
                      v-model="form.metadata.language"
                      outlined
                      stack-label
                      emit-value
                      map-options
                      :options="META_LANGUAGE_OPTIONS"
                      clearable
                      label="Idioma aprovado (opcional)"
                      class="template-field language-field"
                    />
                    <q-input
                      v-model.trim="form.description"
                      outlined
                      stack-label
                      type="textarea"
                      autogrow
                      label="Descrição interna"
                      hint="Ajuda o administrador a localizar o template. Não entra no payload oficial."
                      class="template-field full-span"
                    />
                  </div>
                </section>

                <section class="builder-section cloud-builder-section">
                  <div class="section-heading">
                    <span class="step-number">2</span>
                    <div>
                      <strong>{{ isCustomCloudTemplate ? 'Conteúdo fixo aprovado' : 'Campos automáticos do modelo fixo' }}</strong>
                      <span v-if="isCustomCloudTemplate">Adicione somente os componentes que existem no modelo aprovado. Para um teste simples, todos podem ficar ausentes.</span>
                      <span v-else-if="selectedCloudPreset.parameters.length">A integração preenche estes dados automaticamente conforme o modelo preservado.</span>
                      <span v-else>Este modelo fixo não exige dados adicionais.</span>
                    </div>
                  </div>

                  <div v-if="isCustomCloudTemplate" class="standard-marketing-builder">
                    <div class="optional-component-picker">
                      <div>
                        <strong>Componentes opcionais</strong>
                      </div>
                      <div v-if="availableCloudStandardComponents.length" class="optional-component-actions">
                        <q-btn
                          v-for="option in availableCloudStandardComponents"
                          :key="option.type"
                          outline
                          no-caps
                          color="primary"
                          :icon="option.icon"
                          :label="`Adicionar ${option.label}`"
                          @click="addCloudStandardComponent(option.type)"
                        />
                      </div>
                    </div>
                    <q-banner v-if="!form.cloudComponents.length" rounded class="no-parameters-banner optional-components-empty">
                      <template #avatar><q-icon name="science" color="primary" /></template>
                      Nenhum componente adicionado. O payload de teste enviará apenas o nome oficial e o idioma padrão pt_BR.
                    </q-banner>
                    <article v-if="cloudStandardMedia" class="standard-field-card standard-field-card--media">
                      <header class="standard-field-card__header">
                        <span class="standard-field-card__icon"><q-icon name="perm_media" /></span>
                        <div><strong>Mídia do cabeçalho</strong><span>Repita o mesmo tipo usado no modelo aprovado.</span></div>
                        <div class="standard-field-card__actions">
                          <ContextHelp
                            title="Cabeçalho de mídia na Meta"
                            tooltip="Como configurar a mídia"
                            :text="['Este bloco é opcional. Use-o somente se o modelo aprovado tiver cabeçalho de imagem, vídeo ou documento.', 'Ao usar, selecione exatamente o tipo aprovado e informe um link HTTPS público ou faça upload para o Notify Flow.']"
                          />
                          <q-btn flat round dense color="negative" icon="delete_outline" aria-label="Remover cabeçalho" @click="removeCloudStandardComponent('header')">
                            <q-tooltip>Remover cabeçalho opcional</q-tooltip>
                          </q-btn>
                        </div>
                      </header>
                      <div class="standard-field-grid">
                        <q-select
                          :model-value="cloudStandardMedia.type"
                          outlined
                          stack-label
                          emit-value
                          map-options
                          :options="META_PARAMETER_OPTIONS.filter((option) => ['image', 'video', 'document'].includes(option.value))"
                          label="Tipo da mídia"
                          class="template-field"
                          @update:model-value="onStandardMediaTypeChange"
                        />
                        <div class="friendly-mode-picker full-span">
                          <div>
                            <strong>Quando a mídia será escolhida?</strong>
                          </div>
                          <q-btn-toggle
                            :model-value="cloudStandardMediaMode"
                            no-caps
                            unelevated
                            toggle-color="primary"
                            color="white"
                            text-color="primary"
                            :options="[
                              { label: 'Sempre esta mídia', value: 'fixed', icon: 'lock' },
                              { label: 'Em cada disparo', value: 'dynamic', icon: 'sync_alt' },
                            ]"
                            @update:model-value="onCloudMediaModeChange"
                          />
                        </div>
                        <div class="media-source-picker">
                          <div><strong>Origem</strong><span>Link público ou upload protegido.</span></div>
                          <q-btn-toggle
                            v-model="cloudStandardMedia.mediaSource"
                            no-caps
                            unelevated
                            toggle-color="primary"
                            color="white"
                            text-color="primary"
                            :options="[
                              { label: 'Link HTTPS', value: 'url', icon: 'link' },
                              { label: 'Upload', value: 'upload', icon: 'cloud_upload' },
                            ]"
                            @update:model-value="onCloudMediaSourceChange(cloudStandardMedia, $event)"
                          />
                        </div>
                        <q-input
                          :model-value="cloudMediaDisplayValue(cloudStandardMedia)"
                          outlined
                          stack-label
                          :readonly="cloudStandardMedia.mediaSource === 'upload'"
                          :label="cloudStandardMediaMode === 'dynamic' ? `${cloudMediaExampleLabel(cloudStandardMedia.type)} para a prévia` : cloudMediaExampleLabel(cloudStandardMedia.type)"
                          :hint="cloudStandardMedia.mediaSource === 'upload' ? 'Faça o upload ou remova este bloco opcional' : cloudStandardMediaMode === 'dynamic' ? 'É só uma amostra; a mídia real será solicitada no disparo.' : 'Esta mídia será reutilizada automaticamente em todos os envios.'"
                          class="template-field full-span media-link-field"
                          @update:model-value="onCloudMediaValueChange"
                        >
                          <template #prepend><q-icon name="link" color="primary" /></template>
                          <template #append>
                            <q-btn
                              v-if="isValidHttpsTemplateUrl(cloudMediaDisplayValue(cloudStandardMedia))"
                              flat
                              round
                              dense
                              icon="open_in_new"
                              aria-label="Abrir mídia em nova guia"
                              type="a"
                              :href="cloudMediaDisplayValue(cloudStandardMedia)"
                              target="_blank"
                              rel="noopener noreferrer"
                            />
                          </template>
                        </q-input>
                        <q-file
                          v-if="cloudStandardMedia.mediaSource === 'upload'"
                          v-model="cloudStandardMedia.uploadFile"
                          outlined
                          stack-label
                          clearable
                          :accept="cloudMediaAccept(cloudStandardMedia.type)"
                          :max-file-size="cloudMediaMaxBytes(cloudStandardMedia.type)"
                          :loading="cloudStandardMedia.uploading"
                          :disable="cloudStandardMedia.uploading"
                          label="Selecionar arquivo para enviar"
                          :hint="`O arquivo ficará associado a este template · limite ${cloudMediaLimitLabel(cloudStandardMedia.type)}.`"
                          class="template-field full-span media-upload-field"
                          @update:model-value="uploadCloudParameterMedia(cloudStandardMedia, $event)"
                          @rejected="onCloudMediaRejected(cloudStandardMedia, $event)"
                        >
                          <template #prepend><q-icon name="cloud_upload" color="primary" /></template>
                          <template #append><q-badge v-if="cloudStandardMedia.mediaAssetId" color="positive" label="Upload concluído" /></template>
                        </q-file>
                        <q-banner v-if="cloudStandardMediaMode === 'dynamic'" rounded class="dynamic-component-note full-span">
                          <template #avatar><q-icon name="image" color="primary" /></template>
                          Este é o formato legado compatível: somente a mídia será pedida no momento do disparo. Corpo, rodapé e botão podem continuar fixos.
                        </q-banner>
                        <div v-if="cloudStandardMedia.mediaSource === 'upload' && cloudStandardMedia.uploadedFilename" class="uploaded-media-meta full-span">
                          <q-icon name="task_alt" color="positive" />
                          <span><strong>{{ cloudStandardMedia.uploadedFilename }}</strong><small>{{ cloudStandardMedia.mimeType || 'Tipo validado pelo servidor' }}</small></span>
                        </div>
                        <q-input
                          v-if="cloudStandardMedia.type === 'document'"
                          v-model.trim="cloudStandardMedia.filename"
                          outlined
                          stack-label
                          maxlength="240"
                          label="Nome exibido do arquivo"
                          hint="Opcional, por exemplo: regulamento.pdf"
                          class="template-field full-span"
                        />
                      </div>
                    </article>

                    <article v-if="cloudStandardBody" class="standard-field-card">
                      <header class="standard-field-card__header">
                        <span class="standard-field-card__icon"><q-icon name="subject" /></span>
                        <div><strong>Corpo da mensagem</strong><span>Use texto fixo ou uma variável nomeada, exatamente como no modelo aprovado.</span></div>
                        <div class="standard-field-card__actions">
                          <ContextHelp title="Corpo aprovado na Meta" tooltip="Sobre o corpo" :text="['Este bloco é opcional no Notify Flow durante os testes.', 'Para um modelo fixo, cole o texto aprovado. Para um modelo dinâmico nomeado, use o mesmo identificador da Meta, como {{body_description}}; o Notify Flow pedirá esse valor no disparo.']" />
                          <q-btn flat round dense color="negative" icon="delete_outline" aria-label="Remover corpo" @click="removeCloudStandardComponent('body')">
                            <q-tooltip>Remover corpo opcional</q-tooltip>
                          </q-btn>
                        </div>
                      </header>
                      <div class="friendly-mode-picker">
                        <div><strong>Como o corpo foi aprovado?</strong><span>Essa escolha define se o conteúdo já está pronto ou será informado no disparo.</span></div>
                        <q-btn-toggle
                          :model-value="cloudStandardBodyMode"
                          no-caps
                          unelevated
                          toggle-color="primary"
                          color="white"
                          text-color="primary"
                          :options="[
                            { label: 'Texto fixo', value: 'fixed', icon: 'notes' },
                            { label: 'Variável nomeada', value: 'dynamic', icon: 'data_object' },
                          ]"
                          :disable="cloudStandardBodyHasAdvancedParameters"
                          @update:model-value="onCloudBodyModeChange"
                        />
                      </div>
                      <div v-if="cloudStandardBodyMode === 'dynamic' && cloudStandardBodyVariable" class="friendly-mode-picker value-mode-picker">
                        <div>
                          <strong>Quando a descrição será definida?</strong>
                          <span>O parâmetro continua igual ao aprovado na Meta; muda apenas se o valor ficará salvo ou será pedido no envio.</span>
                        </div>
                        <q-btn-toggle
                          :model-value="cloudStandardBodyValueMode"
                          no-caps
                          unelevated
                          toggle-color="primary"
                          color="white"
                          text-color="primary"
                          :options="[
                            { label: 'Sempre este valor', value: 'fixed', icon: 'lock' },
                            { label: 'Definir em cada disparo', value: 'dynamic', icon: 'sync_alt' },
                          ]"
                          @update:model-value="onCloudBodyValueModeChange"
                        />
                      </div>
                      <q-banner v-if="cloudStandardBodyHasAdvancedParameters" rounded class="dynamic-component-note">
                        <template #avatar><q-icon name="history" color="primary" /></template>
                        Este template legado usa vários parâmetros no corpo. Eles permanecem intactos; o seletor amigável fica bloqueado para não alterar o contrato aprovado na Meta.
                      </q-banner>
                      <q-input
                        v-model="cloudStandardBody.text"
                        outlined
                        stack-label
                        type="textarea"
                        autogrow
                        maxlength="1024"
                        counter
                        :readonly="cloudStandardBodyHasAdvancedParameters"
                        :label="cloudStandardBodyMode === 'dynamic' ? 'Texto aprovado com a variável' : 'Corpo fixo (opcional)'"
                        :hint="cloudStandardBodyHasAdvancedParameters ? 'Estrutura legada preservada em modo somente leitura.' : cloudStandardBodyMode === 'dynamic' ? 'Mantenha o marcador nomeado no texto, por exemplo {{body_description}}.' : 'Cole exatamente o texto fixo aprovado na Meta.'"
                        class="template-field body-approved-text"
                      />
                      <div v-if="cloudStandardBodyMode === 'dynamic' && cloudStandardBodyVariable && !cloudStandardBodyHasAdvancedParameters" class="standard-field-grid dynamic-field-grid">
                        <q-input
                          :model-value="cloudStandardBodyVariable.key"
                          outlined
                          stack-label
                          label="Variável interna e nome na Meta"
                          hint="Exemplo: body_description"
                          class="template-field"
                          @update:model-value="onCloudBodyVariableChange"
                        >
                          <template #prepend><q-icon name="data_object" color="primary" /></template>
                        </q-input>
                        <q-input
                          v-model.trim="cloudStandardBodyVariable.label"
                          outlined
                          stack-label
                          label="Título"
                          class="template-field"
                        />
                        <q-input
                          :model-value="cloudParameterDisplayValue(cloudStandardBodyVariable)"
                          outlined
                          stack-label
                          :label="cloudStandardBodyValueMode === 'fixed' ? 'Descrição usada em todos os disparos' : 'Exemplo para a prévia'"
                          :hint="cloudStandardBodyValueMode === 'fixed' ? 'Este valor será enviado automaticamente e não será solicitado ao operador.' : 'Este exemplo aparece somente na prévia; o valor real será solicitado no disparo.'"
                          class="template-field full-span"
                          @update:model-value="onCloudBodyValueChange"
                        />
                      </div>
                    </article>

                    <article v-if="cloudStandardFooter" class="standard-field-card">
                      <header class="standard-field-card__header">
                        <span class="standard-field-card__icon"><q-icon name="short_text" /></span>
                        <div><strong>Rodapé</strong><span>Complemento discreto exibido abaixo da mensagem.</span></div>
                        <div class="standard-field-card__actions">
                          <ContextHelp title="Rodapé aprovado na Meta" tooltip="Sobre o rodapé" :text="['O rodapé é opcional na Meta e aceita até 60 caracteres.', 'Se o modelo aprovado não possui rodapé, remova este bloco ou deixe o campo vazio.']" />
                          <q-btn flat round dense color="negative" icon="delete_outline" aria-label="Remover rodapé" @click="removeCloudStandardComponent('footer')">
                            <q-tooltip>Remover rodapé opcional</q-tooltip>
                          </q-btn>
                        </div>
                      </header>
                      <q-input v-model="cloudStandardFooter.text" outlined stack-label maxlength="60" counter label="Rodapé fixo" class="template-field" />
                    </article>

                    <article v-if="cloudStandardButton" class="standard-field-card standard-field-card--button">
                      <header class="standard-field-card__header">
                        <span class="standard-field-card__icon"><q-icon name="ads_click" /></span>
                        <div><strong>Botão de link</strong><span>Use um destino fixo ou complete a URL com um sufixo informado no disparo.</span></div>
                        <div class="standard-field-card__actions">
                          <ContextHelp title="Botão de ação na Meta" tooltip="Sobre o botão" :text="['Este bloco é opcional. Se usar, informe juntos o rótulo e o destino HTTPS cadastrados no modelo oficial.', 'No modo de sufixo dinâmico, a Meta usa {{1}} ao final da URL e o Notify Flow solicita somente a parte variável, como o slug de um convite.', 'Links para WhatsApp, api.whatsapp.com e wa.me continuam bloqueados.']" />
                          <q-btn flat round dense color="negative" icon="delete_outline" aria-label="Remover botão" @click="removeCloudStandardComponent('button')">
                            <q-tooltip>Remover botão opcional</q-tooltip>
                          </q-btn>
                        </div>
                      </header>
                      <div class="friendly-mode-picker">
                        <div><strong>Como o destino foi aprovado?</strong><span>O sufixo dinâmico mantém a URL base e troca somente a parte final.</span></div>
                        <q-btn-toggle
                          :model-value="cloudStandardButtonMode"
                          no-caps
                          unelevated
                          toggle-color="primary"
                          color="white"
                          text-color="primary"
                          :options="[
                            { label: 'Link fixo', value: 'fixed', icon: 'link' },
                            { label: 'Sufixo dinâmico', value: 'dynamic', icon: 'route' },
                          ]"
                          @update:model-value="onCloudButtonModeChange"
                        />
                      </div>
                      <div v-if="cloudStandardButtonMode === 'dynamic' && cloudStandardButtonSuffix" class="friendly-mode-picker value-mode-picker">
                        <div>
                          <strong>Quando o destino será definido?</strong>
                          <span>A URL aprovada continua com {{1}}; escolha se o identificador será reutilizado ou informado no envio.</span>
                        </div>
                        <q-btn-toggle
                          :model-value="cloudStandardButtonValueMode"
                          no-caps
                          unelevated
                          toggle-color="primary"
                          color="white"
                          text-color="primary"
                          :options="[
                            { label: 'Sempre este valor', value: 'fixed', icon: 'lock' },
                            { label: 'Definir em cada disparo', value: 'dynamic', icon: 'sync_alt' },
                          ]"
                          @update:model-value="onCloudButtonValueModeChange"
                        />
                      </div>
                      <div class="standard-field-grid standard-field-grid--button">
                        <q-input v-model.trim="cloudStandardButton.text" outlined stack-label maxlength="25" counter label="Texto do botão" class="template-field" />
                        <q-input
                          v-if="cloudStandardButtonMode === 'fixed'"
                          v-model.trim="cloudStandardButton.url"
                          outlined
                          stack-label
                          label="Link HTTPS do botão"
                          hint="Exemplo: https://seudominio.com/convite"
                          class="template-field"
                          lazy-rules
                          :rules="[cloudButtonUrlRule]"
                          @blur="warnForbiddenCloudButtonUrl"
                        >
                          <template #prepend><q-icon name="link" color="primary" /></template>
                        </q-input>
                        <q-input
                          v-else
                          :model-value="cloudButtonBaseUrl(cloudStandardButton)"
                          outlined
                          stack-label
                          label="URL base aprovada na Meta"
                          hint="Exemplo: https://seudominio.com/invite/ · o Notify Flow acrescenta {{1}}"
                          class="template-field"
                          lazy-rules
                          :rules="[() => cloudButtonUrlRule(cloudStandardButton.url)]"
                          @update:model-value="onCloudButtonBaseUrlChange"
                          @blur="warnForbiddenCloudButtonUrl"
                        >
                          <template #prepend><q-icon name="link" color="primary" /></template>
                          <template #append><q-badge outline color="primary" label="+ {{1}}" /></template>
                        </q-input>
                      </div>
                      <div v-if="cloudStandardButtonMode === 'dynamic' && cloudStandardButtonSuffix" class="standard-field-grid dynamic-field-grid">
                        <q-input
                          :model-value="cloudStandardButtonSuffix.key"
                          outlined
                          stack-label
                          label="Variável interna do sufixo"
                          hint="Exemplo: invite_slug"
                          class="template-field"
                          @update:model-value="onCloudButtonSuffixKeyChange"
                        >
                          <template #prepend><q-icon name="route" color="primary" /></template>
                        </q-input>
                        <q-input
                          v-model.trim="cloudStandardButtonSuffix.label"
                          outlined
                          stack-label
                          label="Rótulo mostrado no disparo"
                          hint="Exemplo: Identificador do convite"
                          class="template-field"
                        />
                        <q-input
                          :model-value="cloudParameterDisplayValue(cloudStandardButtonSuffix)"
                          outlined
                          stack-label
                          :label="cloudStandardButtonValueMode === 'fixed' ? 'Identificador usado em todos os disparos' : 'Exemplo do identificador'"
                          :hint="cloudStandardButtonValueMode === 'fixed' ? 'Exemplo: grupo-alpha · será concatenado automaticamente à URL base.' : 'Exemplo: grupo-alpha · o valor real será solicitado no disparo.'"
                          class="template-field"
                          @update:model-value="onCloudButtonValueChange"
                        />
                        <div class="dynamic-url-result">
                          <q-icon name="open_in_new" color="primary" />
                          <span><small>Prévia do destino</small><strong>{{ cloudPreviewButton.url || 'Complete a URL base acima' }}</strong></span>
                        </div>
                      </div>
                      <q-banner v-if="isForbiddenWhatsAppButtonUrl(cloudStandardButton.url)" rounded class="forbidden-link-warning">
                        <template #avatar><q-icon name="link_off" color="negative" /></template>
                        Troque este destino por uma página externa. Links de WhatsApp e wa.me não podem ser salvos neste botão.
                      </q-banner>
                    </article>
                  </div>

                  <div v-else-if="selectedCloudPreset.parameters.length" class="parameter-list parameter-list--friendly">
                    <div v-for="parameter in selectedCloudPreset.parameters" :key="parameter.key" class="parameter-row">
                      <span class="parameter-position">{{ parameter.position }}</span>
                      <div class="parameter-copy">
                        <strong>{{ parameter.label }}</strong>
                        <span>Exemplo aprovado: {{ parameter.example }}</span>
                      </div>
                    </div>
                  </div>
                  <q-banner v-else rounded class="no-parameters-banner">
                    <template #avatar><q-icon name="check_circle" color="primary" /></template>
                    Pronto para usar: o modelo fixo não exige configuração adicional.
                  </q-banner>
                </section>

              </template>

              <template v-else>
                <section class="builder-section">
                  <div class="section-heading">
                    <div>
                      <strong>Conteúdo e variáveis</strong>
                      <span>Monte a mensagem reutilizável deste canal.</span>
                    </div>
                  </div>
                  <div class="form-grid">
                    <q-input
                      v-model="form.variablesText"
                      outlined
                      stack-label
                      label="Variáveis"
                      hint="Separe por vírgula: nome, protocolo"
                      class="full-span template-field"
                    />
                  </div>

                  <div class="content-editor">
                    <div class="field-heading">Conteúdo *</div>
                    <template v-if="form.channel === 'email' && form.format === 'html'">
                      <q-input
                        v-model="form.body"
                        outlined
                        stack-label
                        type="textarea"
                        :rows="18"
                        spellcheck="false"
                        wrap="off"
                        label="Código HTML *"
                        hint="Cole o código-fonte com as tags completas, por exemplo: &lt;div&gt;...&lt;/div&gt;. A prévia ao lado atualiza automaticamente."
                        class="html-source-editor template-field"
                        input-class="html-source-editor__input"
                        :rules="[(value) => Boolean(value) || 'Cole ou escreva o HTML do email']"
                      />
                      <q-banner v-if="flattenedEmailHtml" rounded class="flattened-html-warning">
                        <template #avatar><q-icon name="code_off" color="negative" /></template>
                        <strong>Este conteúdo perdeu as tags HTML.</strong>
                        Cole novamente o código-fonte mantendo os sinais <code>&lt;</code> e <code>&gt;</code>.
                      </q-banner>
                    </template>
                    <q-input v-else v-model="form.body" outlined stack-label type="textarea" autogrow label="Mensagem" class="template-field" :rules="[(value) => Boolean(value) || 'Escreva a mensagem']" />
                  </div>
                </section>
              </template>
            </div>

            <aside class="preview-column">
              <div class="preview-label">
                <span>Prévia em tempo real</span>
                <div class="preview-label-actions">
                  <q-badge color="primary" :label="channelLabel(form.channel)" />
                  <q-btn-toggle
                    v-if="form.channel === 'whatsapp_cloud'"
                    v-model="cloudPreviewMode"
                    dense
                    no-caps
                    unelevated
                    toggle-color="primary"
                    color="white"
                    text-color="primary"
                    :options="[
                      { label: 'Visual', value: 'visual', icon: 'visibility' },
                      { label: 'Payload', value: 'payload', icon: 'data_object' },
                    ]"
                  />
                </div>
              </div>
              <div v-if="form.channel !== 'whatsapp_cloud' || cloudPreviewMode === 'visual'" class="preview-email" :class="{ 'whatsapp-template-preview': form.channel === 'whatsapp_cloud', 'whatsapp-template-preview--standard': isCustomCloudTemplate }">
                <div v-if="form.channel === 'email'" class="preview-subject"><strong>Assunto:</strong> {{ form.subject || 'Sem assunto' }}</div>
                <div v-if="form.channel === 'whatsapp_cloud'" class="preview-meta-header">
                  <q-icon name="verified" color="primary" />
                  <div>
                    <strong>{{ isCustomCloudTemplate ? form.name || 'Template oficial' : selectedCloudPreset.label }}</strong>
                    <span>{{ isCustomCloudTemplate ? form.metadata.approvedName || 'nome_exato_na_meta' : selectedCloudPreset.templateName }}</span>
                  </div>
                </div>
                <div v-if="cloudHeaderMediaPreview && !cloudMediaPreviewFailed" class="preview-media cloud-header-media">
                  <img
                    v-if="cloudHeaderMediaPreview.type === 'image'"
                    :src="cloudHeaderMediaPreview.url"
                    alt="Prévia da imagem do cabeçalho WhatsApp"
                    referrerpolicy="no-referrer"
                    @error="cloudMediaPreviewFailed = true"
                  />
                  <video
                    v-else-if="cloudHeaderMediaPreview.type === 'video'"
                    :src="cloudHeaderMediaPreview.url"
                    controls
                    preload="metadata"
                    @error="cloudMediaPreviewFailed = true"
                  />
                  <a
                    v-else
                    :href="cloudHeaderMediaPreview.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="preview-document"
                  >
                    <q-icon name="description" size="34px" />
                    <span><strong>{{ cloudHeaderMediaPreview.filename }}</strong><small>Documento do cabeçalho</small></span>
                    <q-icon name="open_in_new" />
                  </a>
                </div>
                <q-banner v-if="cloudHeaderMediaPreview && cloudMediaPreviewFailed" dense rounded class="preview-media-error">
                  Não foi possível carregar esta mídia no navegador. Confira se o link é público; o servidor validará novamente antes do envio.
                </q-banner>
                <div v-if="telegramMediaPreview && !telegramMediaPreviewFailed" class="preview-media">
                  <img
                    v-if="telegramMediaPreview.kind === 'photo'"
                    :src="telegramMediaPreview.url"
                    alt="Prévia da imagem do template Telegram"
                    referrerpolicy="no-referrer"
                    @error="telegramMediaPreviewFailed = true"
                  />
                  <video
                    v-else
                    :src="telegramMediaPreview.url"
                    controls
                    preload="metadata"
                    @error="telegramMediaPreviewFailed = true"
                  />
                </div>
                <q-banner v-else-if="telegramMediaPreviewFailed" dense rounded class="preview-media-error">
                  O navegador não conseguiu carregar esta mídia. O servidor validará novamente o link durante o envio.
                </q-banner>
                <div class="preview-frame" v-html="safePreview" />
                <div v-if="form.channel === 'whatsapp_cloud' && cloudPreviewFooter" class="whatsapp-preview-footer">
                  {{ cloudPreviewFooter }}
                </div>
                <div v-if="form.channel === 'whatsapp_cloud' && cloudPreviewButton?.text" class="whatsapp-preview-button">
                  <q-icon name="open_in_new" />
                  <span>{{ cloudPreviewButton.text }}</span>
                </div>
              </div>
              <div v-else class="preview-payload-card">
                <div class="preview-payload-heading">
                  <div><strong>Payload montado automaticamente</strong><span>Os valores fixos são reutilizados sem expor campos técnicos ao operador.</span></div>
                  <q-icon name="data_object" color="primary" size="24px" />
                </div>
                <pre>{{ cloudPreviewPayloadJson }}</pre>
              </div>
              <div v-if="form.channel !== 'whatsapp_cloud'" class="preview-warning">
                <q-icon name="security" color="primary" />
                <span v-if="form.channel === 'telegram'">Somente texto simples é exibido; menus usam botões inline e mídias são validadas pelo servidor.</span>
                <span v-else>HTML perigoso é removido da prévia. A API ainda deve sanitizar antes do envio.</span>
              </div>
            </aside>
          </q-card-section>
          <q-separator />
          <q-card-actions align="right" class="q-pa-md q-px-lg template-dialog__footer">
            <q-btn v-close-popup flat no-caps label="Cancelar" />
            <q-btn type="submit" color="primary" unelevated no-caps icon="save" label="Salvar template" :loading="saving" />
          </q-card-actions>
        </q-form>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<style scoped>
.search-field {
  width: min(310px, 100%);
}

.template-tabs-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
}

.template-tabs-row .q-tabs {
  min-width: 0;
}

.template-tabs-row :deep(.q-tabs__content) {
  gap: 6px;
}

.template-channel-tab {
  min-height: 50px;
  border: 1px solid transparent;
  border-radius: 12px;
  opacity: 0.86;
  transition: border-color 160ms ease, background 160ms ease, color 160ms ease, opacity 160ms ease;
}

.template-channel-tab--all {
  color: #425a56;
}

.template-channel-tab--whatsapp {
  background: linear-gradient(105deg, rgba(71, 211, 162, 0.13), rgba(18, 140, 106, 0.04));
  color: #185f4d;
}

.template-channel-tab--telegram {
  background: linear-gradient(105deg, rgba(91, 184, 245, 0.13), rgba(36, 139, 214, 0.04));
  color: #245b7d;
}

.template-channel-tab--gmail {
  background: linear-gradient(105deg, rgba(242, 130, 126, 0.12), rgba(217, 81, 78, 0.035));
  color: #87413f;
}

.template-channel-tab--whatsapp.q-tab--active {
  border-color: rgba(18, 140, 106, 0.16);
  background: linear-gradient(105deg, rgba(71, 211, 162, 0.26), rgba(18, 140, 106, 0.1));
  color: #086146;
}

.template-channel-tab--telegram.q-tab--active {
  border-color: rgba(36, 139, 214, 0.16);
  background: linear-gradient(105deg, rgba(91, 184, 245, 0.24), rgba(36, 139, 214, 0.09));
  color: #11669d;
}

.template-channel-tab--gmail.q-tab--active {
  border-color: rgba(217, 81, 78, 0.15);
  background: linear-gradient(105deg, rgba(242, 130, 126, 0.23), rgba(217, 81, 78, 0.08));
  color: #a93431;
}

.template-channel-tab.q-tab--active {
  opacity: 1;
  font-weight: 750;
}

.template-sets-panel {
  overflow: hidden;
}

.template-sets-heading,
.template-library-heading,
.template-set-dialog__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.template-sets-heading,
.template-library-heading {
  margin-bottom: 18px;
}

.template-sets-heading h2,
.template-library-heading h2,
.template-set-dialog__header h2 {
  margin: 0;
}

.template-sets-heading p,
.template-library-heading p,
.template-set-dialog__header p {
  margin: 4px 0 0;
  color: #637875;
}

.template-set-filters {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(220px, 0.65fr);
  gap: 12px;
  margin-bottom: 14px;
}

.template-set-name {
  display: grid;
  min-width: 240px;
  grid-template-columns: 42px minmax(0, 1fr);
  align-items: center;
  gap: 11px;
}

.template-set-name > div {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.template-set-name strong,
.template-set-name span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-set-name span {
  max-width: 420px;
  color: #667a77;
  font-size: 0.76rem;
}

.template-set-icon,
.template-set-channel-card header > span {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 13px;
  background: rgba(130, 248, 230, 0.22);
  color: #137d6c;
}

.template-set-channel-card--whatsapp {
  border-color: rgba(18, 140, 106, 0.17);
  background: linear-gradient(145deg, rgba(71, 211, 162, 0.1), rgba(255, 255, 255, 0.96));
}

.template-set-channel-card--telegram {
  border-color: rgba(36, 139, 214, 0.17);
  background: linear-gradient(145deg, rgba(91, 184, 245, 0.1), rgba(255, 255, 255, 0.96));
}

.template-set-channel-card--gmail {
  border-color: rgba(217, 81, 78, 0.16);
  background: linear-gradient(145deg, rgba(242, 130, 126, 0.1), rgba(255, 255, 255, 0.96));
}

.template-set-channel-card--whatsapp header > span {
  background: rgba(71, 211, 162, 0.17);
  color: #128c6a;
}

.template-set-channel-card--telegram header > span {
  background: rgba(91, 184, 245, 0.17);
  color: #248bd6;
}

.template-set-channel-card--gmail header > span {
  background: rgba(242, 130, 126, 0.16);
  color: #d9514e;
}

.template-set-channel-list {
  display: flex;
  min-width: 280px;
  flex-wrap: wrap;
  gap: 4px;
}

.template-channel-chip {
  border-color: currentColor !important;
  font-weight: 650;
}

.template-channel-chip--whatsapp {
  background: rgba(71, 211, 162, 0.08) !important;
  color: #128c6a;
}

.template-channel-chip--telegram {
  background: rgba(91, 184, 245, 0.09) !important;
  color: #248bd6;
}

.template-channel-chip--gmail {
  background: rgba(242, 130, 126, 0.08) !important;
  color: #d9514e;
}

.template-set-dialog,
.template-link-dialog {
  display: flex;
  flex-direction: column;
  width: min(920px, calc(100vw - 40px));
  max-width: 920px;
  max-height: min(820px, calc(100dvh - 32px));
  overflow: hidden;
  border-radius: 22px;
  background: #f9fffd;
}

.template-link-dialog {
  width: min(680px, calc(100vw - 40px));
}

.template-set-dialog__header,
.template-set-dialog__actions {
  flex: 0 0 auto;
  padding: 18px 22px;
}

.template-set-dialog > .q-form {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.template-set-dialog__content,
.template-link-dialog__content {
  flex: 1 1 auto;
  min-height: 0;
  padding: 20px 22px;
}

.template-set-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.template-set-form .full-span {
  grid-column: 1 / -1;
}

.template-set-channel-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 18px;
}

.template-set-channel-card {
  min-width: 0;
  padding: 14px;
  border: 1px solid rgba(11, 92, 79, 0.13);
  border-radius: 16px;
  background: #fff;
}

.template-set-channel-card header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 13px;
}

.template-set-channel-card header > div {
  display: grid;
}

.template-set-channel-card small {
  color: #6b7d7a;
}

.template-name {
  display: grid;
  min-width: 240px;
  grid-template-columns: 44px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}

.template-icon {
  display: grid;
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  align-items: center;
  justify-items: center;
  border-radius: 13px;
  background: rgba(130, 248, 230, 0.22);
  color: #137d6c;
  line-height: 1;
  place-items: center;
}

.template-icon :deep(.q-icon) {
  width: 22px;
  height: 22px;
  font-size: 22px !important;
  line-height: 1;
}

.template-icon--whatsapp {
  background: rgba(71, 211, 162, 0.17);
  color: #128c6a;
}

.template-icon--telegram {
  background: rgba(91, 184, 245, 0.17);
  color: #248bd6;
}

.template-icon--gmail {
  background: rgba(242, 130, 126, 0.16);
  color: #d9514e;
}

.template-icon--global,
.template-icon--neutral {
  background: rgba(130, 248, 230, 0.22);
  color: #137d6c;
}

.template-channel-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border-color: currentColor !important;
  border-radius: 999px;
  font-weight: 650;
}

.template-channel-badge--whatsapp {
  background: rgba(71, 211, 162, 0.08) !important;
  color: #128c6a;
}

.template-channel-badge--telegram {
  background: rgba(91, 184, 245, 0.09) !important;
  color: #248bd6;
}

.template-channel-badge--gmail {
  background: rgba(242, 130, 126, 0.08) !important;
  color: #d9514e;
}

.template-channel-badge--global,
.template-channel-badge--neutral {
  background: rgba(130, 248, 230, 0.1) !important;
  color: #137d6c;
}

.template-library-table :deep(.template-list-row) {
  transition: background 160ms ease, box-shadow 160ms ease;
}

.template-library-table :deep(.template-list-row--whatsapp) {
  background: linear-gradient(105deg, rgba(71, 211, 162, 0.13), rgba(18, 140, 106, 0.04));
  box-shadow: inset 3px 0 #128c6a;
}

.template-library-table :deep(.template-list-row--telegram) {
  background: linear-gradient(105deg, rgba(91, 184, 245, 0.13), rgba(36, 139, 214, 0.04));
  box-shadow: inset 3px 0 #248bd6;
}

.template-library-table :deep(.template-list-row--gmail) {
  background: linear-gradient(105deg, rgba(242, 130, 126, 0.12), rgba(217, 81, 78, 0.035));
  box-shadow: inset 3px 0 #d9514e;
}

.template-library-table :deep(.template-list-row--global),
.template-library-table :deep(.template-list-row--neutral) {
  background: linear-gradient(105deg, rgba(130, 248, 230, 0.1), rgba(19, 125, 108, 0.025));
  box-shadow: inset 3px 0 #6ba99d;
}

.template-library-table :deep(.template-list-row--whatsapp:hover) {
  background: linear-gradient(105deg, rgba(71, 211, 162, 0.2), rgba(18, 140, 106, 0.07));
}

.template-library-table :deep(.template-list-row--telegram:hover) {
  background: linear-gradient(105deg, rgba(91, 184, 245, 0.2), rgba(36, 139, 214, 0.07));
}

.template-library-table :deep(.template-list-row--gmail:hover) {
  background: linear-gradient(105deg, rgba(242, 130, 126, 0.19), rgba(217, 81, 78, 0.065));
}

.template-name__copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.template-name__copy strong,
.template-name__copy span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-name__copy strong {
  color: #173833;
  font-size: 0.9rem;
  line-height: 1.35;
}

.template-name__copy span {
  max-width: 430px;
  color: #667a77;
  font-size: 0.76rem;
  line-height: 1.35;
}

.template-dialog {
  display: flex;
  flex-direction: column;
  width: min(1280px, calc(100vw - 48px)) !important;
  max-width: 1280px !important;
  height: min(900px, calc(100dvh - 32px));
  max-height: calc(100dvh - 32px);
  overflow: hidden;
  border-radius: 24px;
  background: #f9fffd;
}

.template-dialog > .q-form {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.template-dialog__header,
.template-dialog__footer {
  flex: 0 0 auto;
  background: #f9fffd;
}

.template-dialog__footer {
  flex-wrap: wrap;
}

.dialog-subtitle {
  margin-top: 3px;
  color: #667a77;
  font-size: 0.86rem;
  line-height: 1.45;
}

.template-builder {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: minmax(570px, 1.35fr) minmax(340px, 0.65fr);
  gap: 28px;
  min-height: 0;
  max-height: none;
  overflow: auto;
  overscroll-behavior: contain;
}

.editor-column {
  display: grid;
  align-content: start;
  gap: 18px;
}

.builder-section {
  padding: 20px;
  border: 1px solid rgba(3, 21, 21, 0.09);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.66);
}

.cloud-builder-section {
  background: rgba(240, 252, 249, 0.8);
}

.section-heading {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 17px;
}

.section-heading > div {
  display: grid;
  gap: 3px;
}

.section-heading strong {
  color: #102d29;
  font-size: 1rem;
}

.section-heading span:not(.step-number) {
  color: #667a77;
  font-size: 0.84rem;
  line-height: 1.45;
}

.step-number,
.parameter-position {
  display: grid;
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: 50%;
  background: #27b79f;
  color: #fff;
  font-size: 0.83rem;
  font-weight: 800;
  place-items: center;
}

.template-field :deep(.q-field__control) {
  min-height: 60px;
  border-radius: 14px;
}

.template-field :deep(.q-field__label) {
  color: #506763;
  font-size: 0.96rem;
  font-weight: 650;
}

.template-field :deep(.q-field__native),
.template-field :deep(.q-field__input),
.template-field :deep(.q-field__marginal) {
  font-size: 1rem;
}

.template-field :deep(.q-field__bottom) {
  padding-top: 7px;
  font-size: 0.78rem;
}

.cloud-preset-select {
  margin-bottom: 16px;
}

.cloud-preset-option {
  min-height: 68px;
}

.official-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  gap: 14px;
}

.custom-official-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 190px;
  gap: 16px;
}

.custom-official-fields > .full-span {
  grid-column: 1 / -1;
}

.meta-approved-reminder {
  border: 1px solid rgba(22, 134, 111, 0.17);
  background: rgba(255, 255, 255, 0.74);
  color: #3d625c;
  font-size: 0.84rem;
}

.standard-marketing-builder {
  display: grid;
  gap: 14px;
}

.optional-component-picker {
  position: sticky;
  z-index: 4;
  top: 0;
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px dashed rgba(18, 104, 89, 0.25);
  border-radius: 16px;
  background: rgba(247, 255, 252, 0.98);
  box-shadow: 0 10px 24px rgba(18, 104, 89, 0.09);
  backdrop-filter: blur(10px);
}

.optional-component-picker > div:first-child {
  display: grid;
  gap: 3px;
}

.optional-component-picker strong {
  color: #183c35;
  font-size: 0.92rem;
}

.optional-component-picker span {
  color: #607872;
  font-size: 0.78rem;
  line-height: 1.45;
}

.optional-component-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.optional-components-empty {
  border: 1px solid rgba(31, 163, 136, 0.18);
  background: rgba(232, 251, 246, 0.76);
  color: #315f56;
}

.standard-field-card {
  padding: 16px;
  border: 1px solid rgba(18, 104, 89, 0.16);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.86);
}

.standard-field-card__header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  margin-bottom: 15px;
}

.standard-field-card__header > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.standard-field-card__header > .standard-field-card__actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.standard-field-card__header strong {
  color: #183c35;
  font-size: 0.92rem;
}

.standard-field-card__header span:not(.standard-field-card__icon) {
  color: #71837f;
  font-size: 0.76rem;
  line-height: 1.4;
}

.standard-field-card__icon {
  display: grid;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: #ddf7f0;
  color: #148672;
  font-size: 20px;
  place-items: center;
}

.standard-field-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.72fr) minmax(260px, 1.28fr);
  align-items: start;
  gap: 14px;
}

.standard-field-grid > .full-span {
  grid-column: 1 / -1;
}

.standard-field-grid--button {
  grid-template-columns: minmax(180px, 0.55fr) minmax(260px, 1.45fr);
}

.friendly-mode-picker {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 14px;
  padding: 12px 14px;
  border: 1px solid rgba(18, 104, 89, 0.12);
  border-radius: 14px;
  background: rgba(238, 252, 248, 0.72);
}

.friendly-mode-picker > div:first-child {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.friendly-mode-picker strong {
  color: #214a42;
  font-size: 0.84rem;
}

.friendly-mode-picker span {
  color: #6a7f7a;
  font-size: 0.75rem;
  line-height: 1.4;
}

.body-approved-text + .dynamic-field-grid,
.dynamic-field-grid {
  margin-top: 14px;
}

.dynamic-component-note {
  margin-top: 12px;
  border: 1px solid rgba(31, 163, 136, 0.16);
  background: rgba(231, 250, 246, 0.72);
  color: #315f56;
  font-size: 0.78rem;
}

.dynamic-url-result {
  display: flex;
  min-width: 0;
  min-height: 60px;
  align-items: center;
  gap: 10px;
  padding: 10px 13px;
  border: 1px dashed rgba(18, 104, 89, 0.24);
  border-radius: 14px;
  background: rgba(247, 255, 252, 0.86);
}

.dynamic-url-result > span {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.dynamic-url-result small {
  color: #71837f;
  font-size: 0.7rem;
}

.dynamic-url-result strong {
  overflow: hidden;
  color: #1d4c43;
  font-family: "Cascadia Code", Consolas, monospace;
  font-size: 0.76rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.forbidden-link-warning {
  margin-top: 12px;
  border: 1px solid rgba(194, 55, 75, 0.2);
  background: rgba(194, 55, 75, 0.07);
  color: #74333d;
  font-size: 0.78rem;
}

.official-fields :deep(.q-field--readonly .q-field__control) {
  background: rgba(255, 255, 255, 0.76);
}

.official-name-field :deep(.q-field__native) {
  font-family: "Cascadia Code", Consolas, monospace;
  font-size: 0.9rem;
}

.language-field :deep(.q-field__native) {
  font-weight: 750;
}

.parameter-list {
  display: grid;
  gap: 10px;
}

.custom-components {
  display: grid;
  gap: 16px;
}

.component-toolbar,
.component-card-header,
.parameters-heading,
.parameter-card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.component-toolbar {
  justify-content: space-between;
  color: #55716c;
  font-size: 0.84rem;
  font-weight: 700;
}

.component-card {
  padding: 16px;
  border: 1px solid rgba(18, 104, 89, 0.16);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.85);
}

.component-card-header {
  margin-bottom: 15px;
}

.component-card-header > div,
.parameters-heading > div {
  display: grid;
  gap: 2px;
}

.component-card-header strong,
.parameters-heading strong {
  color: #183c35;
  font-size: 0.92rem;
}

.component-card-header span:not(.component-order),
.parameters-heading span {
  color: #71837f;
  font-size: 0.76rem;
}

.component-order {
  display: grid;
  width: 31px;
  height: 31px;
  flex: none;
  border-radius: 9px;
  background: #1c8d79;
  color: #fff;
  font-weight: 800;
  place-items: center;
}

.component-fields,
.parameter-fields-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.parameter-fields-grid > .full-span {
  grid-column: 1 / -1;
}

.media-source-picker {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid rgba(22, 134, 111, 0.14);
  border-radius: 13px;
  background: rgba(39, 183, 159, 0.06);
}

.media-source-picker > div:first-child {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.media-source-picker strong {
  color: #183c35;
  font-size: 0.84rem;
}

.media-source-picker span {
  color: #637875;
  font-size: 0.74rem;
}

.media-link-field :deep(.q-field__native),
.media-upload-field :deep(.q-field__native) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.uploaded-media-meta {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
  margin-top: -4px;
  padding: 9px 11px;
  border-radius: 10px;
  background: rgba(30, 164, 108, 0.08);
  color: #32675c;
}

.uploaded-media-meta > span {
  display: grid;
  min-width: 0;
}

.uploaded-media-meta strong,
.uploaded-media-meta small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.uploaded-media-meta small {
  color: #6b827e;
}

.parameters-heading {
  margin: 17px 0 10px;
  padding-top: 14px;
  border-top: 1px solid rgba(3, 21, 21, 0.08);
}

.custom-parameter-list {
  display: grid;
  gap: 12px;
}

.custom-parameter-card {
  padding: 13px;
  border: 1px solid rgba(3, 21, 21, 0.08);
  border-radius: 13px;
  background: #f8fcfb;
}

.parameter-card-actions {
  min-height: 30px;
  margin-bottom: 10px;
}

.parameter-card-actions > span {
  padding: 4px 8px;
  border-radius: 8px;
  background: rgba(39, 183, 159, 0.12);
  color: #126f60;
  font-size: 0.75rem;
  font-weight: 800;
}

.no-component-parameters {
  padding: 13px;
  border: 1px dashed rgba(3, 21, 21, 0.13);
  border-radius: 12px;
  color: #71837f;
  font-size: 0.82rem;
  text-align: center;
}

.parameter-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 10px 13px;
  border: 1px solid rgba(3, 21, 21, 0.08);
  border-radius: 14px;
  background: #fff;
}

.parameter-position {
  width: 24px;
  height: 24px;
  background: rgba(39, 183, 159, 0.14);
  color: #137d6c;
}

.parameter-copy {
  display: grid;
  gap: 2px;
}

.parameter-copy strong {
  color: #173833;
  font-size: 0.92rem;
}

.parameter-copy span {
  color: #71837f;
  font-size: 0.78rem;
}

.parameter-row code {
  padding: 6px 9px;
  border-radius: 8px;
  background: #edf8f5;
  color: #116f61;
  font-size: 0.78rem;
}

.no-parameters-banner,
.automatic-payload-banner {
  border: 1px solid rgba(39, 183, 159, 0.18);
  background: rgba(39, 183, 159, 0.07);
  color: #385c56;
  font-size: 0.86rem;
}

.automatic-payload-banner strong {
  margin-right: 3px;
  color: #174c44;
}

.content-editor {
  margin-top: 18px;
}

.field-heading {
  margin-bottom: 9px;
  color: #193c36;
  font-size: 0.94rem;
  font-weight: 750;
}

.html-source-editor :deep(.html-source-editor__input) {
  min-height: 330px !important;
  overflow: auto !important;
  color: #173c36;
  font-family: "Cascadia Code", Consolas, "Courier New", monospace;
  font-size: 0.78rem;
  line-height: 1.55;
  white-space: pre;
}

.flattened-html-warning {
  margin-top: 12px;
  border: 1px solid rgba(194, 55, 75, 0.24);
  background: rgba(194, 55, 75, 0.07);
  color: #74333d;
  font-size: 0.78rem;
}

.flattened-html-warning strong {
  display: block;
}

.preview-column {
  position: sticky;
  top: 0;
  align-self: start;
  padding: 18px;
  border: 1px solid rgba(3, 21, 21, 0.08);
  border-radius: 18px;
  background: rgba(236, 249, 246, 0.72);
}

.preview-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 13px;
  font-size: 0.78rem;
  font-weight: 800;
  text-transform: uppercase;
}

.preview-label-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.preview-label-actions :deep(.q-btn) {
  font-size: 0.68rem;
}

.preview-email {
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 12px 35px rgba(3, 62, 55, 0.08);
  overflow: hidden;
}

.whatsapp-template-preview {
  padding-bottom: 16px;
  background-color: #efeae2;
  background-image: radial-gradient(rgba(25, 107, 92, 0.055) 1px, transparent 1px);
  background-size: 16px 16px;
}

.whatsapp-template-preview .preview-meta-header {
  background: rgba(255, 255, 255, 0.92);
}

.whatsapp-template-preview .preview-frame,
.whatsapp-template-preview .preview-media,
.whatsapp-template-preview .preview-media-error {
  width: calc(100% - 28px);
  margin-right: auto;
  margin-left: 14px;
  background: #fff;
}

.whatsapp-template-preview .preview-frame {
  padding: 2px 12px 10px;
  border-radius: 0 0 12px 12px;
  box-shadow: 0 5px 13px rgba(43, 55, 52, 0.12);
}

.whatsapp-template-preview--standard .preview-frame {
  border-radius: 0;
  box-shadow: none;
}

.whatsapp-preview-footer,
.whatsapp-preview-button {
  width: calc(100% - 28px);
  margin-right: auto;
  margin-left: 14px;
}

.whatsapp-preview-footer {
  padding: 0 12px 10px;
  border-radius: 0 0 12px 12px;
  background: #fff;
  box-shadow: 0 5px 13px rgba(43, 55, 52, 0.12);
  color: #86918e;
  font-size: 0.7rem;
}

.whatsapp-preview-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-top: 8px;
  padding: 11px 14px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 5px 13px rgba(43, 55, 52, 0.1);
  color: #0c8f7a;
  font-size: 0.82rem;
  font-weight: 750;
  text-align: center;
}

.whatsapp-template-preview .cloud-header-media {
  margin-top: 16px;
  padding-bottom: 0;
  border: 0;
  border-radius: 12px 12px 0 0;
}

.preview-subject {
  padding: 12px 18px;
  border-bottom: 1px solid rgba(3, 21, 21, 0.08);
  font-size: 0.83rem;
}

.preview-meta-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(3, 21, 21, 0.08);
  background: #f7fffd;
}

.preview-meta-header > div {
  display: grid;
  min-width: 0;
}

.preview-meta-header strong {
  font-size: 0.88rem;
}

.preview-meta-header span {
  overflow: hidden;
  color: #71837f;
  font-family: "Cascadia Code", Consolas, monospace;
  font-size: 0.7rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-frame {
  border: 0;
  border-radius: 0;
  overflow-wrap: anywhere;
}

.preview-frame :deep(img),
.preview-frame :deep(video) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 10px auto;
  border-radius: 10px;
}

.preview-frame :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
}

.preview-media {
  padding: 12px;
  border-bottom: 1px solid rgba(3, 21, 21, 0.08);
  background: #f5fbfa;
}

.preview-media img,
.preview-media video {
  display: block;
  width: 100%;
  max-height: 260px;
  border-radius: 12px;
  background: #e7f1ef;
  object-fit: contain;
}

.preview-media-error {
  margin: 12px;
  background: rgba(242, 169, 59, 0.12);
  color: #73551f;
  font-size: 0.76rem;
}

.preview-document {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding: 14px;
  border-radius: 10px;
  background: #edf3f2;
  color: #175f54;
  text-decoration: none;
}

.preview-document > span {
  display: grid;
  min-width: 0;
  flex: 1;
}

.preview-document strong,
.preview-document small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-document small {
  color: #6b7e7b;
}

.preview-payload-card {
  overflow: hidden;
  border: 1px solid rgba(3, 21, 21, 0.1);
  border-radius: 16px;
  background: #0f2522;
  box-shadow: 0 12px 35px rgba(3, 62, 55, 0.1);
}

.preview-payload-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  background: #f7fffd;
}

.preview-payload-heading > div {
  display: grid;
  gap: 2px;
}

.preview-payload-heading strong {
  color: #173c36;
  font-size: 0.82rem;
}

.preview-payload-heading span {
  color: #657b77;
  font-size: 0.7rem;
  font-weight: 500;
}

.preview-payload-card pre {
  max-height: 500px;
  margin: 0;
  padding: 16px;
  overflow: auto;
  color: #b9f6e8;
  font-family: "Cascadia Code", Consolas, monospace;
  font-size: 0.72rem;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.preview-warning {
  display: flex;
  gap: 8px;
  margin-top: 13px;
  color: #637875;
  font-size: 0.78rem;
  line-height: 1.45;
}

.cloud-preview-note {
  padding: 11px;
  border-radius: 11px;
  background: rgba(39, 183, 159, 0.08);
}

@media (max-width: 1050px) {
  .template-builder {
    grid-template-columns: minmax(0, 1fr) minmax(300px, 0.7fr);
  }
}

@media (max-width: 850px) {
  .template-set-channel-grid {
    grid-template-columns: 1fr;
  }

  .template-dialog {
    width: 100% !important;
    max-width: 100% !important;
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
  }

  .template-builder {
    grid-template-columns: 1fr;
    max-height: none;
  }

  .preview-column {
    position: static;
  }
}

@media (max-width: 600px) {
  .template-sets-heading,
  .template-library-heading,
  .template-set-dialog__header {
    align-items: stretch;
    flex-direction: column;
  }

  .template-set-filters,
  .template-set-form {
    grid-template-columns: 1fr;
  }

  .template-set-form .full-span {
    grid-column: auto;
  }

  .template-set-dialog,
  .template-link-dialog {
    width: 100%;
    max-width: 100%;
    max-height: 100dvh;
    border-radius: 0;
  }

  .template-set-dialog__actions {
    padding-bottom: max(14px, env(safe-area-inset-bottom));
  }

  .template-name {
    min-width: 210px;
    grid-template-columns: 42px minmax(0, 1fr);
    gap: 10px;
  }

  .template-icon {
    width: 42px;
    height: 42px;
    min-width: 42px;
    min-height: 42px;
  }

  .template-library-table :deep(.q-table__middle) {
    overscroll-behavior-x: contain;
    scrollbar-width: thin;
  }

  .template-channel-badge {
    max-width: 132px;
    white-space: nowrap;
  }

  .template-dialog__header,
  .template-builder {
    padding-right: 16px;
    padding-left: 16px;
  }

  .template-dialog__footer {
    padding-right: 16px;
    padding-bottom: max(12px, env(safe-area-inset-bottom));
    padding-left: 16px;
  }

  .builder-section {
    padding: 16px;
  }

  .official-fields {
    grid-template-columns: 1fr;
  }

  .custom-official-fields,
  .standard-field-grid,
  .standard-field-grid--button,
  .component-fields,
  .parameter-fields-grid {
    grid-template-columns: 1fr;
  }

  .custom-official-fields > .full-span {
    grid-column: auto;
  }

  .standard-field-grid > .full-span {
    grid-column: auto;
  }

  .optional-component-actions {
    display: flex;
    overflow-x: auto;
    flex-wrap: nowrap;
    padding-bottom: 3px;
    scrollbar-width: thin;
  }

  .optional-component-actions :deep(.q-btn) {
    width: auto;
    flex: 0 0 auto;
  }

  .optional-component-picker {
    margin-right: -4px;
    margin-left: -4px;
    padding: 12px;
  }

  .component-card-header {
    flex-wrap: wrap;
  }

  .media-source-picker,
  .friendly-mode-picker,
  .preview-label {
    align-items: stretch;
    flex-direction: column;
  }

  .media-source-picker :deep(.q-btn-group),
  .friendly-mode-picker :deep(.q-btn-group),
  .preview-label-actions :deep(.q-btn-group) {
    width: 100%;
  }

  .media-source-picker :deep(.q-btn),
  .friendly-mode-picker :deep(.q-btn),
  .preview-label-actions :deep(.q-btn) {
    flex: 1;
  }

  .preview-label-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .parameter-row {
    grid-template-columns: 24px minmax(0, 1fr);
  }

  .parameter-row code {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
