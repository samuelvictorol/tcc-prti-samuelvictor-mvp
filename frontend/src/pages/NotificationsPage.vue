<script>
const AUTOMATIC_CONTACT_VARIABLES = new Set(['displayName', 'email', 'phone', 'telegramUsername'])

const BUILTIN_WHATSAPP_FIXED_VALUES = Object.freeze({
  order_confirmation: Object.freeze({
    customerName: 'John Doe',
    orderNumber: '123456',
    orderDate: 'Jul 20, 2026',
  }),
})

function meaningfulNotificationValue(value) {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (typeof value === 'number') return Number.isFinite(value)
  return typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
}

export function notificationTemplateVariableDefinitions(template = {}, channel = '') {
  const normalizedChannel = String(channel || '').replaceAll('-', '_')
  const definitions = new Map()
  const add = (raw, fallback = {}) => {
    const key = String(typeof raw === 'string' ? raw : raw?.key || raw?.name || '').trim()
    if (!key || AUTOMATIC_CONTACT_VARIABLES.has(key)) return
    const source = typeof raw === 'object' && raw ? raw : {}
    const existing = definitions.get(key) || {}
    definitions.set(key, {
      key,
      label: source.label || existing.label || fallback.label || key,
      type: source.type || existing.type || fallback.type || 'text',
      example: source.example ?? existing.example ?? fallback.example ?? '',
      mediaSource: source.mediaSource || existing.mediaSource || fallback.mediaSource || '',
      mediaAssetId: source.mediaAssetId || existing.mediaAssetId || fallback.mediaAssetId || '',
      componentType: source.componentType || existing.componentType || fallback.componentType || '',
      parameterName: source.parameterName || existing.parameterName || fallback.parameterName || '',
      channels: [...new Set([...(existing.channels || []), channel].filter(Boolean))],
    })
  }

  if (normalizedChannel === 'whatsapp_cloud') {
    for (const component of template.payload?.builder?.components || []) {
      for (const parameter of component.parameters || []) {
        if (meaningfulNotificationValue(parameter.fixedValue)) continue
        add(parameter, {
          label: parameter.label,
          type: parameter.type,
          example: parameter.example,
          mediaSource: parameter.mediaSource,
          mediaAssetId: parameter.mediaAssetId,
          componentType: component.type,
          parameterName: parameter.parameterName,
        })
      }
    }
    return [...definitions.values()]
  }

  const declared = Array.isArray(template.variables)
    ? template.variables
    : String(template.variables || '').split(',').map((item) => item.trim()).filter(Boolean)
  declared.forEach((item) => add(item))

  const content = [template.subject, template.body, template.html]
    .filter((item) => typeof item === 'string')
    .join('\n')
  for (const match of content.matchAll(/{{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}/g)) add(match[1])

  for (const component of template.payload?.builder?.components || []) {
    for (const parameter of component.parameters || []) {
      add(parameter, {
        label: parameter.label,
        type: parameter.type,
        example: parameter.example,
        mediaSource: parameter.mediaSource,
        mediaAssetId: parameter.mediaAssetId,
      })
    }
  }
  return [...definitions.values()]
}

function notificationReferenceId(value) {
  return value?._id || value?.id || value || null
}

function notificationReferenceName(value) {
  if (!value || typeof value !== 'object') return ''
  return String(value.name || value.title || '').trim()
}

export function notificationActivityName(notification = {}, templates = [], templateSets = []) {
  const setId = notificationReferenceId(notification.templateSet)
  const set = templateSets.find((item) => String(notificationReferenceId(item)) === String(setId))
  const setName = notificationReferenceName(notification.templateSet) || notificationReferenceName(set)
  if (setName) return setName

  const templateId = notificationReferenceId(notification.template)
  const template = templates.find((item) => String(notificationReferenceId(item)) === String(templateId))
  const templateName = notificationReferenceName(notification.template) || notificationReferenceName(template)
  if (templateName) return templateName

  const selectedTemplateNames = Object.values(notification.templates || {})
    .map((reference) => {
      const id = notificationReferenceId(reference)
      const selected = templates.find((item) => String(notificationReferenceId(item)) === String(id))
      return notificationReferenceName(reference) || notificationReferenceName(selected)
    })
    .filter(Boolean)
  if (selectedTemplateNames.length) return [...new Set(selectedTemplateNames)].join(' · ')

  const providerTemplateName = String(
    notification.content?.templateName
    || notification.content?.externalTemplateName
    || notification.content?.customTemplate?.name
    || '',
  ).trim()
  if (providerTemplateName) return providerTemplateName
  if (notification.kind === 'quick') return 'Mensagem rápida'
  return 'Template não identificado'
}

export function notificationActivityType(notification = {}) {
  if (notificationReferenceId(notification.templateSet)) return 'Conjunto'

  const kind = String(notification.kind || notification.mode || notification.type || '').toLowerCase()
  if (kind === 'quick') return 'Rápida'
  return 'Template'
}

export function mergeNotificationVariableDefinitions(entries = []) {
  const merged = new Map()
  for (const { template, channel } of entries) {
    for (const definition of notificationTemplateVariableDefinitions(template, channel)) {
      const existing = merged.get(definition.key)
      merged.set(definition.key, existing ? {
        ...existing,
        channels: [...new Set([...(existing.channels || []), ...(definition.channels || [])])],
      } : definition)
    }
  }
  return [...merged.values()]
}

export function notificationRuntimeVariableValues(definitions = [], values = {}) {
  return Object.fromEntries(definitions
    .map((definition) => [definition.key, values[definition.key]])
    .filter(([, value]) => meaningfulNotificationValue(value)))
}

export function notificationVariableScopeKey(selection = {}) {
  const templateIds = Object.fromEntries(Object.entries(selection.templateIds || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([channel, id]) => [channel, String(id || '')]))
  return JSON.stringify({
    tab: String(selection.tab || ''),
    channel: String(selection.channel || ''),
    templateId: String(selection.templateId || ''),
    globalSelectionMode: String(selection.globalSelectionMode || ''),
    templateSetId: String(selection.templateSetId || ''),
    templateIds,
  })
}

function previewPlainText(value = '') {
  return String(value || '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/\n\s+/g, '\n')
    .trim()
}

function previewInterpolate(value, variables = {}) {
  return String(value || '').replace(/{{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}/g, (placeholder, key) => {
    const replacement = variables[key]
    return replacement === undefined || replacement === null || String(replacement).trim() === ''
      ? placeholder
      : String(replacement)
  })
}

function whatsappPreset(template = {}) {
  if (template.whatsappCloudPreset) return template.whatsappCloudPreset
  if (template.externalTemplateName === 'jaspers_market_order_confirmation_v1') return 'order_confirmation'
  if (template.externalTemplateName === 'jaspers_market_plain_text_v1') return 'plain_text'
  if (template.externalTemplateName === 'hello_world') return 'hello_world'
  return null
}

function parameterFixedValue(parameter = {}) {
  return parameter.fixedValue
}

function whatsappParameterValue(parameter = {}, variables = {}) {
  const fixedValue = parameterFixedValue(parameter)
  if (meaningfulNotificationValue(fixedValue)) return fixedValue
  for (const key of [parameter.key, parameter.parameterName]) {
    if (key && meaningfulNotificationValue(variables[key])) return variables[key]
  }
  return fixedValue
}

export function notificationWhatsAppFixedValues(template = {}) {
  const values = { ...(BUILTIN_WHATSAPP_FIXED_VALUES[whatsappPreset(template)] || {}) }
  for (const component of template.payload?.builder?.components || []) {
    for (const parameter of component.parameters || []) {
      const key = String(parameter.key || '').trim()
      const value = parameterFixedValue(parameter)
      if (!key || value === undefined || value === null || value === '') continue
      values[key] = value
      if (parameter.parameterName) values[parameter.parameterName] = value
    }
  }
  return values
}

function whatsappComponentText(component = {}, variables = {}) {
  let value = previewInterpolate(component.text || '', variables)
  for (const [index, parameter] of (component.parameters || []).entries()) {
    const parameterValue = whatsappParameterValue(parameter, variables)
    if (!meaningfulNotificationValue(parameterValue)) continue
    const printable = typeof parameterValue === 'object'
      ? parameterValue.text || parameterValue.link || parameterValue.id || ''
      : parameterValue
    value = value.replaceAll(`{{${index + 1}}}`, String(printable))
    for (const name of [parameter.key, parameter.parameterName].filter(Boolean)) {
      value = value.replaceAll(`{{${name}}}`, String(printable))
    }
  }
  return previewPlainText(value)
}

function whatsappComponentUrl(component = {}, variables = {}) {
  let value = previewInterpolate(component.url || '', variables)
  for (const [index, parameter] of (component.parameters || []).entries()) {
    const parameterValue = whatsappParameterValue(parameter, variables)
    if (!meaningfulNotificationValue(parameterValue)) continue
    const printable = typeof parameterValue === 'object'
      ? parameterValue.text || parameterValue.link || parameterValue.id || ''
      : parameterValue
    value = value.replaceAll(`{{${index + 1}}}`, String(printable))
    for (const name of [parameter.key, parameter.parameterName].filter(Boolean)) {
      value = value.replaceAll(`{{${name}}}`, String(printable))
    }
  }
  return value
}

function whatsappMediaPreview(builderComponents = [], variables = {}) {
  const header = builderComponents.find((component) => component.type === 'header')
  const parameter = header?.parameters?.find((item) => ['image', 'video', 'document'].includes(item.type))
  if (!parameter) return { mediaType: '', mediaUrl: '' }
  const parameterValue = whatsappParameterValue(parameter, variables)
  const mediaUrl = typeof parameterValue === 'object'
    ? parameterValue.link || parameterValue.url || ''
    : parameterValue
  return { mediaType: parameter.type, mediaUrl: String(mediaUrl || '') }
}

export function notificationTemplatePreview(template = {}, channel = '', variables = {}) {
  const normalizedChannel = String(channel || '').replaceAll('-', '_')
  const whatsappValues = normalizedChannel === 'whatsapp_cloud'
    ? { ...variables, ...notificationWhatsAppFixedValues(template) }
    : variables
  const builderComponents = template.payload?.builder?.components || []
  const bodyComponent = builderComponents.find((component) => component.type === 'body')
  const footerComponent = builderComponents.find((component) => component.type === 'footer')
  const headerComponent = builderComponents.find((component) => component.type === 'header')
  const buttonComponents = builderComponents.filter((component) => component.type === 'button')
  const telegramDefinition = template.payload?.telegram
  const telegramText = telegramDefinition?.text || telegramDefinition?.caption
  const rawBody = channel === 'telegram'
    ? (telegramText || template.body)
    : channel === 'email'
      ? (template.html || template.body)
      : (bodyComponent?.text || template.body)
  const body = normalizedChannel === 'whatsapp_cloud' && bodyComponent?.text
    ? whatsappComponentText(bodyComponent, whatsappValues)
    : previewInterpolate(previewPlainText(rawBody), whatsappValues)
  const subject = channel === 'email'
    ? previewInterpolate(previewPlainText(template.subject || 'Sem assunto'), variables)
    : ''
  const officialName = channel === 'whatsapp_cloud'
    ? String(template.externalTemplateName || template.name || '').trim()
    : ''
  const whatsappMedia = normalizedChannel === 'whatsapp_cloud'
    ? whatsappMediaPreview(builderComponents, whatsappValues)
    : { mediaType: '', mediaUrl: '' }
  return {
    body: body || (channel === 'whatsapp_cloud'
      ? 'A prévia textual não foi informada; o payload usará os componentes cadastrados neste template.'
      : 'Este template não possui uma prévia textual.'),
    subject,
    officialName,
    languageCode: channel === 'whatsapp_cloud' ? String(template.languageCode || 'pt_BR') : '',
    html: channel === 'email' && template.html
      ? previewInterpolate(String(template.html), variables)
      : '',
    mediaType: normalizedChannel === 'whatsapp_cloud'
      ? whatsappMedia.mediaType
      : channel === 'telegram' && ['photo', 'video'].includes(telegramDefinition?.kind)
        ? telegramDefinition.kind
        : '',
    mediaUrl: channel === 'telegram' && ['photo', 'video'].includes(telegramDefinition?.kind)
      ? String(telegramDefinition.mediaUrl || '')
      : whatsappMedia.mediaUrl,
    header: normalizedChannel === 'whatsapp_cloud'
      ? whatsappComponentText(headerComponent, whatsappValues)
      : '',
    footer: normalizedChannel === 'whatsapp_cloud'
      ? whatsappComponentText(footerComponent, whatsappValues)
      : '',
    buttons: normalizedChannel === 'whatsapp_cloud'
      ? buttonComponents.map((component) => ({
          text: whatsappComponentText(component, whatsappValues) || 'Ação',
          url: whatsappComponentUrl(component, whatsappValues),
        }))
      : [],
  }
}

export function notificationGlobalChannelOptions(channels = [], templateIds = {}, selectionMode = 'manual') {
  const source = selectionMode === 'set'
    ? channels
    : channels.filter((channel) => channel.enabled)
  return source.filter((channel) => Boolean(templateIds?.[channel.value]))
}

export function notificationDeliveryDetail(delivery = {}) {
  const status = String(delivery.status || '').toLowerCase()
  if (delivery.errorMessage) return delivery.errorMessage
  if (status === 'read') return 'Mensagem lida pelo contato'
  if (status === 'delivered') return 'Mensagem entregue ao contato'
  if (status === 'sent') return 'Envio aceito pelo provedor'
  if (status === 'processing') return 'Entrega em processamento'
  if (status === 'queued') return 'Entrega aguardando processamento'
  if (status === 'skipped') return 'Contato ignorado pelas regras de elegibilidade do canal'
  if (status === 'failed') return 'O provedor não concluiu esta entrega'
  return 'Aguardando atualização da fila'
}

function metaProviderCode(item = {}) {
  const rawCode = item.providerCode
    || item.metaCode
    || item.errorCode
    || item.code
    || item.lastError?.code
    || item.error?.code
    || ''
  const match = String(rawCode).toUpperCase().match(/(?:META[_\s-]*)?(\d{5,})/)
  return match ? `META_${match[1]}` : ''
}

export function isExternalMetaDeliveryBlock(item = {}) {
  const rawCode = String(item.providerCode || item.metaCode || item.errorCode || item.code || item.lastError?.code || item.error?.code || '').toUpperCase()
  const provider = String(item.provider || item.errorProvider || item.source || item.lastError?.provider || '').toLowerCase()
  const channel = String(item.channel || item.lastError?.channel || '').replaceAll('-', '_').toLowerCase()
  const code = metaProviderCode(item)
  const explicitlyExternal = item.external === true || item.isProviderError === true || item.errorScope === 'provider'
  return Boolean(code)
    && (rawCode.startsWith('META_') || provider.includes('meta') || explicitlyExternal)
    && (!channel || channel === 'whatsapp_cloud' || channel === 'whatsapp')
}

function metaBlockDeliveryIds(item = {}) {
  const source = item.deliveryIds
    || item.retryableDeliveryIds
    || item.deliveries
    || item.items
    || []
  const values = Array.isArray(source) ? source : [source]
  const ids = values.filter((value) => {
    if (typeof value !== 'object' || !value) return true
    if (value.retryable === false || value.manualRetryAvailable === false) return false
    if (value.automaticRetryAttempts !== undefined) {
      return String(value.status || '').toLowerCase() === 'failed'
        && Number(value.automaticRetryAttempts || 0) >= 1
    }
    return true
  }).map((value) => (
    typeof value === 'object' && value
      ? value.deliveryId || value.id || value._id
      : value
  )).filter(Boolean).map(String)
  const ownId = item.deliveryId
    || item.latestDeliveryId
    || (!values.length && !item.groupId && !item.groupKey ? item.id || item._id : '')
  if (ownId) ids.push(String(ownId))
  return [...new Set(ids)]
}

function metaBlockContacts(item = {}) {
  const source = item.contacts || item.affectedContacts || item.deliveries || item.items
  const entries = Array.isArray(source) && source.length ? source : [item]
  return entries
    .map((entry) => {
      const contact = entry?.contact || entry || {}
      const id = contact.id || contact._id || entry?.contactId || ''
      const name = contact.displayName || contact.name || contact.email || contact.phone || entry?.contactName || ''
      return id || name ? { id: String(id || name), name: String(name || 'Contato não identificado') } : null
    })
    .filter(Boolean)
}

function metaBlockDeliveryRows(items = []) {
  return items.flatMap((item) => {
    const nested = item.deliveries || item.items
    const entries = Array.isArray(nested) && nested.length ? nested : [item]
    return entries.map((entry, index) => {
      const contact = entry.contact || {}
      return {
        id: String(entry.deliveryId || entry.id || entry._id || `${metaProviderCode(entry) || 'meta'}-${index}`),
        notificationId: String(entry.notificationId || entry.dispatchId || entry.campaignId || ''),
        contactId: String(entry.contactId || contact.id || contact._id || ''),
        contactName: String(entry.contactName || contact.displayName || contact.name || contact.email || contact.phone || 'Contato não identificado'),
        status: String(entry.status || 'failed').toLowerCase(),
        attempts: Number(entry.attempts ?? entry.attemptCount ?? 1) || 0,
        automaticRetryAt: entry.automaticRetryAt || entry.autoRetryAt || entry.nextRetryAt || entry.scheduledAt || entry.retryNotBefore || entry.automaticRetryScheduledAt || null,
        automaticRetryStatus: String(entry.automaticRetryStatus || entry.autoRetryStatus || entry.retryStatus || '').toLowerCase(),
        automaticRetryAttempted: Boolean(entry.automaticRetryAttempted || entry.autoRetryAttempted || entry.autoRetryCount > 0 || entry.automaticRetryAttempts > 0 || entry.automaticRetryAttemptedAt),
        detail: entry.message || entry.errorMessage || entry.lastError?.message || item.message || item.errorMessage || 'Bloqueio temporário informado pela Meta.',
        updatedAt: entry.updatedAt || entry.lastOccurredAt || entry.failureAt || entry.createdAt || item.latestAt || null,
        retryable: entry.retryable !== false
          && entry.manualRetryAvailable !== false
          && (entry.automaticRetryAttempts === undefined || (String(entry.status || '').toLowerCase() === 'failed' && Number(entry.automaticRetryAttempts || 0) >= 1)),
      }
    })
  })
}

export function normalizeMetaDeliveryBlocks(payload = {}) {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload.blocks)
        ? payload.blocks
        : Array.isArray(payload.groups)
          ? payload.groups
          : []
  const grouped = new Map()

  for (const item of source) {
    if (!isExternalMetaDeliveryBlock(item)) continue
    const code = metaProviderCode(item)
    const category = String(item.category || item.errorCategory || item.reason || 'delivery_policy').toLowerCase()
    const key = item.groupKey || `${code}:${category}`
    const existing = grouped.get(key) || {
      id: String(item.groupId || key),
      groupKey: key,
      code,
      category,
      message: item.message || item.errorMessage || item.lastError?.message || 'Entrega bloqueada temporariamente pela Meta.',
      deliveryCount: 0,
      contactCount: 0,
      deliveryIds: [],
      contacts: [],
      automaticRetryAt: null,
      automaticRetryStatus: 'not_scheduled',
      automaticRetryAttempted: false,
      retryable: true,
      updatedAt: null,
      rawItems: [],
    }
    const contacts = metaBlockContacts(item)
    const itemDeliveryCount = Number(item.deliveryCount ?? item.affectedDeliveries ?? item.occurrences ?? item.totalDeliveries ?? item.total ?? 1) || 1
    const itemContactCount = Number(item.contactCount ?? item.affectedContacts ?? item.uniqueContacts ?? item.totalContacts ?? contacts.length ?? 0) || 0
    existing.deliveryCount += itemDeliveryCount
    existing.contactCount += itemContactCount
    existing.deliveryIds.push(...metaBlockDeliveryIds(item))
    existing.contacts.push(...contacts)
    existing.rawItems.push(item)

    const deliveryRetryDates = (Array.isArray(item.deliveries) ? item.deliveries : [])
      .map((delivery) => delivery.retryNotBefore || delivery.automaticRetryScheduledAt)
      .filter(Boolean)
      .sort((left, right) => new Date(left) - new Date(right))
    const automaticRetryAt = item.automaticRetryAt || item.autoRetryAt || item.nextRetryAt || item.scheduledAt || deliveryRetryDates[0]
    if (automaticRetryAt && (!existing.automaticRetryAt || new Date(automaticRetryAt) < new Date(existing.automaticRetryAt))) {
      existing.automaticRetryAt = automaticRetryAt
    }
    const autoStatus = item.automaticRetryStatus
      || item.autoRetryStatus
      || item.retryStatus
      || (Number(item.pendingAutomaticRetry || 0) > 0 ? 'scheduled' : Number(item.automaticRetryAttempted || 0) > 0 ? 'failed' : '')
    if (autoStatus) existing.automaticRetryStatus = String(autoStatus).toLowerCase()
    existing.automaticRetryAttempted ||= Boolean(Number(item.automaticRetryAttempted || 0) > 0 || item.autoRetryAttempted || item.autoRetryCount > 0)
    existing.retryable &&= item.retryable !== false
      && item.manualRetryAvailable !== false
      && (item.currentFailures === undefined || (Number(item.currentFailures || 0) > 0 && Number(item.automaticRetryAttempted || 0) > 0))
    const updatedAt = item.updatedAt || item.lastOccurredAt || item.latestAt || item.createdAt
    if (updatedAt && (!existing.updatedAt || new Date(updatedAt) > new Date(existing.updatedAt))) existing.updatedAt = updatedAt
    grouped.set(key, existing)
  }

  return [...grouped.values()].map((item) => {
    item.deliveryIds = [...new Set(item.deliveryIds)]
    item.contacts = [...new Map(item.contacts.map((contact) => [contact.id, contact])).values()]
    item.deliveries = metaBlockDeliveryRows(item.rawItems)
    item.deliveryCount = Math.max(item.deliveryCount, item.deliveryIds.length)
    item.contactCount = Math.max(item.contactCount, item.contacts.length)
    return item
  })
}
</script>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import DOMPurify from 'dompurify'
import { useQuasar } from 'quasar'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import { useAppStore } from '../stores/app.js'
import { notificationChannel, notificationDeliveryCounts } from '../services/channels.js'
import { asList, errorMessage, fetchAll, http, unwrap } from '../services/http.js'
import { normalizeDeliveryPage } from '../services/bulk-notifications.js'
import {
  templateSetChannels,
  templateSetId,
  templateSetTemplateIds,
} from '../services/template-sets.js'

const $q = useQuasar()
const app = useAppStore()
const tab = ref('global')
const loading = ref(false)
const sending = ref(false)
const reviewDialog = ref(false)
const pendingPayload = ref(null)
const contacts = ref([])
const groups = ref([])
const templates = ref([])
const templateSets = ref([])
const deliveries = ref([])
const globalSelectionMode = ref('set')
const dispatchDetailDialog = ref(false)
const dispatchDetailLoading = ref(false)
const selectedDispatch = ref(null)
const dispatchDetailRows = ref([])
const dispatchDetailChannel = ref(null)
const dispatchDetailStatus = ref(null)
const dispatchDetailPagination = ref({
  page: 1,
  rowsPerPage: 15,
  rowsNumber: 0,
})
const metaBlocks = ref([])
const metaBlocksLoading = ref(false)
const metaBlockRetryingIds = ref([])
const metaBlockDetailDialog = ref(false)
const selectedMetaBlock = ref(null)
const metaRetryConfirmDialog = ref(false)
const pendingMetaRetryBlock = ref(null)
let dispatchDetailRequestSequence = 0

const form = reactive({
  contactIds: [],
  groupIds: [],
  channel: null,
  message: '',
  subject: '',
  templateId: null,
  templateSetId: null,
  templateIds: { telegram: null, whatsapp_cloud: null, email: null },
  variables: {},
})

const channels = computed(() => [
  { label: 'Telegram', value: 'telegram', icon: 'send_to_mobile', enabled: app.isChannelEnabled('telegram') },
  { label: 'WhatsApp Cloud', value: 'whatsapp_cloud', icon: 'cloud_sync', enabled: app.isChannelEnabled('whatsappCloud') },
  { label: 'Email', value: 'email', icon: 'mail', enabled: app.isChannelEnabled('email') },
])

const enabledChannelOptions = computed(() => channels.value.filter((channel) => channel.enabled))
const quickEnabledChannelOptions = computed(() => enabledChannelOptions.value.filter((channel) => channel.value !== 'whatsapp_cloud'))
const templateEnabledChannelOptions = computed(() => enabledChannelOptions.value)
const dispatchChannelOptions = computed(() => tab.value === 'quick'
  ? quickEnabledChannelOptions.value
  : tab.value === 'template'
    ? templateEnabledChannelOptions.value
    : enabledChannelOptions.value)
const contactOptions = computed(() => contacts.value.map((item) => ({
  label: item.displayName || item.name || item.email || item.phone || item.telegramUsername || 'Contato sem nome',
  value: item.id || item._id,
})))
const groupOptions = computed(() => groups.value.map((item) => ({ label: item.name, value: item.id || item._id })))
const templateSetOptions = computed(() => templateSets.value.map((set) => ({
  label: set.name,
  description: set.description || `${templateSetChannels(set).length} canal(is)`,
  invite: set.invite?.title || set.invite?.slug || '',
  channels: templateSetChannels(set),
  value: templateSetId(set),
})))
const templateOptions = computed(() => templates.value
  .filter((template) => {
    if (!form.channel) return true
    const channel = String(template.channel || template.type || '').replaceAll('-', '_')
    return template.active !== false && form.channel === channel
  })
  .map((item) => ({
    label: `${item.name || item.title} · ${item.channel || item.type}`,
    value: item.id || item._id,
  })))

function templatesForChannel(channel) {
  return templates.value
    .filter((template) => template.active !== false && String(template.channel || template.type || '').replaceAll('-', '_') === channel)
    .map((template) => ({
      label: template.name || template.title || 'Template sem nome',
      description: template.description || template.subject || String(template.body || '').slice(0, 90),
      value: template.id || template._id,
    }))
}

function templateById(id) {
  return templates.value.find((template) => String(template.id || template._id) === String(id)) || null
}

function templateSetById(id) {
  return templateSets.value.find((set) => String(templateSetId(set)) === String(id)) || null
}

const selectedTemplate = computed(() => templateById(form.templateId))
const selectedTemplateSet = computed(() => templateSetById(form.templateSetId))
const selectedTemplateSetIds = computed(() => templateSetTemplateIds(selectedTemplateSet.value || {}))
const activeGlobalTemplateIds = computed(() => (
  globalSelectionMode.value === 'set'
    ? selectedTemplateSetIds.value
    : form.templateIds
))
const selectedGlobalChannelOptions = computed(() => notificationGlobalChannelOptions(
  channels.value,
  activeGlobalTemplateIds.value,
  globalSelectionMode.value,
))
const unavailableGlobalChannelOptions = computed(() => selectedGlobalChannelOptions.value
  .filter((channel) => !channel.enabled))

const activeTemplateEntries = computed(() => {
  if (tab.value === 'template') {
    return selectedTemplate.value && form.channel
      ? [{ template: selectedTemplate.value, channel: form.channel }]
      : []
  }
  if (tab.value !== 'global') return []
  return selectedGlobalChannelOptions.value
    .map((channel) => ({
      channel: channel.value,
      template: templateById(activeGlobalTemplateIds.value[channel.value]),
    }))
    .filter((entry) => entry.template)
})

const activeVariableDefinitions = computed(() => mergeNotificationVariableDefinitions(activeTemplateEntries.value))
const activeVariableScopeKey = computed(() => notificationVariableScopeKey({
  tab: tab.value,
  channel: form.channel,
  templateId: form.templateId,
  globalSelectionMode: globalSelectionMode.value,
  templateSetId: form.templateSetId,
  templateIds: form.templateIds,
}))
const missingVariableDefinitions = computed(() => activeVariableDefinitions.value.filter(
  (definition) => !meaningfulNotificationValue(form.variables[definition.key]),
))

function variableHint(definition = {}) {
  const channels = (definition.channels || []).map((channel) => channelLabel(channel)).join(', ')
  const example = definition.example ? `Exemplo: ${definition.example}` : ''
  return [channels ? `Usado em ${channels}` : '', example].filter(Boolean).join(' · ')
}

function variableIcon(definition = {}) {
  if (['image', 'video', 'document'].includes(definition.type)) return 'link'
  if (definition.componentType === 'button') return 'ads_click'
  return 'data_object'
}

const selectedRecipients = computed(() => form.contactIds.length + form.groupIds.length)
const reviewItems = computed(() => {
  if (tab.value === 'quick') {
    const channel = channels.value.find((item) => item.value === form.channel)
    if (!channel) return []
    return [{
      ...channel,
      templateName: 'Mensagem rápida',
      preview: {
        subject: form.channel === 'email' ? form.subject || 'Sem assunto' : '',
        body: form.message.trim(),
      },
    }]
  }
  if (tab.value === 'template') {
    const channel = channels.value.find((item) => item.value === form.channel)
    if (!channel || !selectedTemplate.value) return []
    return [{
      ...channel,
      templateName: selectedTemplate.value.name || selectedTemplate.value.title || 'Template',
      preview: notificationTemplatePreview(selectedTemplate.value, form.channel, form.variables),
    }]
  }
  return selectedGlobalChannelOptions.value.map((channel) => {
    const template = templateById(activeGlobalTemplateIds.value[channel.value])
    return {
      ...channel,
      templateName: template?.name || template?.title || 'Template',
      preview: notificationTemplatePreview(template, channel.value, form.variables),
    }
  })
})

function safeReviewHtml(value) {
  return DOMPurify.sanitize(String(value || ''), { USE_PROFILES: { html: true } })
}

function newIdempotencyKey(prefix) {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${value}`
}

watch([dispatchChannelOptions, tab], ([options, currentTab]) => {
  if (currentTab === 'global') return
  if (!options.some((channel) => channel.value === form.channel)) form.channel = options[0]?.value || null
})

watch(() => form.channel, () => {
  if (tab.value === 'template' && !templateOptions.value.some((option) => option.value === form.templateId)) {
    form.templateId = null
  }
})

watch(activeVariableScopeKey, () => {
  form.variables = {}
})

watch(activeVariableDefinitions, (definitions) => {
  form.variables = notificationRuntimeVariableValues(definitions, form.variables)
}, { deep: true })

const deliveryColumns = [
  { name: 'createdAt', label: 'Quando', field: 'createdAt', align: 'left' },
  { name: 'mode', label: 'Tipo', field: 'mode', align: 'left' },
  { name: 'channel', label: 'Canal', field: 'channel', align: 'left' },
  { name: 'contentName', label: 'Conjunto / template', field: 'contentName', align: 'left' },
  { name: 'status', label: 'Status', field: 'status', align: 'left' },
  { name: 'actions', label: '', field: 'actions', align: 'right' },
]

function activityName(notification) {
  return notificationActivityName(notification, templates.value, templateSets.value)
}

function activityType(notification) {
  return notificationActivityType(notification)
}

const dispatchDetailColumns = [
  { name: 'contact', label: 'Contato', field: 'contactId', align: 'left' },
  { name: 'channel', label: 'Canal', field: 'channel', align: 'left' },
  { name: 'status', label: 'Status', field: 'status', align: 'left' },
  { name: 'attempts', label: 'Tentativas', field: 'attempts', align: 'center' },
  { name: 'detail', label: 'Detalhe', field: 'errorMessage', align: 'left' },
  { name: 'updatedAt', label: 'Atualizado', field: 'updatedAt', align: 'left' },
]

const metaBlockColumns = [
  { name: 'code', label: 'Bloqueio da Meta', field: 'code', align: 'left' },
  { name: 'deliveryCount', label: 'Disparos', field: 'deliveryCount', align: 'center' },
  { name: 'contactCount', label: 'Usuários', field: 'contactCount', align: 'center' },
  { name: 'automaticRetry', label: 'Retry automático', field: 'automaticRetryAt', align: 'left' },
  { name: 'updatedAt', label: 'Última ocorrência', field: 'updatedAt', align: 'left' },
  { name: 'actions', label: '', field: 'actions', align: 'right' },
]

const metaBlockDeliveryColumns = [
  { name: 'contact', label: 'Contato', field: 'contactName', align: 'left' },
  { name: 'dispatch', label: 'Disparo', field: 'notificationId', align: 'left' },
  { name: 'automaticRetry', label: 'Retry automático', field: 'automaticRetryAt', align: 'left' },
  { name: 'attempts', label: 'Tentativas', field: 'attempts', align: 'center' },
  { name: 'detail', label: 'Detalhe', field: 'detail', align: 'left' },
]

function statusColor(status = '') {
  return {
    delivered: 'positive',
    read: 'positive',
    sent: 'positive',
    queued: 'info',
    processing: 'info',
    partial: 'warning',
    skipped: 'warning',
    failed: 'negative',
    cancelled: 'grey-7',
  }[String(status).toLowerCase()] || 'grey-7'
}

function statusLabel(status = '') {
  return {
    delivered: 'Entregue',
    read: 'Lida',
    sent: 'Enviada',
    queued: 'Na fila',
    processing: 'Processando',
    partial: 'Parcial',
    skipped: 'Ignorada',
    failed: 'Falhou',
    cancelled: 'Cancelada',
  }[String(status).toLowerCase()] || String(status || 'Aguardando')
}

function channelLabel(channel = '') {
  return channels.value.find((item) => item.value === channel)?.label || channel || 'Global'
}

function notificationId(notification = {}) {
  return notification.id || notification._id || null
}

function contactLabel(delivery = {}) {
  const contact = delivery.contact || {}
  const displayName = contact.displayName || contact.name || contact.email || contact.phone || contact.telegramUsername
  if (displayName) return displayName
  const suffix = String(delivery.contactId || '').slice(-6)
  return suffix ? `Contato • ${suffix}` : 'Contato não identificado'
}

function notificationSummary(notification = {}) {
  const summary = notification.summary || {}
  return [
    { key: 'queued', label: 'Na fila', value: Number(summary.queued || 0), color: 'info' },
    { key: 'sent', label: 'Sucesso', value: Number(summary.sent || 0), color: 'positive' },
    { key: 'failed', label: 'Falhas', value: Number(summary.failed || 0), color: 'negative' },
    { key: 'skipped', label: 'Ignoradas', value: Number(summary.skipped || 0), color: 'warning' },
  ]
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function automaticRetryLabel(block = {}) {
  const status = String(block.automaticRetryStatus || '').toLowerCase()
  if (['queued', 'scheduled', 'waiting', 'delayed'].includes(status) && block.automaticRetryAt) {
    return `Agendado para ${formatDate(block.automaticRetryAt)}`
  }
  if (['processing', 'retrying'].includes(status)) return 'Tentativa automática em andamento'
  if (['completed', 'succeeded', 'sent'].includes(status)) return 'Tentativa automática concluída'
  if (block.automaticRetryAttempted || ['failed', 'exhausted'].includes(status)) {
    return 'Tentativa automática já utilizada'
  }
  if (block.automaticRetryAt) return `Agendado para ${formatDate(block.automaticRetryAt)}`
  return 'Aguardando agendamento de 24 horas'
}

function automaticRetryColor(block = {}) {
  const status = String(block.automaticRetryStatus || '').toLowerCase()
  if (['completed', 'succeeded', 'sent'].includes(status)) return 'positive'
  if (block.automaticRetryAttempted || ['failed', 'exhausted'].includes(status)) return 'warning'
  if (['processing', 'retrying'].includes(status)) return 'info'
  return 'primary'
}

function metaBlockIsRetrying(block = {}) {
  return metaBlockRetryingIds.value.includes(block.id)
}

async function loadMetaDeliveryBlocks({ showError = true } = {}) {
  metaBlocksLoading.value = true
  try {
    const response = await http.get('/notifications/meta-delivery-blocks', {
      params: { provider: 'meta', externalOnly: true, limit: 100 },
    })
    const normalized = normalizeMetaDeliveryBlocks(unwrap(response) || {})
    const contactMap = new Map(contacts.value.map((contact) => [String(contact.id || contact._id), contact]))
    metaBlocks.value = normalized.map((block) => {
      const deliveries = block.deliveries.map((delivery) => {
        const contact = contactMap.get(String(delivery.contactId || ''))
        return {
          ...delivery,
          contactName: contact?.displayName || contact?.name || contact?.email || contact?.phone || delivery.contactName,
        }
      })
      return {
        ...block,
        deliveries,
        contacts: [...new Map(deliveries.map((delivery) => [delivery.contactId || delivery.contactName, {
          id: delivery.contactId || delivery.contactName,
          name: delivery.contactName,
        }])).values()],
      }
    })
  } catch (error) {
    if (showError) {
      $q.notify({
        type: 'warning',
        message: errorMessage(error, 'Não foi possível carregar os bloqueios temporários da Meta.'),
      })
    }
  } finally {
    metaBlocksLoading.value = false
  }
}

function openMetaBlockDetails(block) {
  selectedMetaBlock.value = block
  metaBlockDetailDialog.value = true
}

async function retryMetaBlock(block) {
  if (!block?.retryable || metaBlockIsRetrying(block)) return
  const deliveryIds = [...new Set(block.deliveryIds || [])]
  if (!deliveryIds.length) {
    $q.notify({ type: 'warning', message: 'Não há entregas disponíveis para uma nova tentativa manual.' })
    return
  }
  pendingMetaRetryBlock.value = block
  metaRetryConfirmDialog.value = true
}

async function confirmMetaBlockRetry() {
  const block = pendingMetaRetryBlock.value
  if (!block || metaBlockIsRetrying(block)) return
  const deliveryIds = [...new Set(block.deliveryIds || [])]
  metaRetryConfirmDialog.value = false
  metaBlockRetryingIds.value = [...metaBlockRetryingIds.value, block.id]
  try {
    const response = await http.post(
      `/notifications/external-provider-issues/${encodeURIComponent(block.code)}/retry`,
      { reason: 'manual_meta_provider_retry' },
    )
    const result = unwrap(response) || {}
    const accepted = Number(result.queued || deliveryIds.length)
    $q.notify({
      type: 'positive',
      message: `${accepted} nova(s) tentativa(s) solicitada(s).`,
      caption: 'O processamento seguirá sem bloquear outros envios para estes contatos.',
    })
    await Promise.all([loadMetaDeliveryBlocks({ showError: false }), loadData({ includeMetaBlocks: false })])
  } catch (error) {
    $q.notify({
      type: 'negative',
      message: errorMessage(error, 'Não foi possível solicitar a nova tentativa manual.'),
    })
  } finally {
    metaBlockRetryingIds.value = metaBlockRetryingIds.value.filter((id) => id !== block.id)
    pendingMetaRetryBlock.value = null
  }
}

async function loadDispatchDetails({ pagination = dispatchDetailPagination.value, showError = true } = {}) {
  const id = notificationId(selectedDispatch.value)
  if (!id) return
  const requestId = ++dispatchDetailRequestSequence
  const page = Math.max(1, Number(pagination?.page) || 1)
  const limit = Math.max(1, Number(pagination?.rowsPerPage || pagination?.limit) || 15)
  dispatchDetailLoading.value = true
  try {
    const response = await http.get(`/notifications/${id}/deliveries`, {
      params: {
        page,
        limit,
        ...(dispatchDetailChannel.value ? { channel: dispatchDetailChannel.value } : {}),
        ...(dispatchDetailStatus.value ? { status: dispatchDetailStatus.value } : {}),
      },
    })
    if (requestId !== dispatchDetailRequestSequence) return
    const result = normalizeDeliveryPage(unwrap(response) || {}, contacts.value)
    dispatchDetailRows.value = result.items
    dispatchDetailPagination.value = {
      page: result.page,
      rowsPerPage: result.limit,
      rowsNumber: result.total,
    }
  } catch (error) {
    if (requestId === dispatchDetailRequestSequence && showError) {
      $q.notify({
        type: 'warning',
        message: errorMessage(error, 'Não foi possível carregar as entregas deste disparo.'),
      })
    }
  } finally {
    if (requestId === dispatchDetailRequestSequence) dispatchDetailLoading.value = false
  }
}

function openDispatchDetails(notification) {
  if (!notificationId(notification)) return
  selectedDispatch.value = notification
  dispatchDetailRows.value = []
  dispatchDetailChannel.value = null
  dispatchDetailStatus.value = null
  dispatchDetailPagination.value = { page: 1, rowsPerPage: 15, rowsNumber: 0 }
  dispatchDetailDialog.value = true
  loadDispatchDetails()
}

function requestDispatchDetailPage({ pagination }) {
  loadDispatchDetails({ pagination })
}

function filterDispatchDetails() {
  loadDispatchDetails({
    pagination: { ...dispatchDetailPagination.value, page: 1 },
  })
}

async function loadData({ includeMetaBlocks = true } = {}) {
  loading.value = true
  try {
    await app.fetchStatus(true)
    const [contactItems, groupItems, templateItems, templateSetItems, notificationResponse] = await Promise.all([
      fetchAll('/contacts', { params: { active: true }, preferredKey: 'contacts' }),
      fetchAll('/contact-groups', { params: { active: true }, preferredKey: 'groups' }),
      fetchAll('/templates', { preferredKey: 'templates' }),
      fetchAll('/template-sets', { preferredKey: 'templateSets' }),
      http.get('/notifications', { params: { limit: 20 } }),
    ])
    contacts.value = contactItems
    groups.value = groupItems
    templates.value = templateItems
    templateSets.value = templateSetItems
    deliveries.value = asList(unwrap(notificationResponse), 'notifications')
    if (!form.channel && dispatchChannelOptions.value.length) form.channel = dispatchChannelOptions.value[0].value
    if (includeMetaBlocks) await loadMetaDeliveryBlocks({ showError: false })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível preparar o disparador.') })
  } finally {
    loading.value = false
  }
}

function buildPayload() {
  const templateIds = tab.value === 'global'
    && globalSelectionMode.value === 'manual'
    ? Object.fromEntries(enabledChannelOptions.value
        .map((channel) => [channel.value, form.templateIds[channel.value]])
        .filter(([, value]) => Boolean(value)))
    : undefined
  return {
    kind: tab.value,
    contactIds: form.contactIds,
    groupIds: form.groupIds,
    channel: notificationChannel(tab.value, form.channel),
    idempotencyKey: newIdempotencyKey(`notification-${tab.value}`),
    templateId: tab.value === 'template' ? form.templateId : undefined,
    templateSetId: tab.value === 'global' && globalSelectionMode.value === 'set'
      ? form.templateSetId
      : undefined,
    templateIds,
    content: {
      text: tab.value === 'quick' ? form.message : undefined,
      subject: tab.value === 'quick' ? form.subject || undefined : undefined,
      variables: notificationRuntimeVariableValues(activeVariableDefinitions.value, form.variables),
    },
  }
}

async function send() {
  if (!selectedRecipients.value) {
    $q.notify({ type: 'warning', message: 'Selecione ao menos um contato ou grupo.' })
    return
  }
  if (tab.value === 'quick' && !form.message.trim()) {
    $q.notify({ type: 'warning', message: 'Escreva a mensagem rápida.' })
    return
  }
  if (tab.value !== 'quick' && !form.templateId) {
    if (tab.value === 'template') {
      $q.notify({ type: 'warning', message: 'Selecione um template.' })
      return
    }
  }
  if (tab.value === 'global') {
    if (globalSelectionMode.value === 'set' && !form.templateSetId) {
      $q.notify({ type: 'warning', message: 'Selecione um conjunto de templates.' })
      return
    }
    if (!selectedGlobalChannelOptions.value.length) {
      $q.notify({ type: 'warning', message: 'Selecione ao menos um canal e seu respectivo template.' })
      return
    }
  }
  if (tab.value === 'global' && globalSelectionMode.value === 'manual' && !enabledChannelOptions.value.length) {
    $q.notify({ type: 'warning', message: 'Configure ao menos um canal antes do disparo global.' })
    return
  }
  if (tab.value !== 'quick' && missingVariableDefinitions.value.length) {
    $q.notify({
      type: 'warning',
      message: 'Preencha os dados variáveis dos templates selecionados.',
      caption: missingVariableDefinitions.value.map((definition) => definition.label).join(', '),
    })
    return
  }
  if (tab.value !== 'global' && !dispatchChannelOptions.value.some((channel) => channel.value === form.channel)) {
    $q.notify({ type: 'warning', message: 'Escolha um canal configurado para este teste manual.' })
    return
  }

  let payload
  try {
    payload = buildPayload()
  } catch (error) {
    $q.notify({ type: 'negative', message: error.message })
    return
  }

  pendingPayload.value = payload
  reviewDialog.value = true
}

async function confirmSend() {
  if (!pendingPayload.value || sending.value) return
  sending.value = true
  try {
    const result = unwrap(await http.post('/notifications', pendingPayload.value)) || {}
    const { queued, skipped } = notificationDeliveryCounts(result)
    reviewDialog.value = false
    pendingPayload.value = null
    if (queued === 0) {
      $q.notify({
        type: 'warning',
        message: 'Nenhuma entrega foi colocada na fila.',
        caption: skipped
          ? `${skipped} combinação(ões) de contato e canal foram ignoradas. Verifique configuração e consentimento.`
          : 'O contato não possui um canal configurado e autorizado para este envio.',
      })
      await loadData()
      return
    }
    $q.notify({
      type: 'positive',
      message: queued !== undefined ? `${queued} entrega(s) colocada(s) na fila.` : 'Notificação colocada na fila.',
      caption: skipped ? `${skipped} canal(is) sem configuração ou autorização foram ignorados.` : undefined,
    })
    if (queued > 0) {
      form.message = ''
      form.templateId = null
      if (tab.value === 'global') {
        form.templateSetId = null
        form.templateIds = { telegram: null, whatsapp_cloud: null, email: null }
      }
      form.variables = {}
    }
    await loadData()
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível agendar as notificações.') })
  } finally {
    sending.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <q-page class="page-container">
    <PageHeader
      eyebrow="Central de disparos"
      title="Notificações"
      icon="send"
    >
      <template #actions>
        <q-btn outline color="primary" no-caps icon="refresh" label="Atualizar" :loading="loading" @click="loadData" />
      </template>
    </PageHeader>

    <section class="page-grid notification-layout">
      <q-card flat class="glass-card section-card composer-card">
        <q-tabs v-model="tab" no-caps inline-label active-color="primary" indicator-color="transparent" class="composer-tabs">
          <q-tab name="global" icon="hub" label="Template global" />
          <q-tab name="template" icon="description" label="Template" />
          <q-tab name="quick" icon="bolt" label="Rápida" />
        </q-tabs>
        <q-separator class="q-my-lg" />

        <q-tab-panels v-model="tab" animated class="transparent">
          <q-tab-panel v-for="panel in ['global', 'template', 'quick']" :key="panel" :name="panel" class="q-pa-none">
            <div class="form-grid">
              <q-select
                v-model="form.contactIds"
                outlined
                multiple
                use-chips
                use-input
                emit-value
                map-options
                :options="contactOptions"
                label="Contatos"
                class="full-span"
              />
              <q-select
                v-model="form.groupIds"
                outlined
                multiple
                use-chips
                use-input
                emit-value
                map-options
                :options="groupOptions"
                label="Grupos"
                class="full-span"
              />
              <q-select
                v-if="panel !== 'global'"
                v-model="form.channel"
                outlined
                emit-value
                map-options
                :options="panel === 'quick' ? quickEnabledChannelOptions : templateEnabledChannelOptions"
                :label="panel === 'quick' ? 'Enviar por' : 'Canal do template'"
                class="full-span"
              >
                <template #option="scope">
                  <q-item v-bind="scope.itemProps"><q-item-section avatar><q-icon :name="scope.opt.icon" /></q-item-section><q-item-section>{{ scope.opt.label }}</q-item-section></q-item>
                </template>
              </q-select>

              <template v-if="panel === 'quick'">
                <q-input v-model="form.subject" outlined label="Assunto (email)" class="full-span" />
                <q-input v-model="form.message" outlined type="textarea" autogrow label="Mensagem *" class="full-span" />
              </template>
              <template v-else-if="panel === 'template'">
                <q-select v-model="form.templateId" outlined emit-value map-options :options="templateOptions" label="Template *" class="full-span" />
              </template>
              <template v-else>
                <section class="full-span global-mode-selector" aria-label="Forma de selecionar templates">
                  <div>
                    <strong>Como deseja montar este envio?</strong>
                    <span>Use um conjunto pronto ou escolha manualmente um template por canal.</span>
                  </div>
                  <q-btn-toggle
                    v-model="globalSelectionMode"
                    no-caps
                    unelevated
                    toggle-color="primary"
                    color="grey-2"
                    text-color="dark"
                    :options="[
                      { label: 'Conjunto', value: 'set', icon: 'hub' },
                      { label: 'Por canal', value: 'manual', icon: 'tune' },
                    ]"
                  />
                </section>

                <q-select
                  v-if="globalSelectionMode === 'set'"
                  v-model="form.templateSetId"
                  outlined
                  clearable
                  emit-value
                  map-options
                  :options="templateSetOptions"
                  label="Conjunto de templates *"
                  class="full-span"
                >
                  <template #option="scope">
                    <q-item v-bind="scope.itemProps">
                      <q-item-section avatar><q-icon name="hub" color="primary" /></q-item-section>
                      <q-item-section>
                        <q-item-label>{{ scope.opt.label }}</q-item-label>
                        <q-item-label caption>
                          {{ scope.opt.description }}
                          <span v-if="scope.opt.invite"> · Convite: {{ scope.opt.invite }}</span>
                        </q-item-label>
                      </q-item-section>
                      <q-item-section side>
                        <q-badge outline color="primary" :label="`${scope.opt.channels.length} canal(is)`" />
                      </q-item-section>
                    </q-item>
                  </template>
                  <template #hint>
                    O conjunto preserva de um a três canais e pode ser reutilizado em outras campanhas.
                  </template>
                </q-select>
                <q-banner
                  v-if="globalSelectionMode === 'set' && unavailableGlobalChannelOptions.length"
                  rounded
                  class="full-span global-availability-warning"
                >
                  <template #avatar><q-icon name="warning_amber" color="warning" /></template>
                  <strong>Há canal(is) indisponível(is) neste conjunto:</strong>
                  {{ unavailableGlobalChannelOptions.map((channel) => channel.label).join(', ') }}.
                  Eles continuam visíveis na revisão; a fila verificará novamente a disponibilidade e registrará individualmente qualquer envio ignorado.
                </q-banner>

                <section v-if="globalSelectionMode === 'manual'" class="full-span global-template-grid" aria-label="Templates do envio global">
                  <article v-for="channel in enabledChannelOptions" :key="channel.value" class="global-template-card">
                    <header>
                      <q-icon :name="channel.icon" color="primary" size="23px" />
                      <div><strong>{{ channel.label }}</strong><span>Template deste canal</span></div>
                    </header>
                    <q-select
                      v-model="form.templateIds[channel.value]"
                      outlined
                      clearable
                      emit-value
                      map-options
                      :options="templatesForChannel(channel.value)"
                      :label="`Template ${channel.label} (opcional)`"
                      :hint="templatesForChannel(channel.value).length ? 'Selecione para incluir este canal no envio' : 'Nenhum template ativo deste canal'"
                    >
                      <template #option="scope">
                        <q-item v-bind="scope.itemProps">
                          <q-item-section>
                            <q-item-label>{{ scope.opt.label }}</q-item-label>
                            <q-item-label v-if="scope.opt.description" caption>{{ scope.opt.description }}</q-item-label>
                          </q-item-section>
                        </q-item>
                      </template>
                    </q-select>
                  </article>
                </section>
              </template>

              <section v-if="panel !== 'quick' && activeVariableDefinitions.length" class="full-span template-runtime-fields">
                <header>
                  <div>
                    <strong>Dados deste disparo</strong>
                    <span>Preencha somente os campos dinâmicos definidos nos templates escolhidos.</span>
                  </div>
                  <q-badge outline color="primary" :label="`${activeVariableDefinitions.length} campo(s)`" />
                </header>
                <div class="template-runtime-fields__grid">
                  <q-input
                    v-for="definition in activeVariableDefinitions"
                    :key="definition.key"
                    v-model="form.variables[definition.key]"
                    outlined
                    stack-label
                    :type="['image', 'video', 'document'].includes(definition.type) ? 'url' : 'text'"
                    :label="`${definition.label} *`"
                    :hint="variableHint(definition)"
                  >
                    <template #prepend><q-icon :name="variableIcon(definition)" color="primary" /></template>
                  </q-input>
                </div>
              </section>

            </div>
          </q-tab-panel>
        </q-tab-panels>

        <div class="send-summary">
          <div><span>Destinos selecionados</span><strong>{{ selectedRecipients }}</strong></div>
          <div>
            <span>Canal</span>
            <strong>{{ tab === 'global' ? `${selectedGlobalChannelOptions.length} selecionado(s)` : (dispatchChannelOptions.find((item) => item.value === form.channel)?.label || '—') }}</strong>
          </div>
          <q-space />
          <q-btn color="dark" unelevated no-caps size="lg" icon-right="send" label="Revisar e enviar" :loading="sending" @click="send" />
        </div>
      </q-card>

      <aside class="safety-column">
        <q-card flat class="glass-card section-card">
          <h2 class="section-title">🟢 Canais prontos</h2>
          <div class="channel-ready-list">
            <div v-for="channel in channels" :key="channel.value">
              <q-icon :name="channel.icon" />
              <span>{{ channel.label }}</span>
              <q-icon :name="channel.enabled ? 'check_circle' : 'remove_circle_outline'" :color="channel.enabled ? 'positive' : 'grey-5'" :aria-label="channel.enabled ? 'Disponível' : 'Ignorado'" />
            </div>
          </div>
        </q-card>
      </aside>
    </section>

    <q-card flat class="glass-card section-card q-mt-lg meta-blocks-card">
      <div class="toolbar-row meta-blocks-toolbar">
        <div>
          <div class="meta-blocks-title-row">
            <span class="meta-blocks-icon"><q-icon name="policy" /></span>
            <div>
              <h2 class="section-title">Bloqueios temporários da Meta</h2>
            </div>
          </div>
        </div>
        <q-btn
          outline
          color="primary"
          no-caps
          icon="refresh"
          label="Atualizar"
          :loading="metaBlocksLoading"
          @click="loadMetaDeliveryBlocks()"
        />
      </div>

      <q-banner rounded class="meta-retry-note q-mb-md">
        <template #avatar><q-icon name="schedule_send" color="primary" /></template>
        Cada entrega elegível recebe <strong>uma única tentativa automática após 24 horas</strong>.
        Se ela falhar, uma nova tentativa só acontece pelo botão manual. O agendamento não bloqueia outros disparos para o contato.
      </q-banner>

      <EmptyState
        v-if="!metaBlocksLoading && !metaBlocks.length"
        icon="verified"
        title="Nenhum bloqueio externo da Meta"
        description="Quando a Meta recusar temporariamente uma entrega, o agrupamento e o retry aparecerão aqui."
      />
      <q-table
        v-else
        flat
        :rows="metaBlocks"
        :columns="metaBlockColumns"
        row-key="id"
        :loading="metaBlocksLoading"
        :grid="$q.screen.lt.md"
        :rows-per-page-options="[5, 10, 20]"
        class="meta-blocks-table"
      >
        <template #body-cell-code="props">
          <q-td :props="props" class="meta-block-code">
            <q-badge color="deep-orange-8" :label="props.row.code" />
            <strong>{{ props.row.message }}</strong>
          </q-td>
        </template>
        <template #body-cell-deliveryCount="props"><q-td :props="props"><strong>{{ props.row.deliveryCount }}</strong></q-td></template>
        <template #body-cell-contactCount="props"><q-td :props="props"><strong>{{ props.row.contactCount }}</strong></q-td></template>
        <template #body-cell-automaticRetry="props">
          <q-td :props="props">
            <q-badge outline :color="automaticRetryColor(props.row)" :label="automaticRetryLabel(props.row)" />
          </q-td>
        </template>
        <template #body-cell-updatedAt="props"><q-td :props="props">{{ formatDate(props.row.updatedAt) }}</q-td></template>
        <template #body-cell-actions="props">
          <q-td :props="props" class="meta-block-actions">
            <q-btn flat round dense icon="manage_search" color="primary" aria-label="Ver detalhes do bloqueio" @click="openMetaBlockDetails(props.row)">
              <q-tooltip>Ver usuários e entregas afetadas</q-tooltip>
            </q-btn>
            <q-btn
              flat
              round
              dense
              icon="replay"
              color="deep-orange-8"
              aria-label="Tentar novamente manualmente"
              :disable="!props.row.retryable || !props.row.deliveryIds.length"
              :loading="metaBlockIsRetrying(props.row)"
              @click="retryMetaBlock(props.row)"
            >
              <q-tooltip>Tentar novamente agora; o automático ocorre somente uma vez</q-tooltip>
            </q-btn>
          </q-td>
        </template>
        <template #item="props">
          <div class="meta-block-grid-item">
            <article class="meta-block-mobile-card">
              <header>
                <q-badge color="deep-orange-8" :label="props.row.code" />
                <span>{{ formatDate(props.row.updatedAt) }}</span>
              </header>
              <p>{{ props.row.message }}</p>
              <div class="meta-block-mobile-card__counts">
                <span><strong>{{ props.row.deliveryCount }}</strong> disparo(s)</span>
                <span><strong>{{ props.row.contactCount }}</strong> usuário(s)</span>
              </div>
              <q-badge outline :color="automaticRetryColor(props.row)" :label="automaticRetryLabel(props.row)" />
              <footer>
                <q-btn flat no-caps color="primary" icon="manage_search" label="Detalhes" @click="openMetaBlockDetails(props.row)" />
                <q-btn
                  outline
                  no-caps
                  color="deep-orange-8"
                  icon="replay"
                  label="Tentar novamente"
                  :disable="!props.row.retryable || !props.row.deliveryIds.length"
                  :loading="metaBlockIsRetrying(props.row)"
                  @click="retryMetaBlock(props.row)"
                />
              </footer>
            </article>
          </div>
        </template>
      </q-table>
    </q-card>

    <q-card flat class="glass-card section-card q-mt-lg">
      <div class="toolbar-row">
        <div><h2 class="section-title">Atividade recente</h2><p class="section-copy">Últimos lotes e entregas registrados pela API.</p></div>
      </div>
      <EmptyState v-if="!loading && !deliveries.length" icon="outbox" title="Nenhum envio registrado" description="Seu primeiro disparo aparecerá aqui com status por canal." />
      <q-table
        v-else
        flat
        :rows="deliveries"
        :columns="deliveryColumns"
        row-key="_id"
        :loading="loading"
        :grid="$q.screen.lt.sm"
        :rows-per-page-options="[10, 20]"
        class="activity-table"
        @row-click="(_event, row) => openDispatchDetails(row)"
      >
        <template #body-cell-createdAt="props"><q-td :props="props">{{ formatDate(props.row.createdAt) }}</q-td></template>
        <template #body-cell-mode="props"><q-td :props="props">{{ activityType(props.row) }}</q-td></template>
        <template #body-cell-channel="props"><q-td :props="props"><q-badge outline color="primary" :label="props.row.channel || 'global'" /></q-td></template>
        <template #body-cell-contentName="props"><q-td :props="props">{{ activityName(props.row) }}</q-td></template>
        <template #body-cell-status="props"><q-td :props="props"><q-badge :color="statusColor(props.row.status)" :label="props.row.status || 'queued'" /></q-td></template>
        <template #body-cell-actions="props">
          <q-td :props="props">
            <q-btn
              flat
              round
              dense
              icon="manage_search"
              color="primary"
              aria-label="Ver contatos e canais deste disparo"
              @click.stop="openDispatchDetails(props.row)"
            >
              <q-tooltip>Ver status por contato e canal</q-tooltip>
            </q-btn>
          </q-td>
        </template>
        <template #item="props">
          <div class="activity-grid-item">
            <article class="activity-mobile-card" role="button" tabindex="0" @click="openDispatchDetails(props.row)" @keydown.enter="openDispatchDetails(props.row)">
              <header>
                <div>
                  <strong>{{ activityType(props.row) }}</strong>
                  <span>{{ formatDate(props.row.createdAt) }}</span>
                </div>
                <q-badge :color="statusColor(props.row.status)" :label="statusLabel(props.row.status)" />
              </header>
              <div class="activity-mobile-card__meta">
                <span><q-icon name="lan" />{{ channelLabel(props.row.channel) }}</span>
                <span><q-icon name="description" />{{ activityName(props.row) }}</span>
              </div>
              <footer>
                <span>Ver contatos, canais e motivos</span>
                <q-icon name="chevron_right" />
              </footer>
            </article>
          </div>
        </template>
      </q-table>
    </q-card>

    <q-dialog v-model="metaBlockDetailDialog" :maximized="$q.screen.lt.sm">
      <q-card class="meta-block-dialog">
        <q-card-section class="dispatch-detail-header">
          <div>
            <div class="text-overline text-deep-orange-8">Bloqueio externo do provedor</div>
            <h2>{{ selectedMetaBlock?.code || 'Meta' }}</h2>
            <p>{{ selectedMetaBlock?.message }}</p>
          </div>
          <q-btn flat round dense icon="close" v-close-popup aria-label="Fechar detalhes do bloqueio" />
        </q-card-section>
        <q-separator />
        <q-card-section class="meta-block-dialog__content scroll">
          <div class="meta-block-detail-stats">
            <div><span>Disparos afetados</span><strong>{{ selectedMetaBlock?.deliveryCount || 0 }}</strong></div>
            <div><span>Usuários afetados</span><strong>{{ selectedMetaBlock?.contactCount || 0 }}</strong></div>
            <div><span>Última ocorrência</span><strong>{{ formatDate(selectedMetaBlock?.updatedAt) }}</strong></div>
          </div>

          <q-banner rounded class="meta-retry-note q-my-md">
            <template #avatar><q-icon name="schedule_send" color="primary" /></template>
            <strong>{{ automaticRetryLabel(selectedMetaBlock || {}) }}</strong><br>
            O sistema faz somente uma tentativa automática após 24 horas. Novos disparos para esses contatos continuam independentes desta espera.
          </q-banner>

          <section class="meta-block-deliveries">
            <h3>Disparos e usuários afetados</h3>
            <q-table
              flat
              bordered
              :rows="selectedMetaBlock?.deliveries || []"
              :columns="metaBlockDeliveryColumns"
              row-key="id"
              :grid="$q.screen.lt.md"
              :rows-per-page-options="[5, 10, 20]"
              class="meta-block-delivery-table"
            >
              <template #body-cell-contact="props">
                <q-td :props="props"><strong>{{ props.row.contactName }}</strong><small>{{ props.row.contactId || 'ID não informado' }}</small></q-td>
              </template>
              <template #body-cell-dispatch="props">
                <q-td :props="props"><strong>{{ props.row.notificationId || 'Disparo não identificado' }}</strong><small>{{ formatDate(props.row.updatedAt) }}</small></q-td>
              </template>
              <template #body-cell-automaticRetry="props">
                <q-td :props="props"><q-badge outline :color="automaticRetryColor(props.row)" :label="automaticRetryLabel(props.row)" /></q-td>
              </template>
              <template #body-cell-detail="props"><q-td :props="props" class="meta-block-delivery-detail">{{ props.row.detail }}</q-td></template>
              <template #item="props">
                <div class="meta-block-delivery-grid-item">
                  <article class="meta-block-delivery-mobile-card">
                    <header><strong>{{ props.row.contactName }}</strong><span>{{ formatDate(props.row.updatedAt) }}</span></header>
                    <small>{{ props.row.notificationId || 'Disparo não identificado' }}</small>
                    <p>{{ props.row.detail }}</p>
                    <q-badge outline :color="automaticRetryColor(props.row)" :label="automaticRetryLabel(props.row)" />
                    <footer>{{ props.row.attempts }} tentativa(s)</footer>
                  </article>
                </div>
              </template>
            </q-table>
          </section>

          <section class="meta-block-explanation">
            <h3>O que aconteceu</h3>
            <p>Este registro veio da Meta/WhatsApp e não representa uma falha interna do Notify Flow. Bloqueios como o META_131049 podem ser aplicados temporariamente para preservar a qualidade e o engajamento do ecossistema.</p>
          </section>
        </q-card-section>
        <q-separator />
        <q-card-actions align="right" class="q-pa-md">
          <q-btn flat no-caps label="Fechar" v-close-popup />
          <q-btn
            color="deep-orange-8"
            unelevated
            no-caps
            icon="replay"
            label="Tentar novamente"
            :disable="!selectedMetaBlock?.retryable || !selectedMetaBlock?.deliveryIds?.length"
            :loading="metaBlockIsRetrying(selectedMetaBlock || {})"
            @click="retryMetaBlock(selectedMetaBlock)"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="metaRetryConfirmDialog" persistent>
      <q-card class="meta-retry-confirm-card">
        <q-card-section>
          <div class="text-overline text-deep-orange-8">Retry manual</div>
          <h2>Tentar novamente agora?</h2>
          <p>
            O retry manual será solicitado para {{ pendingMetaRetryBlock?.deliveryIds?.length || 0 }} entrega(s).
            Essa ação não interfere em outros disparos ou filas dos contatos.
          </p>
        </q-card-section>
        <q-separator />
        <q-card-actions align="right" class="q-pa-md">
          <q-btn flat no-caps label="Cancelar" @click="metaRetryConfirmDialog = false; pendingMetaRetryBlock = null" />
          <q-btn color="deep-orange-8" unelevated no-caps icon="replay" label="Tentar novamente" @click="confirmMetaBlockRetry" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="dispatchDetailDialog" :maximized="$q.screen.lt.sm">
      <q-card class="dispatch-detail-dialog">
        <q-card-section class="dispatch-detail-header">
          <div>
            <div class="text-overline text-primary">Detalhes do disparo</div>
            <h2>Status por contato e canal</h2>
            <p>
              {{ formatDate(selectedDispatch?.createdAt) }}
              · {{ channelLabel(selectedDispatch?.channel) }}
              · {{ dispatchDetailPagination.rowsNumber }} entrega(s)
            </p>
          </div>
          <q-btn flat round dense icon="close" v-close-popup aria-label="Fechar detalhes do disparo" />
        </q-card-section>

        <q-separator />

        <q-card-section class="dispatch-detail-content">
          <div class="dispatch-detail-summary" aria-label="Resumo das entregas">
            <div
              v-for="item in notificationSummary(selectedDispatch)"
              :key="item.key"
              :class="`dispatch-detail-summary__${item.key}`"
            >
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </div>

          <div class="dispatch-detail-filters">
            <q-select
              v-model="dispatchDetailChannel"
              outlined
              dense
              clearable
              emit-value
              map-options
              label="Canal"
              :options="channels.map((channel) => ({ label: channel.label, value: channel.value }))"
              @update:model-value="filterDispatchDetails"
            />
            <q-select
              v-model="dispatchDetailStatus"
              outlined
              dense
              clearable
              emit-value
              map-options
              label="Status"
              :options="[
                { label: 'Na fila', value: 'queued' },
                { label: 'Processando', value: 'processing' },
                { label: 'Enviada', value: 'sent' },
                { label: 'Entregue', value: 'delivered' },
                { label: 'Lida', value: 'read' },
                { label: 'Falhou', value: 'failed' },
                { label: 'Ignorada', value: 'skipped' },
              ]"
              @update:model-value="filterDispatchDetails"
            />
            <q-btn
              outline
              color="primary"
              no-caps
              icon="refresh"
              label="Atualizar"
              :loading="dispatchDetailLoading"
              @click="loadDispatchDetails()"
            />
          </div>

          <q-table
            v-model:pagination="dispatchDetailPagination"
            flat
            bordered
            :rows="dispatchDetailRows"
            :columns="dispatchDetailColumns"
            row-key="id"
            :loading="dispatchDetailLoading"
            :grid="$q.screen.lt.md"
            :rows-per-page-options="[10, 15, 25, 50]"
            class="dispatch-detail-table"
            @request="requestDispatchDetailPage"
          >
            <template #body-cell-contact="props">
              <q-td :props="props">
                <strong>{{ contactLabel(props.row) }}</strong>
                <small>{{ props.row.contactId }}</small>
              </q-td>
            </template>
            <template #body-cell-channel="props">
              <q-td :props="props"><q-badge outline color="primary" :label="channelLabel(props.row.channel)" /></q-td>
            </template>
            <template #body-cell-status="props">
              <q-td :props="props"><q-badge :color="statusColor(props.row.status)" :label="statusLabel(props.row.status)" /></q-td>
            </template>
            <template #body-cell-detail="props">
              <q-td :props="props" class="dispatch-detail-reason">
                {{ notificationDeliveryDetail(props.row) }}
                <small v-if="props.row.errorCode">{{ props.row.errorCode }}</small>
              </q-td>
            </template>
            <template #body-cell-updatedAt="props"><q-td :props="props">{{ formatDate(props.row.updatedAt) }}</q-td></template>
            <template #item="props">
              <div class="dispatch-delivery-grid-item">
                <article class="dispatch-delivery-card">
                  <header>
                    <div>
                      <strong>{{ contactLabel(props.row) }}</strong>
                      <span>{{ channelLabel(props.row.channel) }}</span>
                    </div>
                    <q-badge :color="statusColor(props.row.status)" :label="statusLabel(props.row.status)" />
                  </header>
                  <p>{{ notificationDeliveryDetail(props.row) }}</p>
                  <div class="dispatch-delivery-card__meta">
                    <span>{{ props.row.attempts || 0 }} tentativa(s)</span>
                    <span>{{ formatDate(props.row.updatedAt) }}</span>
                  </div>
                  <code v-if="props.row.errorCode">{{ props.row.errorCode }}</code>
                </article>
              </div>
            </template>
            <template #no-data>
              <div class="dispatch-detail-empty">
                <q-icon name="filter_alt_off" />
                <span>Nenhuma entrega corresponde aos filtros selecionados.</span>
              </div>
            </template>
          </q-table>
        </q-card-section>
      </q-card>
    </q-dialog>

    <q-dialog v-model="reviewDialog" persistent :maximized="$q.screen.lt.sm">
      <q-card class="review-dialog-card">
        <q-card-section class="review-dialog-header">
          <div>
            <div class="text-overline text-primary">Revisar e enviar</div>
            <h2>Confira o conteúdo antes de enfileirar</h2>
            <p>{{ selectedRecipients }} seleção(ões) de destino · {{ reviewItems.length }} canal(is)</p>
          </div>
          <q-btn flat round dense icon="close" aria-label="Voltar à edição" :disable="sending" @click="reviewDialog = false" />
        </q-card-section>

        <q-separator />
        <q-card-section class="review-dialog-content scroll">
          <q-banner rounded class="review-consent-note">
            <template #avatar><q-icon name="verified_user" color="primary" /></template>
            A fila validará configuração e consentimento separadamente em cada canal. Uma falha não interrompe as demais entregas.
          </q-banner>

          <div class="review-preview-grid">
            <article v-for="item in reviewItems" :key="item.value" class="review-preview-card">
              <header>
                <span class="review-channel-icon"><q-icon :name="item.icon" /></span>
                <div>
                  <strong>{{ item.label }}</strong>
                  <span>{{ item.templateName }}</span>
                </div>
                <q-badge
                  outline
                  :color="item.enabled ? 'primary' : 'warning'"
                  :label="item.enabled ? 'Selecionado' : 'Canal indisponível'"
                />
              </header>

              <q-banner v-if="!item.enabled" dense rounded class="review-channel-warning">
                <template #avatar><q-icon name="warning_amber" color="warning" /></template>
                A fila consultará este canal novamente. Se continuar indisponível, a entrega será ignorada e registrada sem interromper os demais canais.
              </q-banner>

              <div v-if="item.preview.officialName" class="review-meta">
                <span>Nome oficial</span>
                <strong>{{ item.preview.officialName }}</strong>
                <q-badge color="grey-3" text-color="dark" :label="item.preview.languageCode" />
              </div>
              <div v-if="item.preview.subject" class="review-subject">
                <span>Assunto</span>
                <strong>{{ item.preview.subject }}</strong>
              </div>
              <div class="review-message">
                <span>Prévia da mensagem</span>
                <strong v-if="item.preview.header" class="review-component-text">{{ item.preview.header }}</strong>
                <div v-if="item.preview.mediaUrl" class="review-media">
                  <img
                    v-if="['photo', 'image'].includes(item.preview.mediaType)"
                    :src="item.preview.mediaUrl"
                    alt="Imagem do template"
                    referrerpolicy="no-referrer"
                  />
                  <video v-else-if="item.preview.mediaType === 'video'" :src="item.preview.mediaUrl" controls preload="metadata" />
                  <a v-else :href="item.preview.mediaUrl" target="_blank" rel="noopener noreferrer">
                    <q-icon name="description" /> Abrir documento
                  </a>
                </div>
                <div v-if="item.preview.html" class="review-html" v-html="safeReviewHtml(item.preview.html)" />
                <p v-else>{{ item.preview.body }}</p>
                <small v-if="item.preview.footer" class="review-footer">{{ item.preview.footer }}</small>
                <div v-if="item.preview.buttons?.length" class="review-buttons">
                  <span v-for="button in item.preview.buttons" :key="`${button.text}-${button.url}`">
                    <q-icon name="open_in_new" /> {{ button.text }}
                  </span>
                </div>
              </div>
            </article>
          </div>
        </q-card-section>

        <q-separator />
        <q-card-actions align="right" class="review-dialog-actions">
          <q-btn flat no-caps label="Voltar e editar" :disable="sending" @click="reviewDialog = false" />
          <q-btn color="primary" unelevated no-caps icon-right="send" label="Confirmar e colocar na fila" :loading="sending" @click="confirmSend" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<style scoped>
.page-container,
.notification-layout,
.composer-card,
.safety-column,
.section-card,
.form-grid,
.global-mode-selector,
.global-template-grid,
.send-summary,
.toolbar-row {
  min-width: 0;
  max-width: 100%;
}

.page-container {
  overflow-x: clip;
}

.notification-layout {
  grid-template-columns: minmax(0, 1.6fr) minmax(280px, 0.55fr);
  align-items: start;
}

.composer-tabs {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  scrollbar-width: thin;
  justify-content: flex-start;
}

.composer-tabs :deep(.q-tabs__content) {
  min-width: max-content;
  flex-wrap: nowrap;
}

.composer-card :deep(.q-tab-panels),
.composer-card :deep(.q-tab-panel),
.composer-card :deep(.q-banner),
.composer-card :deep(.q-banner__content),
.composer-card :deep(.q-field),
.composer-card :deep(.q-field__control-container) {
  min-width: 0;
  max-width: 100%;
}

.composer-card :deep(.q-banner__content) {
  overflow-wrap: anywhere;
}

.global-template-grid {
  display: grid;
  gap: 12px;
}

.global-template-grid {
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
}

.global-mode-selector {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px;
  border: 1px solid rgba(53, 188, 164, 0.18);
  border-radius: 15px;
  background: rgba(247, 254, 252, 0.76);
}

.global-mode-selector > div:first-child {
  display: grid;
  gap: 2px;
}

.global-mode-selector span {
  color: #667a77;
  font-size: 0.76rem;
}

.global-template-card {
  min-width: 0;
  padding: 14px;
  border: 1px solid rgba(53, 188, 164, 0.2);
  border-radius: 15px;
  background: rgba(247, 254, 252, 0.76);
}

.global-template-card header {
  display: flex;
  align-items: center;
  gap: 9px;
}

.global-template-card header {
  margin-bottom: 12px;
}

.global-template-card header strong,
.global-template-card header span {
  display: block;
}

.global-template-card header span {
  color: #667a77;
  font-size: 0.72rem;
}

.global-availability-warning,
.review-channel-warning {
  border: 1px solid rgba(242, 169, 59, 0.32);
  background: rgba(255, 244, 219, 0.72);
  color: #76551d;
}

.send-summary {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid rgba(3, 21, 21, 0.09);
}

.send-summary > div span,
.send-summary > div strong {
  display: block;
}

.send-summary > div span {
  color: #667a77;
  font-size: 0.72rem;
}

.send-summary > div strong {
  margin-top: 3px;
  font-size: 1.3rem;
}

.safety-column {
  display: grid;
  gap: 20px;
}

.channel-ready-list {
  display: grid;
  gap: 8px;
  margin-top: 18px;
}

.channel-ready-list > div {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 24px;
  align-items: center;
  padding: 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.52);
}

.meta-blocks-card {
  border: 1px solid rgba(215, 104, 43, 0.14);
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.88), rgba(255, 241, 230, 0.34));
}

.meta-blocks-toolbar,
.meta-blocks-title-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.meta-blocks-toolbar {
  justify-content: space-between;
  margin-bottom: 14px;
}

.meta-blocks-title-row > div {
  min-width: 0;
}

.meta-blocks-icon {
  display: grid;
  width: 46px;
  height: 46px;
  flex: 0 0 46px;
  place-items: center;
  border-radius: 14px;
  background: rgba(225, 111, 52, 0.13);
  color: #b64d20;
  font-size: 24px;
}

.meta-retry-note {
  border: 1px solid rgba(53, 188, 164, 0.22);
  background: rgba(231, 251, 247, 0.7);
  color: #315e56;
  overflow-wrap: anywhere;
}

.meta-blocks-table {
  width: 100%;
  max-width: 100%;
}

.meta-blocks-table :deep(td),
.meta-blocks-table :deep(th) {
  max-width: 360px;
  white-space: normal;
  overflow-wrap: anywhere;
}

.meta-block-code .q-badge,
.meta-block-code strong {
  display: block;
  width: max-content;
  max-width: 100%;
}

.meta-block-code strong {
  margin-top: 6px;
  color: #4f4a46;
  font-size: 0.78rem;
  font-weight: 500;
}

.meta-block-actions {
  white-space: nowrap !important;
}

.meta-block-grid-item {
  width: 100%;
  min-width: 0;
  padding: 6px 4px;
}

.meta-block-mobile-card {
  min-width: 0;
  padding: 15px;
  border: 1px solid rgba(215, 104, 43, 0.18);
  border-radius: 16px;
  background: rgba(255, 253, 251, 0.94);
}

.meta-block-mobile-card > header,
.meta-block-mobile-card > footer,
.meta-block-mobile-card__counts {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.meta-block-mobile-card > header span {
  color: #788783;
  font-size: 0.72rem;
}

.meta-block-mobile-card > p {
  margin: 13px 0;
  color: #405b56;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.meta-block-mobile-card__counts {
  justify-content: flex-start;
  flex-wrap: wrap;
  margin-bottom: 12px;
  color: #617570;
  font-size: 0.76rem;
}

.meta-block-mobile-card > footer {
  align-items: stretch;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(215, 104, 43, 0.12);
}

.meta-block-dialog {
  display: flex;
  width: min(760px, calc(100vw - 32px));
  max-width: 760px;
  max-height: min(88vh, 820px);
  flex-direction: column;
  overflow: hidden;
  border-radius: 22px;
  background: #fbfffe;
}

.meta-block-dialog__content {
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  padding: 20px 22px;
}

.meta-block-detail-stats {
  display: grid;
  min-width: 0;
  gap: 10px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.meta-block-detail-stats > div {
  min-width: 0;
  padding: 13px;
  border: 1px solid rgba(14, 89, 78, 0.11);
  border-radius: 13px;
  background: rgba(247, 254, 252, 0.82);
}

.meta-block-detail-stats span,
.meta-block-detail-stats strong {
  display: block;
  overflow-wrap: anywhere;
}

.meta-block-detail-stats span {
  color: #71827f;
  font-size: 0.7rem;
}

.meta-block-detail-stats strong {
  margin-top: 4px;
}

.meta-block-deliveries h3,
.meta-block-explanation h3 {
  margin: 18px 0 8px;
  color: #173c36;
  font-size: 0.95rem;
}

.meta-block-delivery-table {
  width: 100%;
  max-width: 100%;
  border-radius: 14px;
}

.meta-block-delivery-table :deep(td),
.meta-block-delivery-table :deep(th) {
  max-width: 260px;
  white-space: normal;
  overflow-wrap: anywhere;
}

.meta-block-delivery-table :deep(td strong),
.meta-block-delivery-table :deep(td small) {
  display: block;
}

.meta-block-delivery-table :deep(td small) {
  margin-top: 3px;
  color: #758682;
  font-size: 0.68rem;
}

.meta-block-delivery-detail {
  color: #526b66;
  line-height: 1.4;
}

.meta-block-delivery-grid-item {
  width: 100%;
  min-width: 0;
  padding: 5px 3px;
}

.meta-block-delivery-mobile-card {
  min-width: 0;
  padding: 14px;
  border: 1px solid rgba(215, 104, 43, 0.16);
  border-radius: 14px;
  background: #fffdfb;
}

.meta-block-delivery-mobile-card > header {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.meta-block-delivery-mobile-card > header strong,
.meta-block-delivery-mobile-card > header span {
  overflow-wrap: anywhere;
}

.meta-block-delivery-mobile-card > header span,
.meta-block-delivery-mobile-card > small,
.meta-block-delivery-mobile-card > footer {
  color: #71827f;
  font-size: 0.7rem;
}

.meta-block-delivery-mobile-card > small {
  display: block;
  margin-top: 4px;
}

.meta-block-delivery-mobile-card > p {
  margin: 11px 0;
  color: #4f6863;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.meta-block-delivery-mobile-card > footer {
  margin-top: 9px;
}

.meta-retry-confirm-card {
  width: min(500px, calc(100vw - 32px));
  max-width: 500px;
  border-radius: 18px;
}

.meta-retry-confirm-card h2 {
  margin: 0;
  color: #172f2b;
  font-size: 1.35rem;
}

.meta-retry-confirm-card p {
  margin: 8px 0 0;
  color: #60736f;
  line-height: 1.5;
}

.meta-block-explanation p {
  margin: 0;
  color: #536d68;
  line-height: 1.55;
}

.activity-table {
  width: 100%;
  max-width: 100%;
}

.activity-table :deep(tbody tr) {
  cursor: pointer;
}

.activity-table :deep(tbody tr:hover) {
  background: rgba(53, 188, 164, 0.07);
}

.activity-grid-item,
.dispatch-delivery-grid-item {
  width: 100%;
  min-width: 0;
  padding: 6px 4px;
}

.activity-mobile-card,
.dispatch-delivery-card {
  min-width: 0;
  border: 1px solid rgba(14, 89, 78, 0.14);
  border-radius: 15px;
  background: #fbfffe;
}

.activity-mobile-card {
  padding: 14px;
  cursor: pointer;
}

.activity-mobile-card > header,
.dispatch-delivery-card > header {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.activity-mobile-card > header > div,
.dispatch-delivery-card > header > div {
  min-width: 0;
}

.activity-mobile-card > header strong,
.activity-mobile-card > header span,
.dispatch-delivery-card > header strong,
.dispatch-delivery-card > header span {
  display: block;
  overflow-wrap: anywhere;
}

.activity-mobile-card > header span,
.dispatch-delivery-card > header span {
  margin-top: 2px;
  color: #6b7f7b;
  font-size: 0.75rem;
}

.activity-mobile-card__meta {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 7px 14px;
  margin-top: 12px;
  color: #4d6762;
  font-size: 0.78rem;
}

.activity-mobile-card__meta span {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  overflow-wrap: anywhere;
}

.activity-mobile-card > footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 13px;
  padding-top: 10px;
  border-top: 1px solid rgba(14, 89, 78, 0.09);
  color: #168f7d;
  font-size: 0.76rem;
  font-weight: 700;
}

.dispatch-detail-dialog {
  display: flex;
  width: min(1080px, calc(100vw - 32px));
  max-width: 1080px;
  max-height: min(90vh, 920px);
  flex-direction: column;
  overflow: hidden;
  border-radius: 22px;
  background: #fbfffe;
}

.dispatch-detail-header {
  display: flex;
  min-width: 0;
  flex: 0 0 auto;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 20px 22px;
}

.dispatch-detail-header > div {
  min-width: 0;
}

.dispatch-detail-header h2 {
  margin: 0;
  color: #071f1c;
  font-size: clamp(1.25rem, 3vw, 1.7rem);
}

.dispatch-detail-header p {
  margin: 5px 0 0;
  color: #647975;
  overflow-wrap: anywhere;
}

.dispatch-detail-content {
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  padding: 18px 22px 22px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.dispatch-detail-summary {
  display: grid;
  min-width: 0;
  gap: 10px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.dispatch-detail-summary > div {
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid rgba(14, 89, 78, 0.11);
  border-radius: 13px;
  background: rgba(247, 254, 252, 0.82);
}

.dispatch-detail-summary span,
.dispatch-detail-summary strong {
  display: block;
}

.dispatch-detail-summary span {
  color: #6b7f7b;
  font-size: 0.72rem;
}

.dispatch-detail-summary strong {
  margin-top: 3px;
  font-size: 1.35rem;
}

.dispatch-detail-summary__sent {
  border-color: rgba(39, 183, 159, 0.25) !important;
  background: rgba(39, 183, 159, 0.08) !important;
}

.dispatch-detail-summary__failed {
  border-color: rgba(194, 55, 75, 0.22) !important;
  background: rgba(194, 55, 75, 0.06) !important;
}

.dispatch-detail-summary__skipped {
  border-color: rgba(242, 169, 59, 0.28) !important;
  background: rgba(242, 169, 59, 0.08) !important;
}

.dispatch-detail-filters {
  display: grid;
  min-width: 0;
  align-items: center;
  gap: 10px;
  margin: 16px 0;
  grid-template-columns: minmax(160px, 1fr) minmax(160px, 1fr) auto;
}

.dispatch-detail-table {
  width: 100%;
  max-width: 100%;
  border-radius: 14px;
}

.dispatch-detail-table :deep(td),
.dispatch-detail-table :deep(th) {
  max-width: 280px;
  white-space: normal;
  overflow-wrap: anywhere;
}

.dispatch-detail-table :deep(td strong),
.dispatch-detail-table :deep(td small),
.dispatch-detail-reason small {
  display: block;
}

.dispatch-detail-table :deep(td small),
.dispatch-detail-reason small {
  margin-top: 3px;
  color: #738682;
  font-size: 0.68rem;
}

.dispatch-delivery-card {
  padding: 14px;
}

.dispatch-delivery-card p {
  margin: 12px 0;
  color: #365b54;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.dispatch-delivery-card__meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 5px 12px;
  color: #6b7f7b;
  font-size: 0.72rem;
}

.dispatch-delivery-card code {
  display: block;
  margin-top: 9px;
  color: #9a2f42;
  overflow-wrap: anywhere;
}

.dispatch-detail-empty {
  display: flex;
  width: 100%;
  min-height: 150px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #71837f;
}

.review-dialog-card {
  display: flex;
  width: min(900px, calc(100vw - 32px));
  max-width: 900px;
  max-height: min(86vh, 900px);
  flex-direction: column;
  border-radius: 22px;
}

.review-dialog-header,
.review-dialog-actions {
  flex: 0 0 auto;
  background: #fbfffe;
}

.review-dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 22px 24px 18px;
}

.review-dialog-header h2 {
  margin: 0;
  color: #071f1c;
  font-size: clamp(1.25rem, 3vw, 1.7rem);
}

.review-dialog-header p {
  margin: 5px 0 0;
  color: #647975;
}

.review-dialog-content {
  flex: 1 1 auto;
  min-height: 0;
  padding: 20px 24px;
}

.review-consent-note {
  margin-bottom: 16px;
  border: 1px solid rgba(39, 183, 159, 0.2);
  background: rgba(130, 248, 230, 0.12);
  color: #345d56;
}

.review-channel-warning {
  margin: 12px 14px 0;
  font-size: 0.76rem;
}

.review-preview-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

.review-preview-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid rgba(14, 89, 78, 0.14);
  border-radius: 17px;
  background: #f9fdfc;
  box-shadow: 0 8px 24px rgba(7, 57, 50, 0.06);
}

.review-preview-card > header {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 14px;
  background: rgba(130, 248, 230, 0.11);
}

.review-preview-card > header strong,
.review-preview-card > header span {
  display: block;
}

.review-preview-card > header span {
  overflow: hidden;
  color: #657975;
  font-size: 0.76rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-channel-icon {
  display: grid !important;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 12px;
  background: #dffaf5;
  color: #168f7d !important;
  font-size: 21px !important;
}

.review-meta,
.review-subject,
.review-message {
  padding: 12px 14px;
  border-top: 1px solid rgba(14, 89, 78, 0.09);
}

.review-meta {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 2px 8px;
}

.review-meta > span,
.review-subject > span,
.review-message > span {
  display: block;
  color: #70817e;
  font-size: 0.7rem;
}

.review-meta > strong {
  overflow-wrap: anywhere;
}

.review-meta > span {
  grid-column: 1 / -1;
}

.review-subject strong {
  display: block;
  margin-top: 3px;
}

.review-message p {
  margin: 6px 0 0;
  color: #173c36;
  line-height: 1.5;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.review-media {
  margin-top: 8px;
}

.review-media img,
.review-media video {
  display: block;
  width: 100%;
  max-height: 260px;
  border-radius: 12px;
  background: #e7f1ef;
  object-fit: contain;
}

.review-media a {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #e7f6f2;
  color: #13745f;
  font-weight: 700;
  text-decoration: none;
}

.review-component-text {
  display: block;
  margin-top: 8px;
  color: #123f37;
  overflow-wrap: anywhere;
}

.review-footer {
  display: block;
  margin-top: 8px;
  color: #6b7f7b;
  line-height: 1.4;
}

.review-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 10px;
}

.review-html {
  max-width: 100%;
  margin-top: 8px;
  overflow-wrap: anywhere;
}

.review-html :deep(img),
.review-html :deep(video) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 8px auto;
  border-radius: 10px;
}

.review-html :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
}

.review-dialog-actions {
  gap: 8px;
  padding: 14px 20px;
}

.template-runtime-fields {
  padding: 16px;
  border: 1px solid rgba(29, 180, 158, 0.24);
  border-radius: 18px;
  background: rgba(232, 252, 248, 0.72);
}

.template-runtime-fields > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.template-runtime-fields > header div,
.template-runtime-fields__grid {
  display: grid;
  gap: 4px;
}

.template-runtime-fields > header span {
  color: #637a76;
  font-size: 0.8rem;
}

.template-runtime-fields__grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 1000px) {
  .notification-layout {
    grid-template-columns: 1fr;
  }

  .safety-column {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 650px) {
  .composer-card {
    padding-right: 14px;
    padding-left: 14px;
  }

  .global-mode-selector {
    align-items: stretch;
    flex-direction: column;
  }

  .global-mode-selector :deep(.q-btn-group) {
    display: grid;
    grid-template-columns: 1fr 1fr;
    width: 100%;
  }

  .review-dialog-card {
    width: 100%;
    max-width: none;
    max-height: none;
    border-radius: 0;
  }

  .review-dialog-header,
  .review-dialog-content {
    padding-right: 16px;
    padding-left: 16px;
  }

  .review-preview-grid {
    grid-template-columns: 1fr;
  }

  .template-runtime-fields__grid {
    grid-template-columns: 1fr;
  }

  .review-dialog-actions {
    display: grid;
    grid-template-columns: 1fr;
    padding: 12px 16px max(12px, env(safe-area-inset-bottom));
  }

  .review-dialog-actions .q-btn {
    width: 100%;
  }

  .send-summary {
    align-items: stretch;
    flex-wrap: wrap;
  }

  .send-summary .q-btn {
    width: 100%;
  }

  .safety-column {
    grid-template-columns: 1fr;
  }

  .meta-blocks-toolbar,
  .meta-blocks-title-row {
    align-items: flex-start;
  }

  .meta-blocks-toolbar {
    flex-direction: column;
  }

  .meta-blocks-toolbar > .q-btn {
    width: 100%;
  }

  .meta-block-mobile-card > footer {
    display: grid;
    grid-template-columns: 1fr;
  }

  .meta-block-dialog {
    width: 100%;
    max-width: none;
    max-height: 100dvh;
    border-radius: 0;
  }

  .meta-block-detail-stats {
    grid-template-columns: 1fr;
  }

  .dispatch-detail-dialog {
    width: 100%;
    max-width: none;
    max-height: 100dvh;
    border-radius: 0;
  }

  .dispatch-detail-header,
  .dispatch-detail-content {
    padding-right: 16px;
    padding-left: 16px;
  }

  .dispatch-detail-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dispatch-detail-filters {
    grid-template-columns: 1fr;
  }

  .dispatch-detail-filters .q-btn {
    width: 100%;
  }
}
</style>
