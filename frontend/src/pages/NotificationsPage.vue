<script>
const AUTOMATIC_CONTACT_VARIABLES = new Set(['displayName', 'email', 'phone', 'telegramUsername'])

export function notificationTemplateVariableDefinitions(template = {}, channel = '') {
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
      channels: [...new Set([...(existing.channels || []), channel].filter(Boolean))],
    })
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
      })
    }
  }
  return [...definitions.values()]
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

export function notificationTemplatePreview(template = {}, channel = '', variables = {}) {
  const telegramDefinition = template.payload?.telegram
  const telegramText = telegramDefinition?.text || telegramDefinition?.caption
  const rawBody = channel === 'telegram'
    ? (telegramText || template.body)
    : channel === 'email'
      ? (template.html || template.body)
      : template.body
  const body = previewInterpolate(previewPlainText(rawBody), variables)
  const subject = channel === 'email'
    ? previewInterpolate(previewPlainText(template.subject || 'Sem assunto'), variables)
    : ''
  const officialName = channel === 'whatsapp_cloud'
    ? String(template.externalTemplateName || template.name || '').trim()
    : ''
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
    mediaType: channel === 'telegram' && ['photo', 'video'].includes(telegramDefinition?.kind)
      ? telegramDefinition.kind
      : '',
    mediaUrl: channel === 'telegram' && ['photo', 'video'].includes(telegramDefinition?.kind)
      ? String(telegramDefinition.mediaUrl || '')
      : '',
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
  variableValues: {},
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
const selectedGlobalTemplates = computed(() => selectedGlobalChannelOptions.value
  .map((channel) => ({ channel: channel.value, template: templateById(activeGlobalTemplateIds.value[channel.value]) }))
  .filter((entry) => entry.template))
const unavailableGlobalChannelOptions = computed(() => selectedGlobalChannelOptions.value
  .filter((channel) => !channel.enabled))
const variableDefinitions = computed(() => tab.value === 'global'
  ? mergeNotificationVariableDefinitions(selectedGlobalTemplates.value)
  : tab.value === 'template' && selectedTemplate.value
    ? notificationTemplateVariableDefinitions(selectedTemplate.value, form.channel)
    : [])

const selectedRecipients = computed(() => form.contactIds.length + form.groupIds.length)
const previewVariables = computed(() => Object.fromEntries(variableDefinitions.value.map((definition) => [
  definition.key,
  form.variableValues[definition.key],
])))
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
      preview: notificationTemplatePreview(selectedTemplate.value, form.channel, previewVariables.value),
    }]
  }
  return selectedGlobalChannelOptions.value.map((channel) => {
    const template = templateById(activeGlobalTemplateIds.value[channel.value])
    return {
      ...channel,
      templateName: template?.name || template?.title || 'Template',
      preview: notificationTemplatePreview(template, channel.value, previewVariables.value),
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

const deliveryColumns = [
  { name: 'createdAt', label: 'Quando', field: 'createdAt', align: 'left' },
  { name: 'mode', label: 'Tipo', field: 'mode', align: 'left' },
  { name: 'channel', label: 'Canal', field: 'channel', align: 'left' },
  { name: 'recipient', label: 'Destino', field: 'recipient', align: 'left' },
  { name: 'status', label: 'Status', field: 'status', align: 'left' },
  { name: 'actions', label: '', field: 'actions', align: 'right' },
]

const dispatchDetailColumns = [
  { name: 'contact', label: 'Contato', field: 'contactId', align: 'left' },
  { name: 'channel', label: 'Canal', field: 'channel', align: 'left' },
  { name: 'status', label: 'Status', field: 'status', align: 'left' },
  { name: 'attempts', label: 'Tentativas', field: 'attempts', align: 'center' },
  { name: 'detail', label: 'Detalhe', field: 'errorMessage', align: 'left' },
  { name: 'updatedAt', label: 'Atualizado', field: 'updatedAt', align: 'left' },
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

function variableInputType(definition = {}) {
  return ['image', 'video', 'document'].includes(definition.type) ? 'url' : 'text'
}

function variableHint(definition = {}) {
  const channelNamesByValue = Object.fromEntries(channels.value.map((channel) => [channel.value, channel.label]))
  const usedBy = (definition.channels || []).map((channel) => channelNamesByValue[channel] || channel).join(', ')
  const example = definition.example === undefined || definition.example === null || definition.example === ''
    ? ''
    : `Exemplo: ${definition.example}`
  return [usedBy ? `Usado em ${usedBy}` : '', example].filter(Boolean).join(' · ')
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
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

async function loadData() {
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
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível preparar o disparador.') })
  } finally {
    loading.value = false
  }
}

function buildPayload() {
  const variables = Object.fromEntries(variableDefinitions.value
    .map((definition) => [definition.key, form.variableValues[definition.key]])
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== ''))
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
      variables,
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
      description="Monte o envio, revise os destinos e deixe a API aplicar consentimento, idempotência e limites de cada provedor."
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

              <section v-if="panel !== 'quick' && variableDefinitions.length" class="full-span variable-fields">
                <div class="variable-fields__heading">
                  <q-icon name="tune" color="primary" />
                  <div><strong>Dados variáveis</strong><span>O sistema monta o payload; preencha somente os campos usados pelos templates escolhidos.</span></div>
                </div>
                <div class="variable-fields__grid">
                  <q-input
                    v-for="definition in variableDefinitions"
                    :key="definition.key"
                    v-model="form.variableValues[definition.key]"
                    outlined
                    clearable
                    :type="variableInputType(definition)"
                    :label="definition.label"
                    :hint="variableHint(definition)"
                    :placeholder="definition.example === undefined ? undefined : String(definition.example || '')"
                  />
                </div>
              </section>
              <q-banner v-else-if="panel !== 'quick' && (panel !== 'global' || selectedGlobalTemplates.length)" rounded class="full-span no-variable-banner">
                <template #avatar><q-icon name="check_circle" color="positive" /></template>
                Os templates escolhidos não exigem valores adicionais.
              </q-banner>
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
          <h2 class="section-title">Canais prontos</h2>
          <p class="section-copy">Teste um por vez. No modo global, apenas os prontos e autorizados entram no envio.</p>
          <div class="channel-ready-list">
            <div v-for="channel in channels" :key="channel.value">
              <q-icon :name="channel.icon" />
              <span>{{ channel.label }}</span>
              <q-icon :name="channel.enabled ? 'check_circle' : 'remove_circle_outline'" :color="channel.enabled ? 'positive' : 'grey-5'" :aria-label="channel.enabled ? 'Disponível' : 'Ignorado'" />
            </div>
          </div>
        </q-card>
        <q-card flat class="glass-card section-card safety-card">
          <q-icon name="verified_user" size="34px" color="primary" />
          <h2 class="section-title q-mt-md">Envio responsável</h2>
          <p class="section-copy">A exclusão ou revogação de um contato deve prevalecer até sobre tarefas já enfileiradas.</p>
        </q-card>
      </aside>
    </section>

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
        <template #body-cell-mode="props"><q-td :props="props">{{ props.row.mode || props.row.type || '—' }}</q-td></template>
        <template #body-cell-channel="props"><q-td :props="props"><q-badge outline color="primary" :label="props.row.channel || 'global'" /></q-td></template>
        <template #body-cell-recipient="props"><q-td :props="props">{{ props.row.recipient?.name || props.row.contact?.name || props.row.recipient || 'Lote' }}</q-td></template>
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
                  <strong>{{ props.row.mode || props.row.kind || 'Disparo' }}</strong>
                  <span>{{ formatDate(props.row.createdAt) }}</span>
                </div>
                <q-badge :color="statusColor(props.row.status)" :label="statusLabel(props.row.status)" />
              </header>
              <div class="activity-mobile-card__meta">
                <span><q-icon name="lan" />{{ channelLabel(props.row.channel) }}</span>
                <span><q-icon name="people" />{{ props.row.recipient?.name || props.row.contact?.name || props.row.recipient || 'Lote' }}</span>
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
                <div v-if="item.preview.mediaUrl" class="review-media">
                  <img
                    v-if="item.preview.mediaType === 'photo'"
                    :src="item.preview.mediaUrl"
                    alt="Imagem do template Telegram"
                    referrerpolicy="no-referrer"
                  />
                  <video v-else :src="item.preview.mediaUrl" controls preload="metadata" />
                </div>
                <div v-if="item.preview.html" class="review-html" v-html="safeReviewHtml(item.preview.html)" />
                <p v-else>{{ item.preview.body }}</p>
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
.variable-fields,
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

.global-template-grid,
.variable-fields {
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

.global-template-card header,
.variable-fields__heading {
  display: flex;
  align-items: center;
  gap: 9px;
}

.global-template-card header {
  margin-bottom: 12px;
}

.global-template-card header strong,
.global-template-card header span,
.variable-fields__heading strong,
.variable-fields__heading span {
  display: block;
}

.global-template-card header span,
.variable-fields__heading span {
  color: #667a77;
  font-size: 0.72rem;
}

.variable-fields {
  padding: 15px;
  border: 1px solid rgba(36, 123, 160, 0.16);
  border-radius: 15px;
  background: rgba(234, 249, 255, 0.5);
}

.variable-fields__grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.no-variable-banner {
  border: 1px solid rgba(39, 183, 159, 0.18);
  background: rgba(39, 183, 159, 0.07);
  color: #385c56;
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

.safety-card {
  background: linear-gradient(145deg, rgba(255,255,255,.8), rgba(130,248,230,.15));
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
