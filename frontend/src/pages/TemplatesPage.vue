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
  label: 'Outro template oficial',
  description: 'Cadastre pelo nome exato aprovado na Meta e monte os campos sem escrever JSON.',
  templateName: '',
  languageCode: 'pt_BR',
  preview: 'Preencha a descrição e os campos do template oficial.',
  parameters: Object.freeze([]),
})

export const SYSTEM_WHATSAPP_TEMPLATE_NAMES = Object.freeze([
  'verify_code_1',
  'jaspers_market_plain_text_v1',
  'jaspers_market_order_confirmation_v1',
])

export function isSystemTemplateRecord(template = {}) {
  if (template.systemManaged === true || template.deletable === false) return true
  return normalizedTemplateChannel(template.channel || template.type) === 'whatsapp_cloud'
    && SYSTEM_WHATSAPP_TEMPLATE_NAMES.includes(String(template.externalTemplateName || '').trim())
}

function normalizedTemplateChannel(value = '') {
  const key = String(value).toLowerCase().replaceAll('-', '_')
  if (['whatsappcloud', 'meta', 'whatsapp_official'].includes(key)) return 'whatsapp_cloud'
  return key
}

export const META_COMPONENT_OPTIONS = Object.freeze([
  Object.freeze({ label: 'Cabeçalho', value: 'header' }),
  Object.freeze({ label: 'Corpo', value: 'body' }),
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
  return {
    id: overrides.id || nextCloudBuilderId('parameter'),
    type: overrides.type || 'text',
    key: overrides.key || '',
    parameterName: overrides.parameterName || overrides.parameter_name || '',
    label: overrides.label || '',
    example: overrides.example || '',
    currencyCode: overrides.currencyCode || 'BRL',
    filename: overrides.filename || '',
  }
}

export function createCloudComponent(overrides = {}) {
  return {
    id: overrides.id || nextCloudBuilderId('component'),
    type: overrides.type || 'body',
    subType: overrides.subType || 'url',
    index: String(overrides.index ?? 0),
    parameters: (overrides.parameters || []).map((parameter) => createCloudParameter(parameter)),
  }
}

export function buildCustomWhatsAppCloudDefinition(input) {
  const builderComponents = (input.components || []).map((component, componentIndex) => ({
    id: component.id,
    type: component.type,
    ...(component.type === 'button' ? {
      subType: component.subType,
      index: String(component.index ?? 0),
    } : {}),
    parameters: (component.parameters || []).map((parameter, parameterIndex) => ({
      id: parameter.id,
      type: parameter.type,
      key: normalizeCloudVariableKey(parameter.key || parameter.label, `campo_${componentIndex + 1}_${parameterIndex + 1}`),
      parameterName: String(parameter.parameterName || '').trim() || undefined,
      label: String(parameter.label || `Campo ${parameterIndex + 1}`).trim(),
      example: String(parameter.example || '').trim(),
      currencyCode: parameter.type === 'currency' ? String(parameter.currencyCode || 'BRL').toUpperCase() : undefined,
      filename: parameter.type === 'document' ? String(parameter.filename || '').trim() || undefined : undefined,
    })),
  }))
  const variables = [...new Set(builderComponents.flatMap((component) => component.parameters.map((parameter) => parameter.key)))]

  return {
    whatsappCloudPreset: 'custom',
    templateType: 'approved_template',
    externalTemplateName: String(input.templateName || '').trim(),
    languageCode: String(input.languageCode || 'pt_BR').trim(),
    description: String(input.description || '').trim(),
    body: String(input.description || input.templateName || '').trim(),
    variables,
    payload: {
      builder: { version: 1, components: builderComponents },
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
      example: '',
      currencyCode: parameter.currency?.code || 'BRL',
      filename: parameter.document?.filename || '',
    })),
  }))
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

export function renderWhatsAppCloudPreview(value) {
  const preset = findWhatsAppCloudPreset(value)
  return preset.parameters.reduce(
    (preview, parameter) => preview.replaceAll(`{{${parameter.key}}}`, parameter.example),
    preset.preview,
  )
}
</script>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import DOMPurify from 'dompurify'
import { useQuasar } from 'quasar'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import TelegramTemplateBuilder from '../components/TelegramTemplateBuilder.vue'
import { errorMessage, fetchAll, http } from '../services/http.js'
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
const tab = ref('all')
const search = ref('')
const editingId = ref(null)
const templates = ref([])

