<script>
export const WHATSAPP_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000

const BUILTIN_WHATSAPP_FIXED_VALUES = Object.freeze({
  order_confirmation: Object.freeze({
    customerName: 'John Doe',
    orderNumber: '123456',
    orderDate: 'Jul 20, 2026',
  }),
})

function cloudTemplatePreset(template = {}) {
  if (template.whatsappCloudPreset) return template.whatsappCloudPreset
  if (template.externalTemplateName === 'jaspers_market_order_confirmation_v1') return 'order_confirmation'
  if (template.externalTemplateName === 'jaspers_market_plain_text_v1') return 'plain_text'
  return null
}

function timestampOf(value) {
  if (!value) return 0
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const numeric = Number(value)
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric
  }
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

export function cloudConversationId(conversation) {
  return String(conversation?.id || conversation?._id || '')
}

export function cloudMessageTime(message = {}) {
  return timestampOf(message.sentAt || message.timestamp || message.createdAt)
}

export function mergeCloudMessages(items = []) {
  const merged = new Map()
  for (const item of items) {
    const providerId = item.providerMessageId || item.messageId || item.id || item._id
    const key = providerId
      ? `provider:${providerId}`
      : `fallback:${item.direction || 'inbound'}:${cloudMessageTime(item)}:${item.text || item.body || ''}`
    const previous = merged.get(key)
    merged.set(key, previous ? { ...previous, ...item } : item)
  }
  return [...merged.values()].sort((left, right) => cloudMessageTime(left) - cloudMessageTime(right))
}

export function upsertCloudConversation(current = [], conversation = {}) {
  const id = cloudConversationId(conversation)
  if (!id) return current
  const previous = current.find((item) => cloudConversationId(item) === id)
  const next = previous ? { ...previous, ...conversation } : conversation
  return [next, ...current.filter((item) => cloudConversationId(item) !== id)]
    .sort((left, right) => {
      const leftTime = timestampOf(left.lastMessageAt || left.updatedAt)
      const rightTime = timestampOf(right.lastMessageAt || right.updatedAt)
      return rightTime - leftTime
    })
}

export function serviceWindowOf(conversation = {}, now = Date.now()) {
  const serviceWindow = conversation.serviceWindow || {}
  const lastInboundAt = serviceWindow.lastInboundAt || conversation.lastInboundAt || null
  const explicitExpiry = serviceWindow.expiresAt
    || conversation.serviceWindowExpiresAt
    || conversation.windowExpiresAt
  const lastInboundTime = timestampOf(lastInboundAt)
  const expiresAtTime = timestampOf(explicitExpiry)
    || (lastInboundTime ? lastInboundTime + WHATSAPP_SERVICE_WINDOW_MS : 0)
  const remainingSeconds = expiresAtTime
    ? Math.max(0, Math.ceil((expiresAtTime - now) / 1000))
    : 0

  return {
    open: Boolean(expiresAtTime && remainingSeconds > 0),
    lastInboundAt,
    expiresAt: expiresAtTime ? new Date(expiresAtTime).toISOString() : null,
    remainingSeconds,
  }
}

