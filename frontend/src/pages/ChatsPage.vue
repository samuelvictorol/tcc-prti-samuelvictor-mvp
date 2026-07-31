<script>
export const WHATSAPP_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000

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
        }
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
  return (template.variables || []).map((key, index) => ({
    key,
    label: `Campo ${index + 1}`,
    type: 'text',
  }))
}

const CLOUD_TEMPLATE_MEDIA_CONFIG = Object.freeze({
  image: Object.freeze({
    label: 'Imagem',
    icon: 'image',
    accept: 'image/jpeg,image/png',
    maxBytes: 5 * 1024 * 1024,
    extensions: Object.freeze(['jpg', 'jpeg', 'png']),
  }),
  video: Object.freeze({
    label: 'Vídeo',
    icon: 'videocam',
    accept: 'video/mp4,video/3gpp',
    maxBytes: 16 * 1024 * 1024,
    extensions: Object.freeze(['mp4', '3gp']),
  }),
  document: Object.freeze({
    label: 'Arquivo',
    icon: 'description',
    accept: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,text/plain,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation',
    maxBytes: 100 * 1024 * 1024,
    extensions: Object.freeze(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt']),
  }),
})

export function isCloudTemplateMediaParameter(parameter = {}) {
  return Boolean(CLOUD_TEMPLATE_MEDIA_CONFIG[parameter.type])
}

export function cloudTemplateMediaConfig(parameterOrType = {}) {
  const type = typeof parameterOrType === 'string' ? parameterOrType : parameterOrType.type
  return CLOUD_TEMPLATE_MEDIA_CONFIG[type] || null
}

export function cloudTemplateMediaFileError(file, parameterOrType = {}) {
  const config = cloudTemplateMediaConfig(parameterOrType)
  if (!config || !file) return ''
  const extension = String(file.name || '').split('.').pop()?.toLowerCase() || ''
  const declaredType = String(file.type || '').toLowerCase()
  const acceptedMime = config.accept.split(',').some((item) => item && !item.startsWith('.') && item === declaredType)
  if (!config.extensions.includes(extension) || (declaredType && !acceptedMime)) {
    return `Selecione um arquivo compatível com ${config.label.toLowerCase()}.`
  }
  if (Number(file.size || 0) > config.maxBytes) {
    return `${config.label} excede o limite de ${Math.round(config.maxBytes / 1024 / 1024)} MB.`
  }
  return ''
}

export function normalizeCloudTemplateMediaUpload(payload = {}, fallback = {}) {
  const source = payload?.data?.data || payload?.data || payload || {}
  const mediaType = String(source.mediaType || fallback.mediaType || '').toLowerCase()
  return {
    id: source.id || source._id || null,
    url: String(source.url || source.link || '').trim(),
    mimeType: String(source.mimeType || fallback.mimeType || ''),
    mediaType: mediaType === 'file' ? 'document' : mediaType,
    filename: String(source.filename || fallback.filename || 'arquivo').trim(),
  }
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
    const value = values[parameter.key]
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
</script>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useQuasar } from 'quasar'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import ContactDialog from '../components/ContactDialog.vue'
import ContextHelp from '../components/ContextHelp.vue'
import { asList, errorMessage, fetchAll, http, unwrap } from '../services/http.js'
import { connectSocket, getSocket } from '../services/socket.js'
import { newIdempotencyKey } from '../services/bulk-notifications.js'
import { playAppSound } from '../services/sounds.js'

const props = defineProps({ embedded: { type: Boolean, default: false } })
const $q = useQuasar()
const loading = ref(false)
const loadingMessages = ref(false)
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
const templateVariables = ref({})
const templateMediaModes = ref({})
const templateMediaFiles = ref({})
const templateMediaAssets = ref({})
const templateMediaUploading = ref({})
const templates = ref([])
const historyNote = ref('')
const now = ref(Date.now())
const messagesPanel = ref(null)
const contactDialog = ref(false)
const contactForDialog = ref(null)
let clockTimer = null
let realtimeRefreshTimer = null
let conversationsRequest = 0
let messagesRequest = 0
let templateMediaGeneration = 0
const readRequests = new Set()

const filteredConversations = computed(() => {
  const needle = search.value.trim().toLowerCase()
  if (!needle) return conversations.value
  return conversations.value.filter((conversation) => [
    conversation.contact?.displayName,
    conversation.displayName,
    conversation.contact?.phone,
    conversation.phone,
    conversation.lastMessage?.text,
    conversation.lastMessage?.body,
  ].some((value) => String(value || '').toLowerCase().includes(needle)))
})

const selectedWindow = computed(() => serviceWindowOf(selected.value, now.value))
const selectedConsent = computed(() => cloudConsentOf(selected.value))
const selectedCanSend = computed(() => canSendCloudServiceMessage(selected.value, now.value))
const selectedCanCompose = computed(() => canSendCloudChatMode(selected.value, sendMode.value, now.value))
const consentRequestAvailable = computed(() => selectedCanSend.value && !selectedConsent.value.authorized)
const selectedContactId = computed(() => selected.value?.contact?.id
  || selected.value?.contact?._id
  || selected.value?.contactId
  || null)
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
const templateMediaUploadPending = computed(() => Object.values(templateMediaUploading.value).some(Boolean))

function conversationName(conversation) {
  return conversation?.contact?.displayName
    || conversation?.displayName
    || conversation?.contactName
    || conversation?.contact?.phone
    || conversation?.phone
    || 'Contato sem nome'
}

function conversationPhone(conversation) {
  return conversation?.contact?.phone || conversation?.phone || conversation?.waId || ''
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

function previewOf(conversation) {
  const lastMessage = conversation?.lastMessage
  if (typeof lastMessage === 'string') return lastMessage
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

function resetTemplateComposer() {
  templateMediaGeneration += 1
  const values = {}
  const modes = {}
  for (const parameter of selectedTemplateParameters.value) {
    values[parameter.key] = isCloudTemplateMediaParameter(parameter) ? parameter.example || '' : ''
    if (isCloudTemplateMediaParameter(parameter)) modes[parameter.key] = 'url'
  }
  templateVariables.value = values
  templateMediaModes.value = modes
  templateMediaFiles.value = {}
  templateMediaAssets.value = {}
  templateMediaUploading.value = {}
}

function templateMediaReference(parameter) {
  return String(templateVariables.value[parameter.key] || '').trim()
}

function templateMediaPreviewUrl(parameter) {
  const reference = templateMediaReference(parameter)
  return isValidCloudTemplateMediaUrl(reference) ? reference : ''
}

function templateMediaFilename(parameter) {
  const asset = templateMediaAssets.value[parameter.key]
  if (asset?.filename) return asset.filename
  const reference = templateMediaReference(parameter)
  try {
    return decodeURIComponent(new URL(reference).pathname.split('/').filter(Boolean).pop() || '') || parameter.label
  } catch {
    return parameter.filename || parameter.label
  }
}

function templateMediaReferenceIsValid(parameter) {
  const reference = templateMediaReference(parameter)
  return isValidCloudTemplateMediaUrl(reference)
}

function clearTemplateMediaState(parameter, { clearValue = true } = {}) {
  const remainingAssets = { ...templateMediaAssets.value }
  delete remainingAssets[parameter.key]
  templateMediaAssets.value = remainingAssets
  templateMediaFiles.value = { ...templateMediaFiles.value, [parameter.key]: null }
  if (clearValue) templateVariables.value = { ...templateVariables.value, [parameter.key]: '' }
}

function onTemplateMediaModeChange(parameter, mode) {
  templateMediaModes.value = { ...templateMediaModes.value, [parameter.key]: mode }
  clearTemplateMediaState(parameter)
}

function templateMediaHelp(parameter) {
  if (parameter.type === 'image') return 'Use a imagem aprovada no cabeçalho do modelo Meta. Aceita JPG ou PNG de até 5 MB.'
  if (parameter.type === 'video') return 'Use o vídeo aprovado no cabeçalho do modelo Meta. Aceita MP4 ou 3GP de até 16 MB.'
  return 'Use o documento aprovado no cabeçalho do modelo Meta. O nome enviado ao WhatsApp será preservado.'
}

function onTemplateMediaRejected(parameter, rejectedEntries = []) {
  const first = rejectedEntries[0]
  const detail = cloudTemplateMediaFileError(first?.file, parameter)
  $q.notify({
    type: 'warning',
    message: detail || 'O arquivo selecionado não atende aos limites deste campo.',
  })
}

async function uploadTemplateMedia(parameter, selectedFile) {
  const file = Array.isArray(selectedFile) ? selectedFile[0] : selectedFile
  templateMediaFiles.value = { ...templateMediaFiles.value, [parameter.key]: file || null }
  if (!file) {
    clearTemplateMediaState(parameter)
    return
  }
  const uploadGeneration = templateMediaGeneration
  clearTemplateMediaState(parameter)
  templateMediaFiles.value = { ...templateMediaFiles.value, [parameter.key]: file }

  const validationError = cloudTemplateMediaFileError(file, parameter)
  if (validationError) {
    templateMediaFiles.value = { ...templateMediaFiles.value, [parameter.key]: null }
    $q.notify({ type: 'warning', message: validationError })
    return
  }

  templateMediaUploading.value = { ...templateMediaUploading.value, [parameter.key]: true }
  try {
    const multipart = new FormData()
    multipart.append('file', file, file.name)
    multipart.append('mediaType', parameter.type)
    multipart.append('purpose', 'dispatch')
    const response = await http.post('/media', multipart, {
      timeout: 600000,
    })
    const asset = normalizeCloudTemplateMediaUpload(unwrap(response), {
      filename: file.name,
      mimeType: file.type,
      mediaType: parameter.type,
    })
    if (uploadGeneration !== templateMediaGeneration) return
    if (!asset.url) throw new Error('O upload foi concluído sem a URL pública exigida pela Meta.')
    if (asset.mediaType && asset.mediaType !== parameter.type) {
      throw new Error(`O servidor identificou ${asset.mediaType}, mas este campo exige ${parameter.type}.`)
    }

    const reference = asset.url
    templateMediaAssets.value = { ...templateMediaAssets.value, [parameter.key]: asset }
    templateVariables.value = { ...templateVariables.value, [parameter.key]: reference }
    templateMediaModes.value = { ...templateMediaModes.value, [parameter.key]: 'upload' }
    $q.notify({ type: 'positive', message: `${cloudTemplateMediaConfig(parameter).label} enviado e pronto para o template.` })
  } catch (error) {
    if (uploadGeneration !== templateMediaGeneration) return
    clearTemplateMediaState(parameter)
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível enviar esta mídia.') })
  } finally {
    if (uploadGeneration === templateMediaGeneration) {
      templateMediaUploading.value = { ...templateMediaUploading.value, [parameter.key]: false }
    }
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

async function loadConversation(conversation, { background = false, markRead = false } = {}) {
  const id = cloudConversationId(conversation)
  if (!id) return
  const requestId = ++messagesRequest
  if (!background) {
    messages.value = []
    historyNote.value = ''
    loadingMessages.value = true
  }
  try {
    const [detailResult, messagesResult] = await Promise.all([
      http.get(`/whatsapp-cloud/conversations/${id}`).catch(() => null),
      http.get(`/whatsapp-cloud/conversations/${id}/messages`, { params: { page: 1, limit: 100 } }),
    ])
    if (requestId !== messagesRequest || cloudConversationId(selected.value) !== id) return
    const detail = detailResult ? unwrap(detailResult) : null
    if (detail) {
      selected.value = { ...selected.value, ...detail }
      conversations.value = upsertCloudConversation(conversations.value, selected.value)
    }
    const loadedMessages = asList(unwrap(messagesResult), 'items')
    messages.value = mergeCloudMessages([...messages.value, ...loadedMessages])
    if (!messages.value.length) historyNote.value = 'Ainda não há mensagens armazenadas nesta conversa.'
    else historyNote.value = ''
    if (markRead && Number(selected.value?.unreadCount || conversation.unreadCount || 0) > 0) {
      await markConversationRead(id).catch(() => undefined)
    }
    await scrollToBottom()
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
    resetTemplateComposer()
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
  historyNote.value = ''
  sendMode.value = 'quick'
  draft.value = ''
  templateId.value = null
  resetTemplateComposer()
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
  if (sendMode.value === 'template' && templateMediaUploadPending.value) {
    $q.notify({ type: 'warning', message: 'Aguarde o término do upload da mídia.' })
    return
  }
  const missingParameters = selectedTemplateParameters.value.filter(
    (parameter) => !String(templateVariables.value[parameter.key] || '').trim(),
  )
  if (sendMode.value === 'template' && missingParameters.length) {
    $q.notify({
      type: 'warning',
      message: `Preencha: ${missingParameters.map((parameter) => parameter.label).join(', ')}.`,
    })
    return
  }
  const invalidMedia = selectedTemplateParameters.value.filter(
    (parameter) => isCloudTemplateMediaParameter(parameter) && !templateMediaReferenceIsValid(parameter),
  )
  if (sendMode.value === 'template' && invalidMedia.length) {
    $q.notify({
      type: 'warning',
      message: `Use uma URL HTTPS ou envie o arquivo em: ${invalidMedia.map((parameter) => parameter.label).join(', ')}.`,
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
          variables: cloudChatTemplateVariablesForSend(
            selectedTemplateParameters.value,
            templateVariables.value,
            templateMediaAssets.value,
          ),
        },
        idempotencyKey: newIdempotencyKey('whatsapp-cloud-chat'),
      })
      resetTemplateComposer()
      $q.notify({ type: 'positive', message: 'Template colocado na fila de envio.' })
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
  messages.value = mergeCloudMessages([...messages.value, payload.message])
  historyNote.value = ''
  void scrollToBottom()
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
              <div class="chat-flags">
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

          <div ref="messagesPanel" class="message-stream">
            <div v-if="loadingMessages" class="q-pa-lg">
              <q-skeleton v-for="item in 5" :key="item" type="text" />
            </div>
            <template v-else>
              <div v-if="!messages.length" class="day-note">
                {{ historyNote || 'Nenhuma mensagem armazenada' }}
              </div>
              <div
                v-for="item in messages"
                :key="item.providerMessageId || item.id || item._id || item.timestamp"
                :class="['message-row', { 'message-row--mine': item.direction === 'outbound' || item.fromMe }]"
              >
                <div class="message-bubble">
                  <div>{{ messageBody(item) }}</div>
                  <span>
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

          <footer class="message-composer">
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
                  @update:model-value="resetTemplateComposer"
                />
                <template v-for="parameter in selectedTemplateParameters" :key="parameter.key">
                  <q-input
                    v-if="!isCloudTemplateMediaParameter(parameter)"
                    v-model="templateVariables[parameter.key]"
                    dense
                    outlined
                    :label="parameter.label"
                    :disable="!selectedCanCompose"
                  />
                  <section v-else class="template-media-field">
                    <header class="template-media-field__header">
                      <div>
                        <q-icon :name="cloudTemplateMediaConfig(parameter).icon" color="positive" />
                        <strong>{{ parameter.label }}</strong>
                        <q-badge outline color="positive" :label="cloudTemplateMediaConfig(parameter).label" />
                      </div>
                      <q-btn flat round dense icon="help_outline" aria-label="Ajuda sobre a mídia">
                        <q-tooltip max-width="300px">{{ templateMediaHelp(parameter) }}</q-tooltip>
                      </q-btn>
                    </header>

                    <q-btn-toggle
                      v-model="templateMediaModes[parameter.key]"
                      no-caps
                      unelevated
                      spread
                      toggle-color="positive"
                      color="grey-2"
                      text-color="dark"
                      :options="[
                        { label: 'Link HTTPS', value: 'url', icon: 'link' },
                        { label: 'Enviar arquivo', value: 'upload', icon: 'upload_file' },
                      ]"
                      :disable="!selectedCanCompose || templateMediaUploading[parameter.key]"
                      class="template-media-mode"
                      @update:model-value="onTemplateMediaModeChange(parameter, $event)"
                    />

                    <q-input
                      v-if="templateMediaModes[parameter.key] !== 'upload'"
                      v-model.trim="templateVariables[parameter.key]"
                      dense
                      outlined
                      type="url"
                      label="Link público HTTPS *"
                      hint="A Meta precisa acessar este endereço sem login ou cookies."
                      :disable="!selectedCanCompose"
                    >
                      <template #prepend><q-icon name="https" /></template>
                    </q-input>
                    <q-file
                      v-else
                      :model-value="templateMediaFiles[parameter.key] || null"
                      dense
                      outlined
                      clearable
                      :accept="cloudTemplateMediaConfig(parameter).accept"
                      :max-file-size="cloudTemplateMediaConfig(parameter).maxBytes"
                      :label="`Selecionar ${cloudTemplateMediaConfig(parameter).label.toLowerCase()} *`"
                      :hint="`Upload seguro · até ${Math.round(cloudTemplateMediaConfig(parameter).maxBytes / 1024 / 1024)} MB`"
                      :disable="!selectedCanCompose || templateMediaUploading[parameter.key]"
                      @update:model-value="uploadTemplateMedia(parameter, $event)"
                      @rejected="onTemplateMediaRejected(parameter, $event)"
                    >
                      <template #prepend><q-icon name="attach_file" /></template>
                      <template #append>
                        <q-spinner v-if="templateMediaUploading[parameter.key]" color="positive" size="22px" />
                      </template>
                    </q-file>

                    <q-linear-progress
                      v-if="templateMediaUploading[parameter.key]"
                      indeterminate
                      rounded
                      color="positive"
                      class="template-media-progress"
                    />

                    <div v-if="templateMediaPreviewUrl(parameter)" class="template-media-preview">
                      <q-img
                        v-if="parameter.type === 'image'"
                        :src="templateMediaPreviewUrl(parameter)"
                        :alt="templateMediaFilename(parameter)"
                        fit="cover"
                        loading="lazy"
                        class="template-media-preview__image"
                      />
                      <video
                        v-else-if="parameter.type === 'video'"
                        :src="templateMediaPreviewUrl(parameter)"
                        controls
                        preload="metadata"
                        class="template-media-preview__video"
                      />
                      <a
                        v-else
                        :href="templateMediaPreviewUrl(parameter)"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="template-media-preview__document"
                      >
                        <q-icon name="description" size="28px" />
                        <span><strong>{{ templateMediaFilename(parameter) }}</strong><small>Abrir arquivo em nova guia</small></span>
                        <q-icon name="open_in_new" />
                      </a>
                      <footer v-if="templateMediaAssets[parameter.key]" class="template-media-preview__meta">
                        <q-icon name="cloud_done" color="positive" />
                        <span>{{ templateMediaAssets[parameter.key].filename }}</span>
                        <q-badge v-if="templateMediaAssets[parameter.key].mimeType" color="grey-7" :label="templateMediaAssets[parameter.key].mimeType" />
                      </footer>
                    </div>
                  </section>
                </template>
              </div>
              <q-btn
                round
                unelevated
                color="positive"
                icon="send"
                aria-label="Enviar mensagem"
                :loading="sending"
                :disable="!selectedCanCompose
                  || (sendMode === 'template' && templateMediaUploadPending)
                  || (sendMode === 'quick' ? !draft.trim() : !templateId)"
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

.message-stream {
  max-height: 490px;
  padding: 24px;
  overflow: auto;
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

.message-bubble span {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 3px;
  margin-top: 3px;
  color: #72837f;
  font-size: 0.62rem;
}

.message-composer {
  padding: 10px 16px 12px;
  border-top: 1px solid rgba(3, 21, 21, 0.08);
  background: rgba(255, 255, 255, 0.78);
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

.template-media-field {
  display: grid;
  grid-column: 1 / -1;
  gap: 9px;
  min-width: 0;
  padding: 11px;
  border: 1px solid rgba(22, 130, 109, 0.16);
  border-radius: 13px;
  background: rgba(239, 251, 248, 0.76);
}

.template-media-field__header,
.template-media-field__header > div,
.template-media-preview__meta,
.template-media-preview__document {
  display: flex;
  align-items: center;
}

.template-media-field__header {
  justify-content: space-between;
  gap: 8px;
}

.template-media-field__header > div {
  flex-wrap: wrap;
  gap: 7px;
  min-width: 0;
}

.template-media-mode {
  overflow: hidden;
  border: 1px solid rgba(22, 130, 109, 0.12);
  border-radius: 9px;
}

.template-media-progress {
  margin-top: -5px;
}

.template-media-preview {
  min-width: 0;
  overflow: hidden;
  border: 1px solid rgba(3, 21, 21, 0.08);
  border-radius: 11px;
  background: #fff;
}

.template-media-preview__image,
.template-media-preview__video {
  display: block;
  width: 100%;
  max-height: 220px;
  background: #edf5f3;
}

.template-media-preview__image {
  min-height: 130px;
}

.template-media-preview__video {
  object-fit: contain;
}

.template-media-preview__document {
  gap: 10px;
  min-width: 0;
  padding: 12px;
  color: #176e60;
  text-decoration: none;
}

.template-media-preview__document span {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
}

.template-media-preview__document strong,
.template-media-preview__document small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-media-preview__document small {
  color: #71827f;
}

.template-media-preview__meta {
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  padding: 8px 10px;
  border-top: 1px solid rgba(3, 21, 21, 0.07);
  color: #5f7671;
  font-size: 0.7rem;
}

.template-media-preview__meta span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