const channelOptions = [
  { label: 'Telegram', value: 'telegram', icon: 'send_to_mobile' },
  { label: 'WhatsApp Cloud', value: 'whatsapp_cloud', icon: 'cloud_sync' },
  { label: 'Email', value: 'email', icon: 'mail' },
]

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
  cloudPreset: 'order_confirmation',
  cloudComponents: [],
  variablesText: '',
  metadata: { approvedName: '', language: 'pt_BR' },
  telegramDefinition: createTelegramDefinition('text'),
})
const form = reactive(emptyForm())
const selectedCloudPreset = computed(() => findWhatsAppCloudPreset(form.cloudPreset))
const isCustomCloudTemplate = computed(() => form.channel === 'whatsapp_cloud' && form.cloudPreset === 'custom')
const cloudPreviewText = computed(() => (
  isCustomCloudTemplate.value
    ? form.description || form.metadata.approvedName || 'Descreva o conteúdo aprovado na Meta.'
    : renderWhatsAppCloudPreview(form.cloudPreset)
))

const columns = [
  { name: 'name', label: 'Template', field: 'name', align: 'left', sortable: true },
  { name: 'channel', label: 'Canal', field: 'channel', align: 'left', sortable: true },
  { name: 'format', label: 'Formato', field: 'format', align: 'left' },
  { name: 'updatedAt', label: 'Atualizado', field: 'updatedAt', align: 'left', sortable: true },
  { name: 'actions', label: '', field: 'actions', align: 'right' },
]

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
    return DOMPurify.sanitize(`<p>${cloudPreviewText.value}</p>`)
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

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
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

function openCreate(channel = tab.value) {
  editingId.value = null
  Object.assign(form, emptyForm(), { channel: channel === 'all' ? 'telegram' : channel })
  if (form.channel === 'email') form.format = 'html'
  if (form.channel === 'telegram') form.format = 'telegram_text'
  if (form.channel === 'whatsapp_cloud') applyCloudPreset('order_confirmation', { suggestName: true })
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
    form.body = preset.preview
    form.variablesText = ''
    form.cloudComponents = []
    if (canSuggestName) form.name = preset.label
    return
  }
  form.metadata.approvedName = preset.templateName
  form.metadata.language = preset.languageCode
  form.body = preset.preview
  form.variablesText = preset.parameters.map((parameter) => parameter.key).join(', ')
  if (canSuggestName) form.name = preset.label
}

function onChannelChange(value) {
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
    applyCloudPreset(form.cloudPreset || 'order_confirmation', { suggestName: !editingId.value })
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
  form.cloudComponents.splice(index, 1)
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
  const usedKeys = new Set(form.cloudComponents.flatMap((item) => item.parameters.map((parameter) => parameter.key)))
  let position = usedKeys.size + 1
  while (usedKeys.has(`campo_${position}`)) position += 1
  component.parameters.push(createCloudParameter({
    type: component.type === 'button' && component.subType === 'copy_code'
      ? 'coupon_code'
      : component.type === 'button' && component.subType === 'quick_reply'
        ? 'payload'
        : 'text',
    key: `campo_${position}`,
    label: `Campo ${position}`,
    example: '',
  }))
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
    if (!allowed.has(parameter.type)) parameter.type = fallbackType
  }
}

function onCloudButtonSubTypeChange(component) {
  onCloudComponentTypeChange(component)
}

function removeCloudParameter(component, index) {
  component.parameters.splice(index, 1)
}