export function formatServiceWindow(conversation, now = Date.now()) {
  const { open, remainingSeconds } = serviceWindowOf(conversation, now)
  if (!open) return 'Janela encerrada'
  const hours = Math.floor(remainingSeconds / 3600)
  const minutes = Math.floor((remainingSeconds % 3600) / 60)
  const seconds = remainingSeconds % 60
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

export function cloudConsentOf(conversation = {}) {
  const consent = conversation.consent || {}
  const status = String(consent.status || conversation.consentStatus || '').toLowerCase()
  const authorized = Boolean(
    consent.authorized
    ?? conversation.notificationAuthorized
    ?? ['granted', 'authorized', 'active'].includes(status),
  )
  return {
    authorized,
    status: status || (authorized ? 'granted' : 'unknown'),
    source: String(consent.source || conversation.consentSource || ''),
    command: String(consent.command || conversation.permissionCommand || '/notify-me'),
  }
}

export function cloudConsentSourceLabel(consent = {}) {
  const source = String(consent.source || '').toLowerCase()
  if (!source) return consent.authorized ? 'Origem não informada' : 'Aguardando autorização'
  if (source.includes('command') || source.includes('webhook')) return `Comando ${consent.command || '/notify-me'}`
  if (source.includes('profile')) return 'Meu Perfil'
  if (source.includes('admin')) return 'Administrador'
  if (source.includes('invite')) return 'Página de convite'
  return consent.source
}

export function canSendCloudServiceMessage(conversation, now = Date.now()) {
  return Boolean(conversation && serviceWindowOf(conversation, now).open)
}

export function cloudChatTemplateParameters(template = {}) {
  const builderComponents = template.payload?.builder?.components
  if (Array.isArray(builderComponents)) {
    return builderComponents.flatMap((component, componentIndex) => (
      (component.parameters || []).map((parameter, parameterIndex) => {
        const normalized = {
          key: parameter.key || `campo_${componentIndex + 1}_${parameterIndex + 1}`,
          label: parameter.label || parameter.parameterName || `Campo ${parameterIndex + 1}`,
          type: parameter.type || 'text',
          componentType: component.type || 'body',
          fixedValue: parameter.fixedValue ?? '',
        }
        if (parameter.parameterName) normalized.parameterName = parameter.parameterName
        if (parameter.example) normalized.example = parameter.example
        if (parameter.filename) normalized.filename = parameter.filename
        if (parameter.mediaSource) normalized.mediaSource = parameter.mediaSource
        if (parameter.mediaAssetId) normalized.mediaAssetId = parameter.mediaAssetId
        if (parameter.mimeType) normalized.mimeType = parameter.mimeType
        if (parameter.uploadedFilename) normalized.uploadedFilename = parameter.uploadedFilename
        return normalized
      })
    ))
  }
  const presetValues = BUILTIN_WHATSAPP_FIXED_VALUES[cloudTemplatePreset(template)] || {}
  return (template.variables || []).map((key, index) => ({
    key,
    label: `Campo ${index + 1}`,
    type: 'text',
    componentType: 'body',
    fixedValue: presetValues[key] ?? '',
  }))
}

function meaningfulCloudTemplateValue(value) {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (typeof value === 'number') return Number.isFinite(value)
  return typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
}

export function cloudChatTemplateFixedVariables(template = {}) {
  return Object.fromEntries(cloudChatTemplateParameters(template)
    .filter((parameter) => meaningfulCloudTemplateValue(parameter.fixedValue))
    .map((parameter) => [parameter.key, parameter.fixedValue]))
}

function interpolateCloudTemplateText(value = '', variables = {}, parameters = []) {
  let output = String(value || '').replace(/{{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}/g, (placeholder, key) => {
    const replacement = variables[key]
    return meaningfulCloudTemplateValue(replacement) ? String(replacement) : placeholder
  })
  for (const [index, parameter] of parameters.entries()) {
    const replacement = variables[parameter.key] ?? parameter.fixedValue
    if (!meaningfulCloudTemplateValue(replacement)) continue
    const printable = typeof replacement === 'object'
      ? replacement.text || replacement.link || replacement.url || replacement.id || ''
      : replacement
    output = output.replaceAll(`{{${index + 1}}}`, String(printable))
    for (const name of [parameter.key, parameter.parameterName].filter(Boolean)) {
      output = output.replaceAll(`{{${name}}}`, String(printable))
    }
  }
  return output.trim()
}

export function cloudChatTemplatePreview(template = {}, runtimeVariables = {}) {
  const components = template.payload?.builder?.components || []
  const variables = {
    ...runtimeVariables,
    ...cloudChatTemplateFixedVariables(template),
  }
  const componentOf = (type) => components.find((component) => component.type === type)
  const bodyComponent = componentOf('body')
  const headerComponent = componentOf('header')
  const footerComponent = componentOf('footer')
  const mediaParameter = headerComponent?.parameters?.find((parameter) => ['image', 'video', 'document'].includes(parameter.type))
  const mediaValue = variables[mediaParameter?.key] ?? mediaParameter?.fixedValue
  const mediaUrl = typeof mediaValue === 'object'
    ? mediaValue.link || mediaValue.url || ''
    : mediaValue
  return {
    body: interpolateCloudTemplateText(
      bodyComponent?.text || template.body || 'Conteúdo controlado pelo template aprovado na Meta.',
      variables,
      bodyComponent?.parameters || [],
    ),
    header: interpolateCloudTemplateText(headerComponent?.text || '', variables, headerComponent?.parameters || []),
    footer: interpolateCloudTemplateText(footerComponent?.text || '', variables, footerComponent?.parameters || []),
    mediaType: mediaParameter?.type || '',
    mediaUrl: String(mediaUrl || ''),
    buttons: components.filter((component) => component.type === 'button').map((component) => ({
      text: interpolateCloudTemplateText(component.text || 'Ação', variables, component.parameters || []),
      url: interpolateCloudTemplateText(component.url || '', variables, component.parameters || []),
    })),
  }
}

function cloudChatMessageText(message = {}) {
  return String(message.text?.body || message.text || message.body || message.message || '').trim()
}

function cloudChatTemplateIdentifier(value = '', fallbackName = '') {
  const match = String(value || '').trim().match(/^\[Template:\s*([^\]]+)\]$/i)
  const name = String(match?.[1] || fallbackName || '').trim()
  return name ? `[Template: ${name}]` : ''
}

function cloudChatParameterValue(parameter = {}) {
  if (parameter.fixedValue !== undefined && parameter.fixedValue !== null) return parameter.fixedValue
  if (parameter.value !== undefined && parameter.value !== null) return parameter.value
  return parameter.text
    ?? parameter.payload
    ?? parameter.coupon_code
    ?? parameter.currency?.fallback_value
    ?? parameter.date_time?.fallback_value
    ?? parameter.image?.link
    ?? parameter.video?.link
    ?? parameter.document?.link
    ?? parameter.link
    ?? parameter.url
    ?? ''
}

function cloudChatRenderedComponentText(component = {}) {
  let output = String(component.text || component.body || component.value || '').trim()
  for (const [index, parameter] of (component.parameters || []).entries()) {
    const value = cloudChatParameterValue(parameter)
    if (!meaningfulCloudTemplateValue(value)) continue
    const printable = typeof value === 'object'
      ? value.text || value.link || value.url || value.id || ''
      : value
    output = output
      .replaceAll(`{{${index + 1}}}`, String(printable))
      .replace(new RegExp(`{{\\s*${String(parameter.key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*}}`, 'g'), String(printable))
  }
  return output.trim()
}

function cloudChatPreviewMedia(preview = {}, components = []) {
  const direct = preview.header?.media || preview.media || null
  if (direct?.url) {
    return {
      type: String(direct.type || preview.header?.type || 'image').toLowerCase(),
      url: String(direct.url),
      filename: String(direct.filename || ''),
    }
  }
  const header = components.find((component) => String(component.type || '').toLowerCase() === 'header')
  const parameter = header?.parameters?.find((item) => ['image', 'video', 'document'].includes(String(item.type || '').toLowerCase()))
  if (!parameter) return null
  const type = String(parameter.type || '').toLowerCase()
  const source = parameter[type] || parameter.fixedValue || parameter.value || {}
  const url = typeof source === 'object'
    ? source.link || source.url || ''
    : source
  if (!url) return null
  return {
    type,
    url: String(url),
    filename: String(source.filename || parameter.filename || ''),
  }
}

function cloudChatPreviewButtons(preview = {}, components = []) {
  const source = Array.isArray(preview.buttons)
    ? preview.buttons
    : components.filter((component) => String(component.type || '').toLowerCase() === 'button')
  return source.map((button, index) => {
    const parameter = button.parameters?.[0] || {}
    const parameterValue = cloudChatParameterValue(parameter)
    const rawUrl = button.url
      || (typeof parameterValue === 'object' ? parameterValue.url || parameterValue.link : parameterValue)
      || ''
    const rawType = String(button.type || '').toLowerCase()
    return {
      type: rawType && rawType !== 'button'
        ? rawType
        : String(button.subType || button.sub_type || 'url').toLowerCase(),
      text: String(button.text || button.label || `Ação ${index + 1}`).trim(),
      url: String(rawUrl || '').trim(),
    }
  }).filter((button) => button.text)
}

export function cloudChatMessagePresentation(message = {}) {
  const rawText = cloudChatMessageText(message)
  const metadata = message.metadata || {}
  const template = metadata.template || message.template || message.payload?.template || {}
  const preview = metadata.templatePreview
    || message.templatePreview
    || template.preview
    || template.presentation
    || {}
  const name = String(preview.name || template.name || metadata.templateName || '').trim()
  const identifier = cloudChatTemplateIdentifier(rawText, name)
  const isTemplate = Boolean(identifier || String(message.type || '').toLowerCase() === 'template')
  if (!isTemplate) {
    return {
      isTemplate: false,
      text: rawText || 'Mensagem não textual',
    }
  }

  const components = preview.components
    || template.builder?.components
    || template.payload?.builder?.components
    || template.components
    || []
  const componentOf = (type) => components.find((component) => String(component.type || '').toLowerCase() === type)
  const headerComponent = componentOf('header')
  const bodyComponent = componentOf('body')
  const footerComponent = componentOf('footer')
  const header = String(preview.header?.text ?? preview.headerText ?? cloudChatRenderedComponentText(headerComponent)).trim()
  const body = String(preview.body?.text ?? preview.bodyText ?? cloudChatRenderedComponentText(bodyComponent)).trim()
  const footer = String(preview.footer?.text ?? preview.footerText ?? cloudChatRenderedComponentText(footerComponent)).trim()
  const media = cloudChatPreviewMedia(preview, components)
  const buttons = cloudChatPreviewButtons(preview, components)

  return {
    isTemplate: true,
    name: name || identifier.replace(/^\[Template:\s*|\]$/g, ''),
    identifier: identifier || cloudChatTemplateIdentifier('', name || 'template_oficial'),
    languageCode: String(preview.languageCode || template.languageCode || template.language?.code || '').trim(),
    header,
    body,
    footer,
    media,
    buttons,
    hasRichContent: Boolean(header || body || footer || media || buttons.length),
  }
}

export function cloudChatFormatText(value = '') {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
    .replace(/```([^`]+)```/gs, '<code>$1</code>')
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>')
    .replace(/\n/g, '<br>')
}

export function cloudChatSafeActionUrl(value = '') {
  const normalized = String(value || '').trim()
  if (/^(tel:|mailto:)/i.test(normalized)) return normalized
  try {
    const url = new URL(normalized)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''
  } catch {
    return ''
  }
}

export function cloudChatSafeMediaUrl(value = '') {
  const normalized = String(value || '').trim()
  if (normalized.startsWith('/') && !normalized.startsWith('//')) return normalized
  try {
    const url = new URL(normalized)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''
  } catch {
    return ''
  }
}

const CLOUD_TEMPLATE_MEDIA_TYPES = new Set(['image', 'video', 'document'])

export function isCloudTemplateMediaParameter(parameter = {}) {
  return CLOUD_TEMPLATE_MEDIA_TYPES.has(parameter.type)
}

export function isValidCloudTemplateMediaUrl(value) {
  try {
    const url = new URL(String(value || '').trim())
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
  } catch {
    return false
  }
}

export function cloudChatTemplateVariablesForSend(parameters = [], values = {}, assets = {}) {
  return Object.fromEntries(parameters.map((parameter) => {
    const value = meaningfulCloudTemplateValue(parameter.fixedValue)
      ? parameter.fixedValue
      : values[parameter.key]
    if (!isCloudTemplateMediaParameter(parameter)) return [parameter.key, value]
    const asset = assets[parameter.key]
    const assetReference = asset?.url || asset?.id || ''
    if (!asset || String(value || '') !== String(assetReference)) return [parameter.key, value]
    const media = asset.url ? { link: asset.url } : { id: asset.id }
    if (parameter.type === 'document') media.filename = asset.filename || parameter.filename || undefined
    return [parameter.key, media]
  }))
}

export function canSendCloudChatMode(conversation, mode = 'quick', now = Date.now()) {
  if (!conversation) return false
  if (mode === 'template') return cloudConsentOf(conversation).authorized
  return canSendCloudServiceMessage(conversation, now)
}

function asCloudTechnicalErrors(message = {}) {
  const metadata = message.metadata || {}
  return [
    ...(Array.isArray(message.errors) ? message.errors : []),
    ...(Array.isArray(message.providerErrors) ? message.providerErrors : []),
    ...(Array.isArray(metadata.providerErrors) ? metadata.providerErrors : []),
    message.error,
    message.providerError,
    metadata.providerError,
  ].filter((error) => error && typeof error === 'object')
}

export function cloudTechnicalMessageDiagnostic(message = {}) {
  const metadata = message?.metadata || {}
  const type = String(message?.type || metadata.messageType || '').trim().toLowerCase()
  const error = asCloudTechnicalErrors(message)[0] || {}
  const rawProviderCode = error.code ?? message?.errorCode ?? metadata.errorCode
  const providerCode = rawProviderCode === undefined || rawProviderCode === null || rawProviderCode === ''
    ? null
    : Number.isFinite(Number(rawProviderCode)) ? Number(rawProviderCode) : String(rawProviderCode)
  const explicitCode = message?.verificationCode
    ?? message?.code
    ?? message?.content?.verificationCode
    ?? message?.content?.code
    ?? metadata.verificationCode
    ?? metadata.code
    ?? null
  const discoveredContent = [
    message?.text?.body,
    typeof message?.text === 'string' ? message.text : '',
    message?.body,
    message?.message,
    message?.content?.body,
    message?.content?.text,
  ].map((value) => String(value || '').trim()).find(Boolean) || ''
  const title = String(error.title || message?.errorTitle || metadata.errorTitle || '').trim()
  const providerMessage = String(error.message || message?.errorMessage || metadata.errorMessage || '').trim()
  const details = String(error.error_data?.details || error.details || message?.errorDetails || metadata.errorDetails || '').trim()
  const contentProvidedFlag = metadata?.unsupported?.contentProvided
  const content = contentProvidedFlag === false ? '' : discoveredContent
  const technical = Boolean(
    ['unsupported', 'technical', 'system', 'unknown'].includes(type)
    || message?.unsupported
    || providerCode !== null
    || title
    || providerMessage
    || details
  )

  return {
    technical,
    type,
    providerCode,
    providerCodeLabel: providerCode === null
      ? ''
      : /^META_/i.test(String(providerCode)) ? String(providerCode) : `META_${providerCode}`,
    title,
    message: providerMessage,
    details,
    content,
    verificationCode: explicitCode === null ? '' : String(explicitCode),
    originalContentProvided: typeof contentProvidedFlag === 'boolean'
      ? contentProvidedFlag
      : Boolean(discoveredContent || explicitCode !== null),
  }
}

export function isContactlessTechnicalConversation(conversation = {}) {
  const contactId = conversation?.contact?.id
    || conversation?.contact?._id
    || conversation?.contactId
  return !contactId && Boolean(
    conversation?.technicalEvent
    || conversation?.contactless
    || cloudTechnicalMessageDiagnostic(conversation?.lastMessage || {}).technical
  )
}
</script>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useQuasar } from 'quasar'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import ContactDialog from '../components/ContactDialog.vue'
import ContextHelp from '../components/ContextHelp.vue'
import { asList, errorMessage, fetchAll, http, unwrap } from '../services/http.js'
import { connectSocket, getSocket } from '../services/socket.js'
import { newIdempotencyKey } from '../services/bulk-notifications.js'
import { playAppSound } from '../services/sounds.js'
import {
  CHAT_MESSAGE_PAGE_SIZE,
  chatWindowAfterRealtime,
  chatPageHasMore,
  isNearChatBottom,
  preservedChatScrollTop,
  retainLoadedChatWindow,
  shouldLoadOlderChatMessages,
} from '../services/chat-pagination.js'

const props = defineProps({ embedded: { type: Boolean, default: false } })
const $q = useQuasar()
const loading = ref(false)
const loadingMessages = ref(false)
const loadingOlderMessages = ref(false)
const sending = ref(false)
const requestingConsent = ref(false)
const backingUp = ref(false)
const liveConnected = ref(false)
const conversations = ref([])
const messages = ref([])
const selected = ref(null)
const search = ref('')
const draft = ref('')
const sendMode = ref('quick')
const templateId = ref(null)
const templateValues = ref({})
const templates = ref([])
const historyNote = ref('')
const now = ref(Date.now())
const messagesPanel = ref(null)
const messagePage = ref(1)
const messageHasMore = ref(false)
const messageTotal = ref(0)
const contactDialog = ref(false)
const contactForDialog = ref(null)
let clockTimer = null
let realtimeRefreshTimer = null
let conversationsRequest = 0
let messagesRequest = 0
const readRequests = new Set()

const filteredConversations = computed(() => {
  const needle = search.value.trim().toLowerCase()
  if (!needle) return conversations.value
  return conversations.value.filter((conversation) => [
    conversation.contact?.displayName,
    conversation.displayName,
    conversation.externalId,
    conversation.contact?.phone,
    conversation.phone,
    conversation.lastMessage?.text,
    conversation.lastMessage?.body,
  ].some((value) => String(value || '').toLowerCase().includes(needle)))
})

const selectedWindow = computed(() => serviceWindowOf(selected.value, now.value))
const selectedConsent = computed(() => cloudConsentOf(selected.value))
const selectedContactId = computed(() => selected.value?.contact?.id
  || selected.value?.contact?._id
  || selected.value?.contactId
  || null)
const selectedIsTechnical = computed(() => isContactlessTechnicalConversation(selected.value || {}))
const selectedCanSend = computed(() => !selectedIsTechnical.value && canSendCloudServiceMessage(selected.value, now.value))
const selectedCanCompose = computed(() => !selectedIsTechnical.value && canSendCloudChatMode(selected.value, sendMode.value, now.value))
const consentRequestAvailable = computed(() => !selectedIsTechnical.value && selectedCanSend.value && !selectedConsent.value.authorized)
const templateOptions = computed(() => templates.value
  .filter((item) => item.active !== false && item.externalTemplateName)
  .map((item) => ({
    label: `${item.name || item.title} · ${item.languageCode || 'pt_BR'}`,
    value: item.id || item._id,
  })))
const selectedTemplate = computed(() => templates.value.find(
  (item) => String(item.id || item._id) === String(templateId.value),
) || null)
const selectedTemplateParameters = computed(() => cloudChatTemplateParameters(selectedTemplate.value || {}))
const selectedTemplateDynamicParameters = computed(() => selectedTemplateParameters.value.filter(
  (parameter) => !meaningfulCloudTemplateValue(parameter.fixedValue),
))
const selectedTemplateVariables = computed(() => cloudChatTemplateVariablesForSend(
  selectedTemplateParameters.value,
  templateValues.value,
))
const selectedTemplatePreview = computed(() => cloudChatTemplatePreview(
  selectedTemplate.value || {},
  selectedTemplateVariables.value,
))
const hasOlderMessages = computed(() => messageHasMore.value)

watch(templateId, () => {
  templateValues.value = {}
})

function dynamicParameterHint(parameter = {}) {
  if (isCloudTemplateMediaParameter(parameter)) {
    return `${parameter.type === 'image' ? 'Imagem' : parameter.type === 'video' ? 'Vídeo' : 'Documento'}: informe uma URL HTTPS pública.`
  }
  if (parameter.componentType === 'button') {
    return 'Informe somente a parte dinâmica do link aprovada pela Meta, como o slug do convite.'
  }
  return parameter.parameterName
    ? `Preenche {{${parameter.parameterName}}} no corpo aprovado pela Meta.`
    : 'Valor solicitado por este template para esta entrega.'
}

function dynamicParameterIcon(parameter = {}) {
  if (parameter.type === 'image') return 'image'
  if (parameter.type === 'video') return 'movie'
  if (parameter.type === 'document') return 'description'
  if (parameter.componentType === 'button') return 'link'
  return 'short_text'
}

function conversationName(conversation) {
  return conversation?.contact?.displayName
    || conversation?.displayName
    || conversation?.contactName
    || conversation?.externalId
    || conversation?.contact?.phone
    || conversation?.phone
    || 'Contato sem nome'
}

function conversationPhone(conversation) {
  return conversation?.contact?.phone
    || conversation?.phone
    || conversation?.waId
    || conversation?.externalId
    || ''
}

function conversationAvatar(conversation) {
  return conversation?.contact?.avatar || conversation?.contact?.avatarUrl
    || conversation?.avatar || conversation?.avatarUrl || ''
}

function initials(value) {
  return String(value || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function messageBody(message) {
  return message.text?.body || message.text || message.body || message.message || 'Mensagem não textual'
}

const messagePresentationCache = new WeakMap()

function messagePresentation(message) {
  if (!message || typeof message !== 'object') return cloudChatMessagePresentation(message)
  const cached = messagePresentationCache.get(message)
  if (cached) return cached
  const presentation = cloudChatMessagePresentation(message)
  messagePresentationCache.set(message, presentation)
  return presentation
}

function previewOf(conversation) {
  const lastMessage = conversation?.lastMessage
  if (typeof lastMessage === 'string') return lastMessage
  const diagnostic = cloudTechnicalMessageDiagnostic(lastMessage || {})
  if (diagnostic.technical) {
    return diagnostic.content
      || diagnostic.message
      || diagnostic.title
      || diagnostic.providerCodeLabel
      || 'Evento técnico da Meta'
  }
  return lastMessage?.preview || lastMessage?.text?.body || lastMessage?.text || lastMessage?.body || 'Sem mensagens'
}

function formatTime(value) {
  const time = timestampOf(value)
  if (!time) return ''
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(time))
}

function formatLastActivity(conversation) {
  return formatTime(conversation.lastMessageAt || conversation.updatedAt || conversation.lastInboundAt)
}

function consentSource(conversation) {
  return cloudConsentSourceLabel(cloudConsentOf(conversation))
}

async function loadConversations({ background = false, keepSelection = true } = {}) {
  const requestId = ++conversationsRequest
  if (!background) loading.value = true
  try {
    const payload = unwrap(await http.get('/whatsapp-cloud/conversations', {
      params: { page: 1, limit: 100 },
    }))
    if (requestId !== conversationsRequest) return
    const items = asList(payload, 'items')
    conversations.value = items.reduce(
      (result, conversation) => upsertCloudConversation(result, conversation),
      [],
    )

    const selectedId = keepSelection ? cloudConversationId(selected.value) : ''
    const refreshed = selectedId
      ? conversations.value.find((item) => cloudConversationId(item) === selectedId)
      : null
    if (refreshed) selected.value = { ...selected.value, ...refreshed }
    else if (selectedId) closeConversation()
  } catch (error) {
    if (!background) {
      $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível carregar as conversas oficiais.') })
    }
  } finally {
    if (requestId === conversationsRequest) loading.value = false
  }
}

async function loadTemplates() {
  try {
    templates.value = await fetchAll('/templates', {
      params: { channel: 'whatsapp_cloud' },
      preferredKey: 'templates',
    })
  } catch (error) {
    $q.notify({
      type: 'warning',
      message: errorMessage(error, 'Não foi possível carregar os templates oficiais do chat.'),
    })
  }
}

async function markConversationRead(id) {
  if (!id || readRequests.has(id)) return
  readRequests.add(id)
  selected.value = cloudConversationId(selected.value) === id
    ? { ...selected.value, unreadCount: 0 }
    : selected.value
  conversations.value = conversations.value.map((item) => (
    cloudConversationId(item) === id ? { ...item, unreadCount: 0 } : item
  ))
  try {
    await http.patch(`/whatsapp-cloud/conversations/${id}/read`)
  } finally {
    readRequests.delete(id)
  }
}

function resetMessagePagination() {
  messagePage.value = 1
  messageHasMore.value = false
  messageTotal.value = 0
  loadingOlderMessages.value = false
}

function updateMessagePagination(payload = {}, page = 1, receivedCount = 0) {
  messagePage.value = Math.max(1, Number(payload.page || page) || page)
  messageTotal.value = Math.max(0, Number(payload.total) || 0)
  messageHasMore.value = chatPageHasMore(
    payload,
    messagePage.value,
    receivedCount,
    CHAT_MESSAGE_PAGE_SIZE,
  )
}

async function loadConversation(conversation, { background = false, markRead = false } = {}) {
  const id = cloudConversationId(conversation)
  if (!id) return
  const requestId = ++messagesRequest
  const messageElement = messagesPanel.value?.$el || messagesPanel.value
  const followLatest = !background || !messageElement || isNearChatBottom(messageElement)
  if (!background) {
    messages.value = []
    historyNote.value = ''
    loadingMessages.value = true
    resetMessagePagination()
  }
  try {
    const [detailResult, messagesResult] = await Promise.all([
      http.get(`/whatsapp-cloud/conversations/${id}`).catch(() => null),
      http.get(`/whatsapp-cloud/conversations/${id}/messages`, {
        params: { page: 1, limit: CHAT_MESSAGE_PAGE_SIZE },
      }),
    ])
    if (requestId !== messagesRequest || cloudConversationId(selected.value) !== id) return
    const detail = detailResult ? unwrap(detailResult) : null
    if (detail) {
      selected.value = { ...selected.value, ...detail }
      conversations.value = upsertCloudConversation(conversations.value, selected.value)
    }
    const messagePayload = unwrap(messagesResult) || {}
    const loadedMessages = asList(messagePayload, 'items')
    const previousCount = messages.value.length
    const mergedMessages = mergeCloudMessages([...messages.value, ...loadedMessages])
    const receivedNewerMessage = mergedMessages.length > previousCount
    messages.value = background
      ? retainLoadedChatWindow(mergedMessages, messagePage.value, CHAT_MESSAGE_PAGE_SIZE)
      : mergedMessages
    if (background && messagePage.value > 1) {
      messageTotal.value = Math.max(0, Number(messagePayload.total) || messageTotal.value)
      messageHasMore.value = chatPageHasMore(
        { ...messagePayload, page: messagePage.value },
        messagePage.value,
        loadedMessages.length,
        CHAT_MESSAGE_PAGE_SIZE,
      )
    } else {
      updateMessagePagination(messagePayload, 1, loadedMessages.length)
    }
    if (!messages.value.length) historyNote.value = 'Ainda não há mensagens armazenadas nesta conversa.'
    else historyNote.value = ''
    if (markRead && Number(selected.value?.unreadCount || conversation.unreadCount || 0) > 0) {
      await markConversationRead(id).catch(() => undefined)
    }
    if (!background) loadingMessages.value = false
    if (!background || (receivedNewerMessage && followLatest)) await scrollToBottom()
  } catch (error) {
    if (requestId !== messagesRequest || cloudConversationId(selected.value) !== id) return
    if (!background) {
      historyNote.value = 'Não foi possível carregar o histórico desta conversa.'
      $q.notify({ type: 'warning', message: errorMessage(error, historyNote.value) })
    }
  } finally {
    if (requestId === messagesRequest && cloudConversationId(selected.value) === id) {
      loadingMessages.value = false
    }
  }
}

async function loadOlderMessages() {
  const id = cloudConversationId(selected.value)
  const element = messagesPanel.value?.$el || messagesPanel.value
  if (!id || !element || !shouldLoadOlderChatMessages({
    scrollTop: element.scrollTop,
    hasMore: hasOlderMessages.value,
    loading: loadingOlderMessages.value || loadingMessages.value,
  })) return

  const activeRequest = messagesRequest
  const requestedPage = messagePage.value + 1
  const previousScrollTop = element.scrollTop
  const previousScrollHeight = element.scrollHeight
  loadingOlderMessages.value = true
  try {
    const payload = unwrap(await http.get(`/whatsapp-cloud/conversations/${id}/messages`, {
      params: { page: requestedPage, limit: CHAT_MESSAGE_PAGE_SIZE },
    })) || {}
    if (activeRequest !== messagesRequest || cloudConversationId(selected.value) !== id) return
    const olderMessages = asList(payload, 'items')
    messages.value = mergeCloudMessages([...messages.value, ...olderMessages])
    updateMessagePagination(payload, requestedPage, olderMessages.length)
    await nextTick()
    element.scrollTop = preservedChatScrollTop({
      previousScrollTop,
      previousScrollHeight,
      nextScrollHeight: element.scrollHeight,
    })
  } catch (error) {
    if (activeRequest === messagesRequest && cloudConversationId(selected.value) === id) {
      $q.notify({ type: 'warning', message: errorMessage(error, 'Não foi possível carregar mensagens anteriores.') })
    }
  } finally {
    if (activeRequest === messagesRequest && cloudConversationId(selected.value) === id) {
      loadingOlderMessages.value = false
    }
  }
}

function onMessagesScroll(event) {
  const element = event?.currentTarget || messagesPanel.value?.$el || messagesPanel.value
  if (!element || !shouldLoadOlderChatMessages({
    scrollTop: element.scrollTop,
    hasMore: hasOlderMessages.value,
    loading: loadingOlderMessages.value || loadingMessages.value,
  })) return
  void loadOlderMessages()
}

async function selectConversation(conversation) {
  const id = cloudConversationId(conversation)
  if (!id) return
  const switching = cloudConversationId(selected.value) !== id
  selected.value = switching ? conversation : { ...selected.value, ...conversation }
  if (switching) {
    messagesRequest += 1
    messages.value = []
    historyNote.value = ''
    sendMode.value = 'quick'
    draft.value = ''
    templateId.value = null
    resetMessagePagination()
  }
  await loadConversation(selected.value, {
    background: !switching && messages.value.length > 0,
    markRead: true,
  })
}

function closeConversation() {
  messagesRequest += 1
  loadingMessages.value = false
  selected.value = null
  messages.value = []
  resetMessagePagination()
  historyNote.value = ''
  sendMode.value = 'quick'
  draft.value = ''
  templateId.value = null
}

async function scrollToBottom() {
  await nextTick()
  const element = messagesPanel.value?.$el || messagesPanel.value
  if (element) element.scrollTop = element.scrollHeight
}

async function refreshSelected() {
  if (!selected.value) return
  const id = cloudConversationId(selected.value)
  await loadConversations({ background: true })
  if (cloudConversationId(selected.value) !== id) return
  const current = conversations.value.find((item) => cloudConversationId(item) === id)
  if (current) {
    selected.value = { ...selected.value, ...current }
    await loadConversation(selected.value, { background: true, markRead: false })
  }
}

async function sendMessage() {
  if (!selected.value) return
  if (!selectedCanCompose.value) {
    $q.notify({
      type: 'warning',
      message: sendMode.value === 'quick'
        ? 'A janela de atendimento de 24 horas terminou. Use um template oficial autorizado.'
        : 'O contato precisa autorizar notificações antes de receber este template.',
    })
    return
  }
  const text = draft.value.trim()
  if (sendMode.value === 'quick' && !text) return
  if (sendMode.value === 'template' && !templateId.value) {
    $q.notify({ type: 'warning', message: 'Selecione um template oficial.' })
    return
  }
  if (sendMode.value === 'template' && !selectedContactId.value) {
    $q.notify({ type: 'warning', message: 'Associe esta conversa a um contato antes de enviar um template.' })
    return
  }
  const missingParameters = selectedTemplateDynamicParameters.value.filter(
    (parameter) => !meaningfulCloudTemplateValue(templateValues.value[parameter.key]),
  )
  if (sendMode.value === 'template' && missingParameters.length) {
    $q.notify({
      type: 'warning',
      message: `Preencha os dados deste envio: ${missingParameters.map((parameter) => parameter.label).join(', ')}.`,
    })
    return
  }
  const invalidMedia = selectedTemplateParameters.value.filter(
    (parameter) => isCloudTemplateMediaParameter(parameter)
      && !isValidCloudTemplateMediaUrl(typeof selectedTemplateVariables.value[parameter.key] === 'object'
        ? selectedTemplateVariables.value[parameter.key].link || selectedTemplateVariables.value[parameter.key].url
        : selectedTemplateVariables.value[parameter.key]),
  )
  if (sendMode.value === 'template' && invalidMedia.length) {
    $q.notify({
      type: 'warning',
      message: `Revise o template cadastrado. A mídia precisa de uma URL HTTPS válida em: ${invalidMedia.map((parameter) => parameter.label).join(', ')}.`,
    })
    return
  }
  sending.value = true
  try {
    if (sendMode.value === 'quick') {
      await http.post(`/whatsapp-cloud/conversations/${cloudConversationId(selected.value)}/messages`, { text })
      draft.value = ''
    } else {
      await http.post('/notifications', {
        kind: 'template',
        channel: 'whatsapp_cloud',
        contactIds: [selectedContactId.value],
        groupIds: [],
        templateId: templateId.value,
        content: {
          variables: selectedTemplateVariables.value,
        },
        idempotencyKey: newIdempotencyKey('whatsapp-cloud-chat'),
      })
      $q.notify({ type: 'positive', message: 'Template colocado na fila de envio.' })
      templateValues.value = {}
    }
    await refreshSelected()
  } catch (error) {
    if (error.response?.status === 409) {
      selected.value = {
        ...selected.value,
        serviceWindow: { ...selected.value.serviceWindow, open: false, expiresAt: new Date(now.value).toISOString(), remainingSeconds: 0 },
      }
    }
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível enviar a mensagem oficial.') })
  } finally {
    sending.value = false
  }
}

async function requestConsent() {
  if (!selected.value || !consentRequestAvailable.value) return
  requestingConsent.value = true
  try {
    const response = unwrap(await http.post(
      `/whatsapp-cloud/conversations/${cloudConversationId(selected.value)}/consent-request`,
    ))
    if (response?.conversation) selected.value = { ...selected.value, ...response.conversation }
    await refreshSelected()
    $q.notify({
      type: 'positive',
      message: `Pedido enviado. O cliente deve responder com ${selectedConsent.value.command}.`,
    })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível enviar o pedido de autorização.') })
  } finally {
    requestingConsent.value = false
  }
}

function backupFilename(contentDisposition = '') {
  const utf8Match = String(contentDisposition).match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]).replace(/[\\/:*?"<>|]/g, '-')
  const plainMatch = String(contentDisposition).match(/filename="?([^";]+)"?/i)
  if (plainMatch?.[1]) return plainMatch[1].replace(/[\\/:*?"<>|]/g, '-')
  return `notify-flow-chats-${new Date().toISOString().slice(0, 10)}.json`
}

async function downloadBackup() {
  backingUp.value = true
  try {
    const response = await http.post(
      '/whatsapp-cloud/conversations/backup',
      {},
      { responseType: 'blob', timeout: 120000 },
    )
    const blob = response.data instanceof Blob
      ? response.data
      : new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' })
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = backupFilename(response.headers?.['content-disposition'])
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.URL.revokeObjectURL(url)
    $q.notify({ type: 'positive', message: 'Backup das conversas baixado com sucesso.' })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível gerar o backup agora.') })
  } finally {
    backingUp.value = false
  }
}

async function openContact() {
  const contact = selected.value?.contact
  const contactId = contact?.id || contact?._id || selected.value?.contactId
  if (!contactId) return
  try {
    contactForDialog.value = unwrap(await http.get(`/contacts/${contactId}`))
    contactDialog.value = true
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível abrir o contato.') })
  }
}

function clearMessages() {
  if (!selected.value) return
  const id = cloudConversationId(selected.value)
  $q.dialog({
    title: 'Limpar mensagens armazenadas?',
    message: 'O contato, o consentimento e os dados da conversa serão preservados.',
    cancel: { flat: true, label: 'Cancelar' },
    ok: { color: 'negative', label: 'Limpar mensagens' },
    persistent: true,
  }).onOk(async () => {
    try {
      await http.delete(`/whatsapp-cloud/conversations/${id}/messages`)
      if (cloudConversationId(selected.value) === id) {
        messages.value = []
        resetMessagePagination()
        historyNote.value = 'O histórico armazenado desta conversa foi removido.'
      }
      await loadConversations({ background: true })
      $q.notify({ type: 'positive', message: 'Mensagens armazenadas removidas.' })
    } catch (error) {
      $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível limpar as mensagens.') })
    }
  })
}

function applyRealtimeConversation(payload = {}) {
  const conversation = payload.conversation || payload
  const id = cloudConversationId(conversation)
  if (!id) return null
  if (conversation.channel && String(conversation.channel).replaceAll('-', '_') !== 'whatsapp_cloud') {
    return null
  }
  conversations.value = upsertCloudConversation(conversations.value, conversation)
  if (cloudConversationId(selected.value) === id) {
    selected.value = { ...selected.value, ...conversation }
  }
  return conversation
}

function onRealtimeConversation(payload = {}) {
  applyRealtimeConversation(payload)
}

function onRealtimeMessage(payload = {}) {
  const conversation = applyRealtimeConversation(payload)
  const id = cloudConversationId(conversation)
  if (!id || !payload.message) return
  if (payload.message.direction === 'inbound') void playAppSound('whatsapp')
  if (cloudConversationId(selected.value) !== id) return
  const element = messagesPanel.value?.$el || messagesPanel.value
  const followLatest = !element || isNearChatBottom(element)
  const previousCount = messages.value.length
  const mergedMessages = mergeCloudMessages([...messages.value, payload.message])
  if (mergedMessages.length > previousCount) {
    const nextWindow = chatWindowAfterRealtime(mergedMessages, {
      loadedPages: messagePage.value,
      total: messageTotal.value + 1,
      pageSize: CHAT_MESSAGE_PAGE_SIZE,
    })
    messages.value = nextWindow.items
    messageTotal.value = nextWindow.total
    messageHasMore.value = nextWindow.hasMore
  } else {
    messages.value = retainLoadedChatWindow(mergedMessages, messagePage.value, CHAT_MESSAGE_PAGE_SIZE)
  }
  historyNote.value = ''
  if (followLatest) void scrollToBottom()
  if (payload.message.direction === 'inbound' && Number(conversation.unreadCount || 0) > 0) {
    void markConversationRead(id).catch(() => undefined)
  }
}

function scheduleRealtimeRefresh(payload = {}) {
  const conversation = payload.conversation || payload
  if (conversation.channel && String(conversation.channel).replaceAll('-', '_') !== 'whatsapp_cloud') return
  applyRealtimeConversation(payload)
  if (realtimeRefreshTimer) window.clearTimeout(realtimeRefreshTimer)
  realtimeRefreshTimer = window.setTimeout(async () => {
    realtimeRefreshTimer = null
    const activeId = cloudConversationId(selected.value)
    await loadConversations({ background: true })
    if (!activeId || cloudConversationId(selected.value) !== activeId) return
    const current = conversations.value.find((item) => cloudConversationId(item) === activeId)
    if (current) await loadConversation(current, { background: true, markRead: false })
  }, 220)
}

function onSocketConnected() {
  liveConnected.value = true
  void loadConversations({ background: true })
}

function onSocketDisconnected() {
  liveConnected.value = false
}

onMounted(() => {
  clockTimer = window.setInterval(() => { now.value = Date.now() }, 1000)
  const socket = connectSocket()
  liveConnected.value = socket.connected
  socket.on('connect', onSocketConnected)
  socket.on('disconnect', onSocketDisconnected)
  socket.on('system:ready', onSocketConnected)
  socket.on('whatsapp_cloud:conversation', scheduleRealtimeRefresh)
  socket.on('whatsapp_cloud:conversation_updated', scheduleRealtimeRefresh)
  socket.on('whatsapp_cloud:message', scheduleRealtimeRefresh)
  socket.on('conversation:message', onRealtimeMessage)
  socket.on('conversations:updated', onRealtimeConversation)
  void Promise.all([loadConversations(), loadTemplates()])
})

onBeforeUnmount(() => {
  if (clockTimer) window.clearInterval(clockTimer)
  if (realtimeRefreshTimer) window.clearTimeout(realtimeRefreshTimer)
  const socket = getSocket()
  socket.off('connect', onSocketConnected)
  socket.off('disconnect', onSocketDisconnected)
  socket.off('system:ready', onSocketConnected)
  socket.off('whatsapp_cloud:conversation', scheduleRealtimeRefresh)
  socket.off('whatsapp_cloud:conversation_updated', scheduleRealtimeRefresh)
  socket.off('whatsapp_cloud:message', scheduleRealtimeRefresh)
  socket.off('conversation:message', onRealtimeMessage)
  socket.off('conversations:updated', onRealtimeConversation)
})
</script>

<template>
  <component
    :is="props.embedded ? 'section' : 'q-page'"
    :class="props.embedded ? 'embedded-chats' : 'page-container'"
  >
    <PageHeader
      v-if="!props.embedded"
      eyebrow="Atendimento oficial"
      title="Chats"
      description="Responda conversas iniciadas pelos clientes durante a janela oficial de atendimento de 24 horas."
      icon="forum"
    >
      <template #actions>
        <ContextHelp
          title="Como o histórico dos Chats é formado"
          tooltip="Entenda o histórico oficial"
          :text="[
            'A Cloud API não oferece uma importação retroativa das conversas do aplicativo WhatsApp. Esta caixa de entrada começa a ser formada pelos webhooks recebidos depois da configuração.',
            'As mensagens enviadas pelo Notify Flow também são armazenadas aqui. O WebSocket atualiza a tela em tempo real, enquanto o MongoDB mantém o histórico e permite gerar um backup manual.',
            'Texto livre só pode ser enviado durante as 24 horas após a última mensagem do cliente. Depois disso, use um template oficial aprovado pela Meta.',
          ]"
        />
        <q-btn
          outline
          no-caps
          color="primary"
          icon="download"
          label="Fazer backup agora"
          :loading="backingUp"
          @click="downloadBackup"
        >
          <q-tooltip>Baixar uma cópia JSON das conversas armazenadas</q-tooltip>
        </q-btn>
        <q-badge
          class="gt-xs"
          outline
          :color="liveConnected ? 'positive' : 'warning'"
          :icon="liveConnected ? 'sensors' : 'sync_problem'"
          :label="liveConnected ? 'Tempo real ativo' : 'Reconectando'"
        />
      </template>
    </PageHeader>

    <q-card
      flat
      class="glass-card chats-shell"
      :class="{ 'chats-shell--conversation-mobile': selected }"
    >
      <aside class="chat-sidebar">
        <div class="sidebar-title">
          <div>
            <strong>Conversas</strong>
            <span>WhatsApp oficial</span>
          </div>
          <q-badge outline color="primary" :label="`${conversations.length} chats`" />
        </div>
        <q-input v-model="search" dense outlined clearable placeholder="Buscar nome ou telefone" class="q-ma-md">
          <template #prepend><q-icon name="search" /></template>
        </q-input>

        <div v-if="loading" class="q-px-md">
          <q-skeleton v-for="item in 6" :key="item" type="QItem" />
        </div>
        <EmptyState
          v-else-if="!filteredConversations.length"
          icon="chat_bubble_outline"
          title="Sem conversas"
          description="Quando um cliente enviar uma mensagem ao número oficial, o chat aparecerá aqui em tempo real."
        />
        <q-list v-else separator class="chat-list">
          <q-item
            v-for="conversation in filteredConversations"
            :key="cloudConversationId(conversation)"
            clickable
            :active="cloudConversationId(conversation) === cloudConversationId(selected)"
            active-class="selected-chat"
            @click="selectConversation(conversation)"
          >
            <q-item-section avatar>
              <q-avatar size="48px">
                <img
                  v-if="conversationAvatar(conversation)"
                  :src="conversationAvatar(conversation)"
                  :alt="`Foto de ${conversationName(conversation)}`"
                />
                <span v-else class="avatar-fallback">{{ initials(conversationName(conversation)) }}</span>
              </q-avatar>
            </q-item-section>
            <q-item-section>
              <q-item-label class="text-weight-bold ellipsis">{{ conversationName(conversation) }}</q-item-label>
              <q-item-label caption class="ellipsis">{{ previewOf(conversation) }}</q-item-label>
              <div v-if="isContactlessTechnicalConversation(conversation)" class="chat-flags">
                <q-badge outline color="warning" icon="policy" label="Evento técnico" />
              </div>
              <div v-else class="chat-flags">
                <span
                  :class="[
                    'window-flag',
                    serviceWindowOf(conversation, now).open ? 'window-flag--open' : 'window-flag--closed',
                  ]"
                >
                  <q-icon :name="serviceWindowOf(conversation, now).open ? 'timer' : 'lock_clock'" />
                  {{ formatServiceWindow(conversation, now) }}
                </span>
                <q-icon
                  :name="cloudConsentOf(conversation).authorized ? 'notifications_active' : 'notifications_off'"
                  :color="cloudConsentOf(conversation).authorized ? 'positive' : 'grey-6'"
                  size="16px"
                >
                  <q-tooltip>
                    {{ cloudConsentOf(conversation).authorized
                      ? `Notificações autorizadas: ${consentSource(conversation)}`
                      : 'Notificações ainda não autorizadas' }}
                  </q-tooltip>
                </q-icon>
              </div>
            </q-item-section>
            <q-item-section side top>
              <span class="chat-time">{{ formatLastActivity(conversation) }}</span>
              <q-badge v-if="conversation.unreadCount" rounded color="primary" :label="conversation.unreadCount" />
            </q-item-section>
          </q-item>
        </q-list>
      </aside>

      <section class="conversation-panel">
        <EmptyState
          v-if="!selected"
          icon="forum"
          title="Escolha uma conversa"
          description="Selecione um chat para visualizar mensagens, janela de atendimento e consentimento."
        />
        <template v-else>
          <header class="conversation-header">
            <q-btn
              flat
              round
              dense
              icon="arrow_back"
              aria-label="Voltar para conversas"
              class="mobile-back"
              @click="closeConversation"
            />
            <q-avatar size="44px">
              <img
                v-if="conversationAvatar(selected)"
                :src="conversationAvatar(selected)"
                :alt="`Foto de ${conversationName(selected)}`"
              />
              <span v-else class="avatar-fallback">{{ initials(conversationName(selected)) }}</span>
            </q-avatar>
            <div class="conversation-identity">
              <strong class="ellipsis">{{ conversationName(selected) }}</strong>
              <span>{{ conversationPhone(selected) }}</span>
              <div class="identity-flags">
                <q-badge
                  v-if="selectedIsTechnical"
                  outline
                  color="warning"
                  icon="policy"
                  label="Evento técnico da Meta · contato não cadastrado"
                />
                <q-badge
                  v-else
                  outline
                  :color="selectedConsent.authorized ? 'positive' : 'grey-7'"
                  :icon="selectedConsent.authorized ? 'notifications_active' : 'notifications_off'"
                  :label="selectedConsent.authorized
                    ? `Notificações permitidas · ${cloudConsentSourceLabel(selectedConsent)}`
                    : 'Notificações não permitidas'"
                />
              </div>
            </div>
            <q-space />
            <q-btn
              v-if="selected.contact?.id || selected.contact?._id || selected.contactId"
              flat
              round
              icon="manage_accounts"
              aria-label="Editar contato"
              @click="openContact"
            >
              <q-tooltip>Editar contato e permissões</q-tooltip>
            </q-btn>
            <q-btn flat round color="warning" icon="cleaning_services" aria-label="Limpar mensagens" @click="clearMessages">
              <q-tooltip>Limpar somente as mensagens armazenadas</q-tooltip>
            </q-btn>
          </header>

          <q-banner
            v-if="selectedIsTechnical"
            rounded
            class="technical-conversation-banner"
          >
            <template #avatar><q-icon name="policy" /></template>
            <div>
              <strong>Evento técnico da Meta · contato não cadastrado</strong>
              <span>Consulta somente leitura. O remetente foi preservado pelo identificador externo e nenhuma autorização ou contato foi criado automaticamente.</span>
            </div>
          </q-banner>
          <q-banner
            v-else
            rounded
            :class="['service-window-banner', selectedWindow.open ? 'service-window-banner--open' : 'service-window-banner--closed']"
          >
            <template #avatar>
              <q-icon :name="selectedWindow.open ? 'timer' : 'lock_clock'" />
            </template>
            <div>
              <strong>{{ selectedWindow.open ? 'Janela de atendimento aberta' : 'Janela de atendimento encerrada' }}</strong>
              <span v-if="selectedWindow.open">
                Restam <b>{{ formatServiceWindow(selected, now) }}</b> para responder com texto livre.
              </span>
              <span v-else>
                Para iniciar uma nova conversa, envie um template oficial aprovado pela Meta no menu Notificações.
              </span>
            </div>
          </q-banner>

          <div ref="messagesPanel" class="message-stream" @scroll.passive="onMessagesScroll">
            <div v-if="loadingMessages" class="q-pa-lg">
              <q-skeleton v-for="item in 5" :key="item" type="text" />
            </div>
            <template v-else>
              <div v-if="loadingOlderMessages" class="chat-history-progress" aria-live="polite">
                <q-spinner-dots color="primary" size="22px" />
                <span>Carregando mensagens anteriores…</span>
              </div>
              <div v-else-if="hasOlderMessages" class="chat-history-progress chat-history-progress--hint">
                Role até o topo para carregar mais 10 mensagens
              </div>
              <div v-if="!messages.length" class="day-note">
                {{ historyNote || 'Nenhuma mensagem armazenada' }}
              </div>
              <div
                v-for="item in messages"
                :key="item.providerMessageId || item.id || item._id || item.timestamp"
                :class="['message-row', { 'message-row--mine': item.direction === 'outbound' || item.fromMe }]"
              >
                <div class="message-bubble">
                  <template v-if="messagePresentation(item).isTemplate">
                    <div class="template-message-identifier">
                      <q-icon name="verified" />
                      <code>{{ messagePresentation(item).identifier }}</code>
                      <small v-if="messagePresentation(item).languageCode">
                        {{ messagePresentation(item).languageCode }}
                      </small>
                    </div>
                    <div
                      v-if="messagePresentation(item).hasRichContent"
                      class="template-message-content"
                    >
                      <div
                        v-if="messagePresentation(item).media && cloudChatSafeMediaUrl(messagePresentation(item).media.url)"
                        class="template-message-media"
                      >
                        <q-img
                          v-if="messagePresentation(item).media.type === 'image'"
                          :src="cloudChatSafeMediaUrl(messagePresentation(item).media.url)"
                          :alt="messagePresentation(item).media.filename || 'Imagem do template'"
                          fit="cover"
                          loading="lazy"
                        />
                        <video
                          v-else-if="messagePresentation(item).media.type === 'video'"
                          :src="cloudChatSafeMediaUrl(messagePresentation(item).media.url)"
                          controls
                          preload="metadata"
                        />
                        <a
                          v-else
                          :href="cloudChatSafeMediaUrl(messagePresentation(item).media.url)"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="template-message-document"
                        >
                          <q-icon name="description" size="24px" />
                          <span>{{ messagePresentation(item).media.filename || 'Abrir documento' }}</span>
                          <q-icon name="open_in_new" />
                        </a>
                      </div>
                      <div
                        v-if="messagePresentation(item).header"
                        class="template-message-header"
                        v-html="cloudChatFormatText(messagePresentation(item).header)"
                      />
                      <div
                        v-if="messagePresentation(item).body"
                        class="template-message-body"
                        v-html="cloudChatFormatText(messagePresentation(item).body)"
                      />
                      <div
                        v-if="messagePresentation(item).footer"
                        class="template-message-footer"
                        v-html="cloudChatFormatText(messagePresentation(item).footer)"
                      />
                      <div
                        v-if="messagePresentation(item).buttons.length"
                        class="template-message-buttons"
                      >
                        <template
                          v-for="(button, buttonIndex) in messagePresentation(item).buttons"
                          :key="`${button.type}-${button.text}-${buttonIndex}`"
                        >
                          <a
                            v-if="cloudChatSafeActionUrl(button.url)"
                            :href="cloudChatSafeActionUrl(button.url)"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <q-icon :name="button.type.includes('phone') ? 'call' : 'open_in_new'" />
                            {{ button.text }}
                          </a>
                          <span v-else>
                            <q-icon name="reply" />
                            {{ button.text }}
                          </span>
                        </template>
                      </div>
                    </div>
                  </template>
                  <div v-else-if="cloudTechnicalMessageDiagnostic(item).technical" class="technical-message-content">
                    <div class="technical-message-content__heading">
                      <q-icon name="policy" />
                      <strong>{{ cloudTechnicalMessageDiagnostic(item).title || 'Evento técnico da Meta' }}</strong>
                      <q-badge
                        v-if="cloudTechnicalMessageDiagnostic(item).providerCodeLabel"
                        outline
                        color="warning"
                        :label="cloudTechnicalMessageDiagnostic(item).providerCodeLabel"
                      />
                    </div>
                    <p v-if="cloudTechnicalMessageDiagnostic(item).content">{{ cloudTechnicalMessageDiagnostic(item).content }}</p>
                    <p v-if="cloudTechnicalMessageDiagnostic(item).verificationCode">
                      Código recebido: <strong>{{ cloudTechnicalMessageDiagnostic(item).verificationCode }}</strong>
                    </p>
                    <p v-if="cloudTechnicalMessageDiagnostic(item).message">{{ cloudTechnicalMessageDiagnostic(item).message }}</p>
                    <small v-if="cloudTechnicalMessageDiagnostic(item).details">{{ cloudTechnicalMessageDiagnostic(item).details }}</small>
                    <small v-if="cloudTechnicalMessageDiagnostic(item).providerCode === 131051 && !cloudTechnicalMessageDiagnostic(item).originalContentProvided">
                      META_131051 é um código técnico da Meta, não o código de verificação. Conteúdo original não fornecido pela API.
                    </small>
                    <small v-else-if="!cloudTechnicalMessageDiagnostic(item).originalContentProvided">
                      Conteúdo original não fornecido pela API.
                    </small>
                  </div>
                  <div v-else>{{ messageBody(item) }}</div>
                  <span class="message-meta">
                    {{ formatTime(item.sentAt || item.createdAt || item.timestamp) }}
                    <q-icon
                      v-if="item.direction === 'outbound' || item.fromMe"
                      :name="item.status === 'failed' ? 'error_outline' : 'done_all'"
                      :color="item.status === 'failed' ? 'negative' : 'primary'"
                      size="15px"
                    />
                  </span>
                </div>
              </div>
            </template>
          </div>

          <footer v-if="!selectedIsTechnical" class="message-composer">
            <div v-if="!selectedConsent.authorized" class="consent-callout">
              <div>
                <q-icon name="notifications_off" />
                <span>
                  Este contato ainda não permitiu notificações.
                  Envie o pedido configurado para ele responder com <code>{{ selectedConsent.command }}</code>.
                </span>
              </div>
              <q-btn
                outline
                no-caps
                color="primary"
                icon="notifications_active"
                label="Solicitar autorização"
                :loading="requestingConsent"
                :disable="!consentRequestAvailable"
                @click="requestConsent"
              >
                <q-tooltip v-if="!selectedCanSend">
                  A solicitação por texto só pode ser enviada dentro da janela de 24 horas.
                </q-tooltip>
              </q-btn>
            </div>
            <q-btn-toggle
              v-model="sendMode"
              spread
              no-caps
              unelevated
              toggle-color="positive"
              color="white"
              text-color="dark"
              :options="[
                { label: 'Mensagem rápida', value: 'quick' },
                { label: 'Usar template', value: 'template' },
              ]"
              class="composer-mode"
            />
            <div class="composer-row">
              <q-input
                v-if="sendMode === 'quick'"
                v-model="draft"
                dense
                outlined
                autogrow
                maxlength="4096"
                counter
                placeholder="Digite uma resposta"
                class="composer-input"
                :disable="!selectedCanCompose"
                @keydown.ctrl.enter="sendMessage"
              />
              <div v-else class="template-composer">
                <q-select
                  v-model="templateId"
                  dense
                  outlined
                  emit-value
                  map-options
                  :options="templateOptions"
                  label="Template oficial"
                  :disable="!selectedCanCompose"
                />
                <section
                  v-if="selectedTemplateDynamicParameters.length"
                  class="chat-template-fields"
                  aria-label="Dados deste envio"
                >
                  <div class="chat-template-fields__title">
                    <q-icon name="tune" />
                    <span>Dados deste envio</span>
                  </div>
                  <q-input
                    v-for="parameter in selectedTemplateDynamicParameters"
                    :key="parameter.key"
                    v-model="templateValues[parameter.key]"
                    dense
                    outlined
                    clearable
                    :type="isCloudTemplateMediaParameter(parameter) ? 'url' : 'text'"
                    :label="parameter.label"
                    :hint="dynamicParameterHint(parameter)"
                    :disable="!selectedCanCompose"
                    class="chat-template-fields__input"
                  >
                    <template #prepend>
                      <q-icon :name="dynamicParameterIcon(parameter)" />
                    </template>
                  </q-input>
                </section>
                <section v-if="selectedTemplate" class="chat-template-preview">
                  <div v-if="selectedTemplatePreview.mediaUrl" class="chat-template-preview__media">
                    <q-img
                      v-if="selectedTemplatePreview.mediaType === 'image'"
                      :src="selectedTemplatePreview.mediaUrl"
                      fit="cover"
                      loading="lazy"
                    />
                    <video
                      v-else-if="selectedTemplatePreview.mediaType === 'video'"
                      :src="selectedTemplatePreview.mediaUrl"
                      controls
                      preload="metadata"
                    />
                    <a v-else :href="selectedTemplatePreview.mediaUrl" target="_blank" rel="noopener noreferrer">
                      <q-icon name="description" /> Abrir documento do template
                    </a>
                  </div>
                  <strong v-if="selectedTemplatePreview.header">{{ selectedTemplatePreview.header }}</strong>
                  <p>{{ selectedTemplatePreview.body }}</p>
                  <small v-if="selectedTemplatePreview.footer">{{ selectedTemplatePreview.footer }}</small>
                  <div v-if="selectedTemplatePreview.buttons.length" class="chat-template-preview__buttons">
                    <span v-for="button in selectedTemplatePreview.buttons" :key="`${button.text}-${button.url}`">
                      <q-icon name="open_in_new" /> {{ button.text }}
                    </span>
                  </div>
                  <div class="chat-template-preview__locked">
                    <q-icon name="verified" /> Conteúdo e valores definidos no template cadastrado. Somente os campos acima variam neste envio.
                  </div>
                </section>
              </div>
              <q-btn
                round
                unelevated
                color="positive"
                icon="send"
                aria-label="Enviar mensagem"
                :loading="sending"
                :disable="!selectedCanCompose || (sendMode === 'quick' ? !draft.trim() : !templateId)"
                @click="sendMessage"
              />
            </div>
            <div v-if="!selectedCanCompose" class="composer-lock">
              <q-icon name="lock" />
              <span v-if="sendMode === 'quick'">Respostas livres bloqueadas após 24 horas.</span>
              <span v-else>Templates exigem autorização de notificações deste contato.</span>
            </div>
            <div v-else-if="sendMode === 'template'" class="composer-hint">
              <q-icon name="verified" />
              O template será validado e processado pela fila oficial da Meta.
            </div>
          </footer>
          <footer v-else class="message-composer technical-readonly-footer">
            <q-icon name="visibility" />
            <span>Evento técnico disponível somente para consulta. Nenhuma mensagem pode ser enviada e nenhum contato foi cadastrado.</span>
          </footer>
        </template>
      </section>
    </q-card>

    <ContactDialog
      v-model="contactDialog"
      :contact="contactForDialog"
      @saved="loadConversations({ background: true })"
    />
  </component>
</template>

<style scoped>
.chats-shell {
  display: grid;
  min-height: 680px;
  grid-template-columns: minmax(310px, 0.72fr) minmax(0, 1.5fr);
  overflow: hidden;
}

.chat-sidebar {
  min-width: 0;
  border-right: 1px solid rgba(3, 21, 21, 0.09);
  background: rgba(247, 254, 252, 0.68);
}

.sidebar-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 0;
}

.sidebar-title div,
.sidebar-title strong,
.sidebar-title span {
  display: block;
}

.sidebar-title span {
  color: #657976;
  font-size: 0.72rem;
}

.chat-list {
  max-height: 590px;
  overflow: auto;
}

.selected-chat {
  border-left: 3px solid #35bca4;
  background: rgba(130, 248, 230, 0.18);
}

.avatar-fallback {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  background: #dffaf4;
  color: #167c6c;
  font-weight: 800;
}

.chat-flags {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 5px;
}

.window-flag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 0.67rem;
  font-weight: 700;
}

.window-flag--open {
  color: #14836e;
}

.window-flag--closed {
  color: #93621c;
}

.chat-time {
  color: #70827f;
  font-size: 0.67rem;
}

.conversation-panel {
  display: grid;
  min-width: 0;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  background:
    radial-gradient(circle at 50% 40%, rgba(130, 248, 230, 0.11), transparent 28rem),
    rgba(241, 249, 247, 0.46);
}

.conversation-header {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 13px 18px;
  border-bottom: 1px solid rgba(3, 21, 21, 0.08);
  background: rgba(255, 255, 255, 0.72);
}

.conversation-identity {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.conversation-identity > span {
  color: #657976;
  font-size: 0.72rem;
}

.identity-flags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.mobile-back {
  display: none;
}

.service-window-banner {
  margin: 10px 16px 0;
  border: 1px solid transparent;
}

.service-window-banner strong,
.service-window-banner span {
  display: block;
}

.service-window-banner span {
  margin-top: 2px;
  font-size: 0.78rem;
}

.service-window-banner--open {
  border-color: rgba(22, 139, 116, 0.24);
  background: rgba(220, 255, 246, 0.88);
  color: #205e52;
}

.service-window-banner--closed {
  border-color: rgba(180, 115, 24, 0.26);
  background: rgba(255, 246, 224, 0.92);
  color: #6d4c1f;
}

.technical-conversation-banner {
  margin: 10px 16px 0;
  border: 1px solid rgba(180, 115, 24, 0.26);
  background: rgba(255, 248, 228, 0.94);
  color: #6d4c1f;
}

.technical-conversation-banner strong,
.technical-conversation-banner span {
  display: block;
}

.technical-conversation-banner span {
  margin-top: 3px;
  font-size: 0.78rem;
}

.message-stream {
  max-height: 490px;
  padding: 24px;
  overflow: auto;
  overscroll-behavior: contain;
}

.chat-history-progress {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 30px;
  margin-bottom: 8px;
  color: #52726d;
  font-size: 0.7rem;
}

.chat-history-progress--hint {
  opacity: 0.72;
}

.day-note {
  width: fit-content;
  margin: 0 auto 18px;
  padding: 6px 11px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.85);
  color: #6b7f7c;
  font-size: 0.7rem;
}

.message-row {
  display: flex;
  justify-content: flex-start;
  margin: 7px 0;
}

.message-row--mine {
  justify-content: flex-end;
}

.message-bubble {
  max-width: min(72%, 620px);
  padding: 10px 12px 7px;
  overflow-wrap: anywhere;
  border-radius: 5px 15px 15px;
  background: #fff;
  box-shadow: 0 4px 14px rgba(3, 62, 55, 0.07);
  line-height: 1.45;
  white-space: pre-wrap;
}

.message-row--mine .message-bubble {
  border-radius: 15px 5px 15px 15px;
  background: #d8fff7;
}

.technical-message-content {
  display: grid;
  gap: 7px;
  min-width: min(420px, 62vw);
}

.technical-message-content__heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  color: #6d4c1f;
}

.technical-message-content p,
.technical-message-content small {
  margin: 0;
  white-space: pre-wrap;
}

.technical-message-content small {
  color: #6d6352;
}

.message-meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 3px;
  margin-top: 3px;
  color: #72837f;
  font-size: 0.62rem;
}

.template-message-identifier {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: #187461;
}

.template-message-identifier code {
  min-width: 0;
  overflow: hidden;
  color: inherit;
  font-family: inherit;
  font-size: 0.68rem;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-message-identifier small {
  margin-left: auto;
  color: #71837f;
  font-size: 0.58rem;
}

.template-message-content {
  display: grid;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(11, 108, 91, 0.11);
}

.template-message-media {
  min-width: 0;
  overflow: hidden;
  border-radius: 10px;
  background: rgba(229, 242, 239, 0.82);
}

.template-message-media :deep(.q-img),
.template-message-media video {
  display: block;
  width: 100%;
  max-height: 320px;
  object-fit: cover;
}

.template-message-document {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 54px;
  padding: 10px 12px;
  color: #176e60;
  text-decoration: none;
}

.template-message-document span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-message-header {
  color: #153c35;
  font-size: 0.94rem;
  font-weight: 750;
  overflow-wrap: anywhere;
}

.template-message-body {
  color: #173b35;
  line-height: 1.48;
  overflow-wrap: anywhere;
}

.template-message-body :deep(code),
.template-message-header :deep(code),
.template-message-footer :deep(code) {
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(6, 50, 43, 0.08);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.template-message-footer {
  color: #70807d;
  font-size: 0.7rem;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.template-message-buttons {
  display: grid;
  gap: 1px;
  margin: 2px -12px -7px;
  border-top: 1px solid rgba(11, 108, 91, 0.1);
}

.template-message-buttons a,
.template-message-buttons > span {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 42px;
  padding: 8px 12px;
  border-top: 1px solid rgba(11, 108, 91, 0.08);
  color: #16816c;
  font-size: 0.78rem;
  font-weight: 750;
  text-align: center;
  text-decoration: none;
}

.template-message-buttons > :first-child {
  border-top: 0;
}

.message-composer {
  padding: 10px 16px 12px;
  border-top: 1px solid rgba(3, 21, 21, 0.08);
  background: rgba(255, 255, 255, 0.78);
}

.technical-readonly-footer {
  display: flex;
  align-items: center;
  gap: 9px;
  color: #665d4d;
  font-size: 0.78rem;
}

.consent-callout {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 9px;
  padding: 9px 11px;
  border-radius: 12px;
  background: #f5f8f7;
  color: #516965;
  font-size: 0.76rem;
}

.consent-callout > div {
  display: flex;
  align-items: flex-start;
  gap: 7px;
}

.consent-callout code {
  color: #167c6c;
  font-weight: 700;
}

.composer-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}

.composer-mode {
  margin-bottom: 9px;
}

.composer-input {
  min-width: 0;
  flex: 1;
}

.template-composer {
  display: grid;
  min-width: 0;
  flex: 1;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.template-composer > :first-child {
  grid-column: 1 / -1;
}

.chat-template-fields {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 11px;
  border: 1px solid rgba(22, 130, 109, 0.14);
  border-radius: 13px;
  background: rgba(239, 251, 247, 0.8);
}

.chat-template-fields__title {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  gap: 6px;
  color: #176e60;
  font-size: 0.76rem;
  font-weight: 800;
}

.chat-template-fields__input {
  min-width: 0;
}

.chat-template-preview {
  display: grid;
  grid-column: 1 / -1;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border: 1px solid rgba(22, 130, 109, 0.16);
  border-radius: 13px;
  background: linear-gradient(145deg, rgba(247, 253, 251, 0.98), rgba(226, 248, 242, 0.65));
  color: #173f37;
  overflow: hidden;
}

.chat-template-preview > p {
  margin: 0;
  line-height: 1.45;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.chat-template-preview > small {
  color: #697d79;
  overflow-wrap: anywhere;
}

.chat-template-preview__media :deep(.q-img),
.chat-template-preview__media video {
  display: block;
  width: 100%;
  max-height: 220px;
  border-radius: 10px;
  background: #dfebe8;
  object-fit: contain;
}

.chat-template-preview__media a {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 42px;
  padding: 9px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.78);
  color: #176e60;
  font-weight: 700;
  text-decoration: none;
}

.chat-template-preview__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chat-template-preview__buttons span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  border: 1px solid rgba(22, 130, 109, 0.16);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.74);
  color: #176e60;
  font-size: 0.7rem;
  font-weight: 700;
}

.chat-template-preview__locked {
  display: flex;
  align-items: center;
  gap: 5px;
  padding-top: 7px;
  border-top: 1px solid rgba(22, 130, 109, 0.12);
  color: #58716c;
  font-size: 0.7rem;
}

.composer-lock {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
  color: #93621c;
  font-size: 0.72rem;
}

.composer-hint {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
  color: #16826d;
  font-size: 0.72rem;
}

.embedded-chats {
  min-width: 0;
}

@media (max-width: 850px) {
  .chats-shell {
    display: block;
    min-height: 620px;
  }

  .chat-sidebar {
    border: 0;
  }

  .chat-list {
    max-height: 590px;
  }

  .conversation-panel {
    display: none;
    min-height: 620px;
  }

  .chats-shell--conversation-mobile .chat-sidebar {
    display: none;
  }

  .chats-shell--conversation-mobile .conversation-panel {
    display: grid;
  }

  .mobile-back {
    display: inline-flex;
  }

  .conversation-header {
    padding-inline: 10px;
  }

  .conversation-identity {
    max-width: calc(100% - 150px);
  }

  .message-bubble {
    max-width: 88%;
  }

  .message-stream {
    min-height: 350px;
    padding: 18px 12px;
  }

  .consent-callout {
    align-items: stretch;
    flex-direction: column;
  }

  .consent-callout .q-btn {
    width: 100%;
  }

  .template-composer {
    grid-template-columns: 1fr;
  }

  .template-composer > :first-child {
    grid-column: auto;
  }

  .chat-template-fields {
    grid-template-columns: 1fr;
  }

  .chat-template-fields__title {
    grid-column: auto;
  }
}

@media (max-width: 430px) {
  .conversation-header {
    gap: 8px;
  }

  .conversation-header > .q-avatar {
    width: 38px !important;
    min-width: 38px;
    height: 38px !important;
  }

  .conversation-header > .q-btn:not(.mobile-back) {
    width: 34px;
    min-width: 34px;
    height: 34px;
  }

  .identity-flags .q-badge {
    max-width: 58vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .message-composer {
    padding-inline: 10px;
  }
}
</style>