function customCloudValidationError() {
  if (!form.metadata.approvedName.trim()) return 'Informe o nome exato aprovado na Meta.'
  if (!/^[a-z0-9_]{1,512}$/.test(form.metadata.approvedName.trim())) return 'O nome Meta aceita somente letras minúsculas, números e sublinhado.'
  if (!form.metadata.language.trim()) return 'Informe o idioma aprovado na Meta.'
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(form.metadata.language.trim())) return 'Use um idioma Meta válido, como pt_BR ou en_US.'
  const parameters = form.cloudComponents.flatMap((component) => component.parameters)
  if (form.cloudComponents.filter((component) => component.type === 'header').length > 1) return 'Use no máximo um componente de cabeçalho.'
  if (form.cloudComponents.filter((component) => component.type === 'body').length > 1) return 'Use no máximo um componente de corpo.'
  if (form.cloudComponents.some((component) => ['header', 'button'].includes(component.type) && component.parameters.length > 1)) return 'Cabeçalhos e botões aceitam somente um parâmetro por componente.'
  const buttonIndexes = form.cloudComponents.filter((component) => component.type === 'button').map((component) => String(component.index))
  if (new Set(buttonIndexes).size !== buttonIndexes.length) return 'Cada botão deve usar um índice diferente.'
  const keys = parameters.map((parameter, index) => normalizeCloudVariableKey(parameter.key || parameter.label, `campo_${index + 1}`))
  if (keys.some((key) => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))) return 'As variáveis devem começar com letra e ter no máximo 64 caracteres.'
  if (form.cloudComponents.some((component) => {
    const componentKeys = component.parameters.map((parameter, index) => normalizeCloudVariableKey(parameter.key || parameter.label, `campo_${index + 1}`))
    return new Set(componentKeys).size !== componentKeys.length
  })) return 'Cada parâmetro do mesmo componente deve usar uma variável diferente.'
  if (parameters.some((parameter) => !String(parameter.label || '').trim())) return 'Informe um rótulo para cada parâmetro.'
  for (const component of form.cloudComponents) {
    const metaNames = component.parameters.map((parameter) => String(parameter.parameterName || '').trim())
    if (component.type === 'button' && metaNames.some(Boolean)) return 'Botões usam parâmetros posicionais; remova o nome Meta do botão.'
    if (metaNames.some((name) => name && !/^[a-z][a-z0-9_]{0,63}$/.test(name))) return 'O nome do parâmetro na Meta aceita letras minúsculas, números e sublinhado.'
    if (metaNames.some(Boolean) && !metaNames.every(Boolean)) return 'Em cada componente, use todos os parâmetros nomeados ou todos posicionais.'
  }
  if (parameters.some((parameter) => parameter.type === 'currency' && !/^[A-Za-z]{3}$/.test(parameter.currencyCode || ''))) return 'Parâmetros de moeda exigem um código ISO de três letras, como BRL.'
  if (form.cloudComponents.some((component) => component.type === 'button' && !/^[0-9]$/.test(String(component.index)))) return 'O índice de cada botão deve estar entre 0 e 9.'
  return null
}

function openEdit(template) {
  const channel = normalizedChannel(template.channel || template.type)
  if (channel === 'global') {
    $q.notify({ type: 'info', message: 'Templates globais antigos ficam disponíveis apenas para consulta. Crie um template separado por canal.' })
    return
  }
  editingId.value = recordId(template)
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
    cloudComponents: channel === 'whatsapp_cloud' && cloudPreset === 'custom' ? cloudBuilderFromTemplate(template) : [],
    variablesText: Array.isArray(variables) ? variables.join(', ') : String(variables || ''),
    metadata: {
      approvedName: template.externalTemplateName || metadata.approvedName || template.approvedName || '',
      language: template.languageCode || metadata.language || template.language || 'pt_BR',
    },
    telegramDefinition: channel === 'telegram' ? telegramDefinitionFromTemplate(template) : createTelegramDefinition('text'),
  })
  if (channel === 'whatsapp_cloud' && cloudPreset !== 'custom') applyCloudPreset(cloudPreset)
  dialog.value = true
}

async function save() {
  saving.value = true
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
  const payload = {
    name: form.name,
    channel: form.channel,
    templateType: cloudDefinition?.templateType || (telegramDefinition ? `telegram_${telegramDefinition.kind}` : form.format),
    format: cloudDefinition?.templateType || (telegramDefinition ? `telegram_${telegramDefinition.kind}` : form.format),
    subject: form.channel === 'email' ? form.subject || undefined : undefined,
    description: cloudDefinition?.description || form.description || undefined,
    body: cloudDefinition?.body || (telegramDefinition ? telegramDefinitionBody(telegramDefinition) : form.body),
    html: form.channel === 'email' && form.format === 'html' ? form.body : undefined,
    variables: cloudDefinition?.variables || (telegramDefinition ? telegramVariables(telegramDefinition) : form.variablesText.split(',').map((item) => item.trim()).filter(Boolean)),
    payload: cloudDefinition?.payload || (telegramDefinition ? { telegram: telegramDefinition } : null),
    whatsappCloudPreset: cloudDefinition?.whatsappCloudPreset,
    externalTemplateName: cloudDefinition?.externalTemplateName,
    languageCode: cloudDefinition?.languageCode,
  }
  try {
    if (editingId.value) await http.put(`/templates/${editingId.value}`, payload)
    else await http.post('/templates', payload)
    dialog.value = false
    $q.notify({ type: 'positive', message: 'Template salvo com sucesso.' })
    await loadTemplates()
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error) })
  } finally {
    saving.value = false
  }
}

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

onMounted(loadTemplates)
</script>

<template>
  <q-page class="page-container">
    <PageHeader
      eyebrow="Biblioteca de conteúdo"
      title="Templates por canal"
      description="Modele cada payload de acordo com as capacidades e políticas do canal de destino."
      icon="dashboard_customize"
    >
      <template #actions>
        <q-btn color="primary" unelevated no-caps icon="add" label="Novo template" @click="openCreate()" />
      </template>
    </PageHeader>

    <q-card flat class="glass-card section-card">
      <div class="toolbar-row">
        <q-tabs v-model="tab" dense no-caps outside-arrows mobile-arrows active-color="primary" indicator-color="transparent">
          <q-tab name="all" icon="view_list" label="Todos" />
          <q-tab v-for="channel in channelOptions" :key="channel.value" :name="channel.value" :icon="channel.icon" :label="channel.label" />
        </q-tabs>
        <q-input v-model="search" dense outlined clearable placeholder="Buscar template" class="search-field">
          <template #prepend><q-icon name="search" /></template>
        </q-input>
      </div>

      <EmptyState v-if="!loading && !filteredTemplates.length" icon="note_add" title="Nenhum template neste filtro" description="Crie uma mensagem reutilizável para começar.">
        <q-btn color="primary" unelevated no-caps label="Criar template" @click="openCreate()" />
      </EmptyState>
      <q-table v-else flat :rows="filteredTemplates" :columns="columns" row-key="id" :loading="loading" :rows-per-page-options="[10, 25, 50]">
        <template #body-cell-name="props">
          <q-td :props="props">
            <div class="template-name">
              <span class="template-icon" aria-hidden="true">
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
        <template #body-cell-channel="props"><q-td :props="props"><q-badge outline color="primary" :label="channelLabel(props.row.channel || props.row.type)" /></q-td></template>
        <template #body-cell-format="props">
          <q-td :props="props">
            {{ (props.row.templateType || props.row.format || 'text') === 'approved_template' ? 'OFICIAL META' : (props.row.templateType || props.row.format || 'text').toUpperCase() }}
          </q-td>
        </template>
        <template #body-cell-updatedAt="props"><q-td :props="props">{{ formatDate(props.row.updatedAt) }}</q-td></template>
        <template #body-cell-actions="props">
          <q-td :props="props">
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

    <q-dialog v-model="dialog" persistent :maximized="$q.screen.lt.md">
      <q-card class="template-dialog">
        <q-card-section class="row items-center q-px-lg q-py-md template-dialog__header">
          <div>
            <div class="text-h6 text-weight-bold">{{ editingId ? 'Editar template' : 'Novo template' }}</div>
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
                    label="Canal de envio *"
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
                      <strong>Escolha o modelo oficial</strong>
                      <span>Use um dos três exemplos de teste ou cadastre outro template já aprovado na Meta.</span>
                    </div>
                  </div>

                  <q-select
                    v-model="form.cloudPreset"
                    outlined
                    stack-label
                    emit-value
                    map-options
                    :options="cloudPresetOptions"
                    label="Modelo aprovado pela Meta *"
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
                    <q-input
                      v-model.trim="form.metadata.language"
                      outlined
                      stack-label
                      label="Código do idioma *"
                      hint="Exemplo: pt_BR ou en_US"
                      class="template-field language-field"
                      :rules="[(value) => Boolean(value) || 'Informe o idioma']"
                    />
                    <q-input
                      v-model.trim="form.description"
                      outlined
                      stack-label
                      type="textarea"
                      autogrow
                      label="Descrição para o operador"
                      hint="Explique quando usar este template. A descrição aparecerá no disparo."
                      class="template-field full-span"
                    />
                    <q-banner rounded class="meta-approved-reminder full-span">
                      <template #avatar><q-icon name="info" color="primary" /></template>
                      O Notify App envia templates existentes; a criação e aprovação do conteúdo continuam no painel da Meta.
                    </q-banner>
                  </div>
                </section>

                <section class="builder-section cloud-builder-section">
                  <div class="section-heading">
                    <span class="step-number">2</span>
                    <div>
                      <strong>{{ isCustomCloudTemplate ? 'Componentes e parâmetros de envio' : 'Campos da notificação' }}</strong>
                      <span v-if="isCustomCloudTemplate">Represente os componentes aprovados na mesma ordem da Meta; o sistema monta o payload de envio.</span>
                      <span v-else-if="selectedCloudPreset.parameters.length">O usuário preencherá estes valores na tela de disparo.</span>
                      <span v-else>Este modelo não possui campos variáveis.</span>
                    </div>
                  </div>

                  <div v-if="isCustomCloudTemplate" class="custom-components">
                    <div class="component-toolbar">
                      <span>{{ form.cloudComponents.length }} componente(s)</span>
                      <q-btn outline color="primary" no-caps icon="add" label="Adicionar componente" @click="addCloudComponent" />
                    </div>

                    <q-banner v-if="!form.cloudComponents.length" rounded class="no-parameters-banner">
                      <template #avatar><q-icon name="view_agenda" color="primary" /></template>
                      Este template não envia componentes variáveis. Adicione somente se o modelo aprovado exigir parâmetros.
                    </q-banner>

                    <article v-for="(component, componentIndex) in form.cloudComponents" :key="component.id" class="component-card">
                      <header class="component-card-header">
                        <span class="component-order">{{ componentIndex + 1 }}</span>
                        <div><strong>Componente</strong><span>Ordem idêntica ao template aprovado</span></div>
                        <q-space />
                        <q-btn flat round dense icon="arrow_upward" :disable="componentIndex === 0" aria-label="Mover componente para cima" @click="moveItem(form.cloudComponents, componentIndex, -1)" />
                        <q-btn flat round dense icon="arrow_downward" :disable="componentIndex === form.cloudComponents.length - 1" aria-label="Mover componente para baixo" @click="moveItem(form.cloudComponents, componentIndex, 1)" />
                        <q-btn flat round dense color="negative" icon="delete" aria-label="Remover componente" @click="removeCloudComponent(componentIndex)" />
                      </header>

                      <div class="component-fields">
                        <q-select
                          v-model="component.type"
                          outlined
                          stack-label
                          emit-value
                          map-options
                          :options="META_COMPONENT_OPTIONS"
                          label="Tipo do componente *"
                          class="template-field"
                          @update:model-value="onCloudComponentTypeChange(component)"
                        />
                        <template v-if="component.type === 'button'">
                          <q-select
                            v-model="component.subType"
                            outlined
                            stack-label
                            emit-value
                            map-options
                            :options="[{ label: 'URL dinâmica', value: 'url' }, { label: 'Resposta rápida', value: 'quick_reply' }, { label: 'Copiar cupom', value: 'copy_code' }, { label: 'OTP - Copiar código', value: 'otp_copy_code' }]"
                            label="Tipo do botão"
                            class="template-field"
                            @update:model-value="onCloudButtonSubTypeChange(component)"
                          />
                          <q-input v-model="component.index" outlined stack-label type="number" min="0" label="Índice do botão" class="template-field" />
                        </template>
                      </div>

                      <div class="parameters-heading">
                        <div><strong>Parâmetros</strong><span>Valores que serão solicitados no disparo.</span></div>
                        <q-btn flat color="primary" no-caps icon="add" label="Adicionar parâmetro" @click="addCloudParameter(component)" />
                      </div>

                      <div v-if="component.parameters.length" class="custom-parameter-list">
                        <div v-for="(parameter, parameterIndex) in component.parameters" :key="parameter.id" class="custom-parameter-card">
                          <div class="parameter-card-actions">
                            <span>{{ componentIndex + 1 }}.{{ parameterIndex + 1 }}</span>
                            <q-space />
                            <q-btn flat round dense icon="arrow_upward" :disable="parameterIndex === 0" aria-label="Mover parâmetro para cima" @click="moveItem(component.parameters, parameterIndex, -1)" />
                            <q-btn flat round dense icon="arrow_downward" :disable="parameterIndex === component.parameters.length - 1" aria-label="Mover parâmetro para baixo" @click="moveItem(component.parameters, parameterIndex, 1)" />
                            <q-btn flat round dense color="negative" icon="close" aria-label="Remover parâmetro" @click="removeCloudParameter(component, parameterIndex)" />
                          </div>
                          <div class="parameter-fields-grid">
                            <q-select v-model="parameter.type" outlined stack-label emit-value map-options :options="parameterOptionsFor(component)" label="Tipo Meta *" class="template-field" />
                            <q-input v-model.trim="parameter.key" outlined stack-label maxlength="64" label="Variável interna *" hint="Exemplo: nome_cliente" class="template-field" @blur="parameter.key = normalizeCloudVariableKey(parameter.key)" />
                            <q-input v-if="component.type !== 'button'" v-model.trim="parameter.parameterName" outlined stack-label maxlength="64" label="Nome do parâmetro na Meta" hint="Opcional. Preencha se o modelo usa {{nome_cliente}} em vez de {{1}}" class="template-field" />
                            <q-input v-model.trim="parameter.label" outlined stack-label label="Rótulo no disparo *" hint="Exemplo: Nome do cliente" class="template-field" />
                            <q-input v-model.trim="parameter.example" outlined stack-label label="Valor de exemplo" hint="Ajuda quem fará o envio" class="template-field" />
                            <template v-if="parameter.type === 'currency'">
                              <q-input v-model.trim="parameter.currencyCode" outlined stack-label maxlength="3" label="Código da moeda" hint="Exemplo: BRL" class="template-field" />
                            </template>
                            <q-input v-if="parameter.type === 'document'" v-model.trim="parameter.filename" outlined stack-label label="Nome do arquivo" hint="Opcional: comprovante.pdf" class="template-field" />
                          </div>
                        </div>
                      </div>
                      <div v-else class="no-component-parameters">Nenhum parâmetro neste componente.</div>
                    </article>
                  </div>

                  <div v-else-if="selectedCloudPreset.parameters.length" class="parameter-list">
                    <div v-for="parameter in selectedCloudPreset.parameters" :key="parameter.key" class="parameter-row">
                      <span class="parameter-position">{{ parameter.position }}</span>
                      <div class="parameter-copy">
                        <strong>{{ parameter.label }}</strong>
                        <span>Exemplo da Meta: {{ parameter.example }}</span>
                      </div>
                      <code>{{ parameter.key }}</code>
                    </div>
                  </div>
                  <q-banner v-else rounded class="no-parameters-banner">
                    <template #avatar><q-icon name="check_circle" color="primary" /></template>
                    Pronto para usar: nenhum parâmetro precisa ser configurado.
                  </q-banner>
                </section>

                <q-banner rounded class="automatic-payload-banner">
                  <template #avatar><q-icon name="auto_awesome" color="primary" /></template>
                  <strong>Sem configuração JSON.</strong>
                  O nome oficial, idioma e componentes são gerados automaticamente ao salvar.
                </q-banner>
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
                    <q-editor v-if="form.channel === 'email' && form.format === 'html'" v-model="form.body" min-height="260px" :toolbar="[['bold', 'italic', 'underline'], ['quote', 'unordered', 'ordered'], ['link'], ['undo', 'redo']]" />
                    <q-input v-else v-model="form.body" outlined stack-label type="textarea" autogrow label="Mensagem" class="template-field" :rules="[(value) => Boolean(value) || 'Escreva a mensagem']" />
                  </div>
                </section>
              </template>
            </div>

            <aside class="preview-column">
              <div class="preview-label"><span>Prévia em tempo real</span><q-badge color="primary" :label="channelLabel(form.channel)" /></div>
              <div class="preview-email">
                <div v-if="form.channel === 'email'" class="preview-subject"><strong>Assunto:</strong> {{ form.subject || 'Sem assunto' }}</div>
                <div v-if="form.channel === 'whatsapp_cloud'" class="preview-meta-header">
                  <q-icon name="verified" color="primary" />
                  <div>
                    <strong>{{ isCustomCloudTemplate ? form.name || 'Template oficial' : selectedCloudPreset.label }}</strong>
                    <span>{{ isCustomCloudTemplate ? form.metadata.approvedName || 'nome_exato_na_meta' : selectedCloudPreset.templateName }}</span>
                  </div>
                </div>
                <div class="preview-frame" v-html="safePreview" />
              </div>
              <div class="preview-warning" :class="{ 'cloud-preview-note': form.channel === 'whatsapp_cloud' }">
                <q-icon :name="form.channel === 'whatsapp_cloud' ? 'info' : 'security'" color="primary" />
                <span v-if="form.channel === 'whatsapp_cloud'">A Meta controla o texto e o layout final. Esta prévia mostra apenas a posição dos valores do disparo.</span>
                <span v-else-if="form.channel === 'telegram'">Somente texto simples é exibido; menus usam botões inline e mídias são validadas pelo servidor.</span>
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
  margin-bottom: 13px;
  font-size: 0.78rem;
  font-weight: 800;
  text-transform: uppercase;
}

.preview-email {
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 12px 35px rgba(3, 62, 55, 0.08);
  overflow: hidden;
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
  .component-fields,
  .parameter-fields-grid {
    grid-template-columns: 1fr;
  }

  .custom-official-fields > .full-span {
    grid-column: auto;
  }

  .component-card-header {
    flex-wrap: wrap;
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
