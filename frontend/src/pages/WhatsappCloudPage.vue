<script>
const BUILTIN_PARAMETERS = Object.freeze({
  order_confirmation: Object.freeze([
    Object.freeze({ key: 'customerName', label: 'Nome do cliente', example: 'John Doe', type: 'text', componentType: 'body' }),
    Object.freeze({ key: 'orderNumber', label: 'Número do pedido', example: '123456', type: 'text', componentType: 'body' }),
    Object.freeze({ key: 'orderDate', label: 'Data do pedido', example: 'Jul 20, 2026', type: 'text', componentType: 'body' }),
  ]),
  plain_text: Object.freeze([]),
  hello_world: Object.freeze([]),
})

const PRESET_BY_TEMPLATE_NAME = Object.freeze({
  jaspers_market_order_confirmation_v1: 'order_confirmation',
  jaspers_market_plain_text_v1: 'plain_text',
  hello_world: 'hello_world',
})

export function recordId(record) {
  return record?.id || record?._id
}

export function cloudIdentityOf(contact = {}) {
  return (contact.channels || []).find((item) => String(item.channel).replaceAll('-', '_') === 'whatsapp_cloud') || null
}

export function isCloudContactEligible(contact = {}) {
  const identity = cloudIdentityOf(contact)
  return Boolean(contact.active !== false && !contact.notificationDisabled && identity?.authorized && identity?.consentStatus === 'granted')
}

export function isCloudSendConfigured(status = {}) {
  return Boolean(status.sendConfigured ?? status.configured)
}

export function cloudContactIneligibility(contact = {}) {
  const identity = cloudIdentityOf(contact)
  if (!identity) return 'Sem identidade do WhatsApp Cloud'
  if (contact.active === false || contact.notificationDisabled) return 'Contato desativado para notificações'
  if (!identity.authorized || identity.consentStatus !== 'granted') return 'Permissão do WhatsApp Cloud não concedida'
  return null
}

export function cloudPresetOf(template = {}) {
  return template.whatsappCloudPreset || PRESET_BY_TEMPLATE_NAME[template.externalTemplateName] || null
}

export function isOfficialCloudTemplateAvailable(template = {}) {
  return template.active !== false && Boolean(
    template.externalTemplateName
      && (template.templateType === 'approved_template' || template.whatsappCloudPreset || template.payload?.components || template.payload?.builder),
  )
}

function parameterPlaceholder(parameter = {}) {
  return parameter.text
    || parameter.payload
    || parameter.coupon_code
    || parameter.currency?.fallback_value
    || parameter.date_time?.fallback_value
    || parameter.image?.link
    || parameter.document?.link
    || parameter.video?.link
    || ''
}

function keyFromParameter(parameter, fallback) {
  return String(parameterPlaceholder(parameter)).match(/{{\s*([a-zA-Z0-9_]+)\s*}}/)?.[1] || fallback
}

export function templateParameterDefinitions(template = {}) {
  const builder = template.payload?.builder?.components
  if (Array.isArray(builder)) {
    return builder.flatMap((component, componentIndex) => (component.parameters || []).map((parameter, parameterIndex) => ({
      key: parameter.key || `campo_${componentIndex + 1}_${parameterIndex + 1}`,
      parameterName: parameter.parameterName || '',
      label: parameter.label || `Campo ${parameterIndex + 1}`,
      example: parameter.example || '',
      type: parameter.type || 'text',
      currencyCode: parameter.currencyCode || '',
      componentType: component.type || 'body',
      componentIndex,
      parameterIndex,
    })))
  }

  const preset = cloudPresetOf(template)
  if (BUILTIN_PARAMETERS[preset]) return BUILTIN_PARAMETERS[preset].map((parameter) => ({ ...parameter }))

  const components = template.payload?.components || []
  const fromComponents = components.flatMap((component, componentIndex) => (component.parameters || []).map((parameter, parameterIndex) => ({
    key: keyFromParameter(parameter, template.variables?.[parameterIndex] || `campo_${componentIndex + 1}_${parameterIndex + 1}`),
    label: `Campo ${parameterIndex + 1}`,
    example: '',
    type: parameter.type || 'text',
    componentType: component.type || 'body',
    componentIndex,
    parameterIndex,
  })))
  if (fromComponents.length) return fromComponents
  return (template.variables || []).map((key, index) => ({
    key,
    label: `Campo ${index + 1}`,
    example: '',
    type: 'text',
    componentType: 'body',
    componentIndex: 0,
    parameterIndex: index,
  }))
}

export function selectedGroupEligibility(selectedGroupIds = [], groups = [], contacts = []) {
  const selected = new Set(selectedGroupIds.map(String))
  const contactMap = new Map(contacts.map((contact) => [String(recordId(contact)), contact]))
  const contactIds = [...new Set(groups
    .filter((group) => selected.has(String(recordId(group))))
    .flatMap((group) => group.contacts || group.contactIds || [])
    .map((contact) => String(recordId(contact) || contact)))]
  const eligible = []
  const ineligible = []
  for (const contactId of contactIds) {
    const contact = contactMap.get(contactId)
    if (contact && isCloudContactEligible(contact)) eligible.push(contact)
    else ineligible.push({
      contactId,
      contact,
      reason: contact ? cloudContactIneligibility(contact) : 'Contato não encontrado ou removido',
    })
  }
  return { contactIds, eligible, ineligible }
}

export function normalizeDeliveryIssuePage(payload = {}, contacts = []) {
  const contactMap = new Map(contacts.map((contact) => [String(recordId(contact)), contact]))
  const rawItems = Array.isArray(payload.items) ? payload.items : []
  const items = rawItems.map((issue, index) => {
    const contactId = String(issue.contactId || '')
    return {
      ...issue,
      id: issue.id || issue._id || `${issue.notificationId || 'notification'}-${contactId || index}-${issue.errorCode || issue.status || 'issue'}`,
      contactId,
      errorMessage: issue.errorMessage || 'Entrega não elegível',
      contact: contactMap.get(contactId) || null,
    }
  })
  return {
    items,
    total: Math.max(0, Number(payload.total ?? items.length) || 0),
    page: Math.max(1, Number(payload.page) || 1),
    limit: Math.max(1, Number(payload.limit) || 10),
  }
}

export function dispatchDeliveryCount(dispatch = {}, status) {
  const value = dispatch?.[`${status}Count`] ?? dispatch?.summary?.[status]
  return Math.max(0, Number(value) || 0)
}
</script>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useQuasar } from 'quasar'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import ContactDialog from '../components/ContactDialog.vue'
import { asList, errorMessage, fetchAll, http, unwrap } from '../services/http.js'
import { connectSocket, getSocket } from '../services/socket.js'
import {
  identityIdentifiers,
  identityRegistrationSource,
  isAutomaticIdentity,
} from '../services/contact-identities.js'

const $q = useQuasar()
const loading = ref(false)
const sending = ref(false)
const contactDialog = ref(false)
const issueDialog = ref(false)
const eligibilityDialog = ref(false)
const eligibilitySearch = ref('')
const issuesLoading = ref(false)
const editingContact = ref(null)
const selectedIssue = ref(null)
const contacts = ref([])
const cloudContactRecords = ref([])
const groups = ref([])
const templates = ref([])
const events = ref([])
const deliveryIssues = ref([])
const issueNotificationId = ref(null)
const issuePagination = ref({ page: 1, rowsPerPage: 10, rowsNumber: 0 })
const issuesSection = ref(null)
const cloudStatus = ref({})
const lastDispatch = ref(null)
let webhookRefreshTimer = null
let issueRequestSequence = 0

const form = reactive({
  recipientMode: 'contact',
  contactId: null,
  groupIds: [],
  templateId: null,
  variableValues: {},
})

const cloudContacts = computed(() => cloudContactRecords.value)
const eligibleContacts = computed(() => cloudContacts.value.filter(isCloudContactEligible))
const webhookContacts = computed(() => cloudContacts.value.filter((contact) => {
  const identity = cloudIdentityOf(contact)
  return isAutomaticIdentity(identity)
}))

const contactOptions = computed(() => eligibleContacts.value.map((contact) => ({
  label: `${contact.displayName || contact.name || 'Sem nome'} · ${cloudIdentityOf(contact)?.address || contact.phone || 'sem telefone'}`,
  value: recordId(contact),
})))

const groupOptions = computed(() => groups.value
  .filter((group) => group.active !== false && !group.notificationDisabled)
  .map((group) => ({
    label: `${group.name || 'Grupo sem nome'} · ${group.contactCount ?? group.contacts?.length ?? 0} contato(s)`,
    value: recordId(group),
  })))

const officialTemplates = computed(() => templates.value.filter(isOfficialCloudTemplateAvailable))

const templateOptions = computed(() => officialTemplates.value.map((template) => ({
  label: `${template.name || template.title}${template.languageCode ? ` · ${template.languageCode}` : ''}`,
  value: recordId(template),
  description: template.description || template.body || '',
})))

const selectedTemplate = computed(() => officialTemplates.value.find((template) => String(recordId(template)) === String(form.templateId)) || null)
const selectedTemplateParameters = computed(() => templateParameterDefinitions(selectedTemplate.value || {}))
const selectedTemplateDescription = computed(() => selectedTemplate.value?.description
  || selectedTemplate.value?.body
  || 'Template oficial aprovado pela Meta.')

const groupEligibility = computed(() => selectedGroupEligibility(form.groupIds, groups.value, contacts.value))
const lastDispatchId = computed(() => recordId(lastDispatch.value) || lastDispatch.value?.notificationId || null)
const lastDispatchQueued = computed(() => dispatchDeliveryCount(lastDispatch.value, 'queued'))
const lastDispatchSkipped = computed(() => dispatchDeliveryCount(lastDispatch.value, 'skipped'))
const lastDispatchFailed = computed(() => dispatchDeliveryCount(lastDispatch.value, 'failed'))
const lastDispatchHasIssues = computed(() => lastDispatchSkipped.value + lastDispatchFailed.value > 0)
const filteredGroupIneligible = computed(() => {
  const search = String(eligibilitySearch.value || '').trim().toLocaleLowerCase('pt-BR')
  if (!search) return groupEligibility.value.ineligible
  return groupEligibility.value.ineligible.filter((item) => [
    item.contact?.displayName,
    item.contact?.name,
    cloudIdentityOf(item.contact || {})?.address,
    item.contactId,
    item.reason,
  ].filter(Boolean).some((value) => String(value).toLocaleLowerCase('pt-BR').includes(search)))
})

const webhookReady = computed(() => Boolean(cloudStatus.value.webhookConfigured))
const cloudSendReady = computed(() => isCloudSendConfigured(cloudStatus.value))
const webhookStatusLabel = computed(() => webhookReady.value ? 'Webhook pronto para receber' : 'Webhook com configuração pendente')
const webhookStatusDescription = computed(() => {
  if (webhookReady.value) return 'Verify Token e App Secret estão configurados. Mensagens recebidas podem cadastrar contatos automaticamente.'
  if (cloudStatus.value.webhookVerificationConfigured) return 'A callback pode ser validada; cadastre também o App Secret para processar os eventos POST.'
  return 'Cadastre o Verify Token e o App Secret no menu Início para habilitar o recebimento.'
})

const eventColumns = [
  { name: 'createdAt', label: 'Quando', field: 'createdAt', align: 'left' },
  { name: 'event', label: 'Ação', field: 'action', align: 'left' },
  { name: 'contact', label: 'Contato', field: 'contact', align: 'left' },
  { name: 'status', label: 'Status', field: 'status', align: 'left' },
  { name: 'message', label: 'Resumo', field: 'message', align: 'left' },
]

const webhookContactColumns = [
  { name: 'contact', label: 'Contato', field: 'displayName', align: 'left' },
  { name: 'ids', label: 'IDs da Meta', field: 'phone', align: 'left' },
  { name: 'permission', label: 'Permissão', field: 'permission', align: 'left' },
  { name: 'updatedAt', label: 'Última interação', field: 'updatedAt', align: 'left' },
  { name: 'actions', label: '', field: 'actions', align: 'right' },
]

const issueColumns = [
  { name: 'contact', label: 'Contato', field: 'contactId', align: 'left' },
  { name: 'status', label: 'Status', field: 'status', align: 'left' },
  { name: 'reason', label: 'Motivo', field: 'errorMessage', align: 'left' },
  { name: 'createdAt', label: 'Quando', field: 'createdAt', align: 'left' },
  { name: 'actions', label: '', field: 'actions', align: 'right' },
]

const ineligibleColumns = [
  { name: 'contact', label: 'Contato', field: 'contactId', align: 'left' },
  { name: 'reason', label: 'Por que não será enviado', field: 'reason', align: 'left' },
  { name: 'actions', label: '', field: 'actions', align: 'right' },
]

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value))
}

function cloudIdentifiers(contact) {
  return identityIdentifiers(cloudIdentityOf(contact) || {})
}

function cloudRegistration(contact) {
  return identityRegistrationSource(cloudIdentityOf(contact) || {})
}

function statusColor(value = '') {
  return { delivered: 'positive', read: 'positive', sent: 'info', received: 'info', failed: 'negative', error: 'negative', skipped: 'warning' }[String(value).toLowerCase()] || 'grey-7'
}

function contextSummary(event) {
  const context = event.context
  if (!context) return event.message || event.summary || 'Evento processado'
  if (typeof context === 'string') return context
  const error = Array.isArray(context.errors) ? context.errors[0] : null
  if (error) {
    return [event.message, error.code, error.details || error.message || error.title, context.retryScheduled ? 'retry agendado' : null]
      .filter(Boolean).join(' · ')
  }
  if (event.message || event.summary) return event.message || event.summary
  return Object.entries(context).slice(0, 4).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')
}

function eventStatus(event = {}) {
  return event.context?.status || event.status || event.level || 'received'
}

function parameterIcon(type) {
  return { text: 'text_fields', currency: 'payments', date_time: 'event', image: 'image', document: 'description', video: 'videocam', payload: 'touch_app', coupon_code: 'confirmation_number' }[type] || 'data_object'
}

function parameterHint(parameter) {
  const namedPrefix = parameter.parameterName ? `Parâmetro Meta: {{${parameter.parameterName}}}. ` : ''
  if (parameter.type === 'currency') return `${namedPrefix}${parameter.currencyCode ? `Moeda: ${parameter.currencyCode}. ` : ''}${parameter.example ? `Exemplo exibido: ${parameter.example}. ` : ''}Informe um valor numérico.`
  if (parameter.example) return `${namedPrefix}Exemplo: ${parameter.example}`
  if (['image', 'document', 'video'].includes(parameter.type)) return `${namedPrefix}Informe uma URL HTTPS acessível pela Meta`
  if (parameter.type === 'currency') return 'Informe o valor de fallback exibido ao destinatário'
  if (parameter.type === 'date_time') return 'Informe a data/hora no formato aprovado no template'
  if (parameter.type === 'coupon_code') return 'Informe exatamente o código promocional que será copiado'
  return `${namedPrefix}Variável interna: ${parameter.key}`
}

function inputType(parameter) {
  if (parameter.type === 'currency') return 'number'
  return ['image', 'document', 'video'].includes(parameter.type) ? 'url' : 'text'
}

function contactById(id) {
  return contacts.value.find((contact) => String(recordId(contact)) === String(id)) || null
}

function issueContact(issue) {
  return issue?.contact || contactById(issue?.contactId)
}

async function loadDeliveryIssues({ pagination = issuePagination.value, notificationId = issueNotificationId.value, showError = true } = {}) {
  const requestId = ++issueRequestSequence
  const page = Math.max(1, Number(pagination?.page) || 1)
  const limit = Math.max(1, Number(pagination?.rowsPerPage || pagination?.limit) || 10)
  issuesLoading.value = true
  try {
    const response = await http.get('/notifications/delivery-issues', {
      params: {
        channel: 'whatsapp_cloud',
        page,
        limit,
        ...(notificationId ? { notificationId } : {}),
      },
    })
    if (requestId !== issueRequestSequence) return
    const result = normalizeDeliveryIssuePage(unwrap(response) || {}, contacts.value)
    deliveryIssues.value = result.items
    issuePagination.value = {
      page: result.page,
      rowsPerPage: result.limit,
      rowsNumber: result.total,
    }
  } catch (error) {
    if (requestId === issueRequestSequence && showError) {
      $q.notify({ type: 'warning', message: errorMessage(error, 'Não foi possível carregar as falhas de entrega.') })
    }
  } finally {
    if (requestId === issueRequestSequence) issuesLoading.value = false
  }
}

function onIssuesRequest({ pagination }) {
  loadDeliveryIssues({ pagination })
}

async function showDispatchIssues() {
  if (!lastDispatchId.value) return
  issueNotificationId.value = lastDispatchId.value
  await loadDeliveryIssues({
    pagination: { ...issuePagination.value, page: 1 },
    notificationId: issueNotificationId.value,
  })
  await nextTick()
  const element = issuesSection.value?.$el || issuesSection.value
  element?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}

async function showAllDeliveryIssues() {
  issueNotificationId.value = null
  await loadDeliveryIssues({
    pagination: { ...issuePagination.value, page: 1 },
    notificationId: null,
  })
}

function setRecipientMode(mode) {
  form.recipientMode = mode
  if (mode === 'contact') form.groupIds = []
  else form.contactId = null
}

function newIdempotencyKey(prefix) {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${value}`
}

function resetTemplateValues() {
  form.variableValues = Object.fromEntries(selectedTemplateParameters.value.map((parameter) => [
    parameter.key,
    parameter.type === 'currency' ? '' : parameter.example || '',
  ]))
}

watch(() => form.templateId, resetTemplateValues)

async function loadData() {
  loading.value = true
  try {
    const [contactItems, cloudContactItems, groupItems, templateItems, logResponse, statusResponse] = await Promise.all([
      fetchAll('/contacts', { preferredKey: 'contacts', maxItems: 10000, maxPages: 100 }),
      fetchAll('/contacts', { params: { channel: 'whatsapp_cloud' }, preferredKey: 'contacts', maxItems: 10000, maxPages: 100 }),
      fetchAll('/contact-groups', { preferredKey: 'groups' }),
      fetchAll('/templates', { params: { channel: 'whatsapp_cloud' }, preferredKey: 'templates' }),
      http.get('/logs', { params: { channel: 'whatsapp_cloud', limit: 50 } }),
      http.get('/whatsapp-cloud/status'),
    ])
    contacts.value = contactItems
    cloudContactRecords.value = cloudContactItems
    groups.value = groupItems
    templates.value = templateItems
    events.value = asList(unwrap(logResponse), 'logs')
    cloudStatus.value = unwrap(statusResponse) || {}
    await loadDeliveryIssues({ showError: false })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível carregar o canal oficial.') })
  } finally {
    loading.value = false
  }
}

function validateSend() {
  if (!cloudSendReady.value) return 'Configure o Access Token e o Phone Number ID antes de enviar.'
  if (form.recipientMode === 'contact' && !form.contactId) return 'Selecione um contato autorizado.'
  if (form.recipientMode === 'groups' && !form.groupIds.length) return 'Selecione ao menos um grupo.'
  if (!form.templateId) return 'Selecione um template oficial.'
  const missing = selectedTemplateParameters.value.filter((parameter) => !String(form.variableValues[parameter.key] || '').trim())
  if (missing.length) return `Preencha: ${missing.map((parameter) => parameter.label).join(', ')}.`
  return null
}

async function send() {
  const validationError = validateSend()
  if (validationError) {
    $q.notify({ type: 'warning', message: validationError })
    return
  }

  sending.value = true
  try {
    const response = await http.post('/notifications', {
      kind: 'template',
      channel: 'whatsapp_cloud',
      contactIds: form.recipientMode === 'contact' ? [form.contactId] : [],
      groupIds: form.recipientMode === 'groups' ? form.groupIds : [],
      templateId: form.templateId,
      content: { variables: { ...form.variableValues } },
      idempotencyKey: newIdempotencyKey('whatsapp-cloud'),
    })
    lastDispatch.value = unwrap(response) || {}
    const queued = lastDispatchQueued.value
    const skipped = lastDispatchSkipped.value
    const failed = lastDispatchFailed.value
    $q.notify({
      type: queued ? 'positive' : 'warning',
      message: queued ? `${queued} entrega(s) colocada(s) na fila.` : 'Nenhuma entrega elegível foi enfileirada.',
      caption: skipped || failed ? `${skipped} ignorado(s) e ${failed} falha(s); veja os detalhes no painel.` : undefined,
    })
    await loadData()
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'A Cloud API recusou o envio.') })
  } finally {
    sending.value = false
  }
}

function openCreateContact() {
  editingContact.value = null
  contactDialog.value = true
}

function openEditContact(contact) {
  if (!contact) return
  editingContact.value = contact
  contactDialog.value = true
}

function openIssue(issue) {
  selectedIssue.value = { ...issue, contact: issueContact(issue) }
  issueDialog.value = true
}

function openEligibilityDetails() {
  eligibilitySearch.value = ''
  eligibilityDialog.value = true
}

function editIneligibleContact(item) {
  eligibilityDialog.value = false
  openEditContact(item.contact)
}

function removeContact(contact) {
  $q.dialog({
    title: 'Remover contato?',
    message: `${contact.displayName || 'Este contato'} será removido também dos grupos. O histórico de auditoria seguirá as regras da API.`,
    cancel: { flat: true, label: 'Cancelar' },
    ok: { color: 'negative', label: 'Remover' },
  }).onOk(async () => {
    try {
      await http.delete(`/contacts/${recordId(contact)}`)
      $q.notify({ type: 'positive', message: 'Contato removido.' })
      if (String(form.contactId) === String(recordId(contact))) form.contactId = null
      await loadData()
    } catch (error) {
      $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível remover o contato.') })
    }
  })
}

function onWebhookEvent(event) {
  events.value = [{ id: `live-${Date.now()}`, createdAt: event.at, ...event }, ...events.value].slice(0, 50)
  clearTimeout(webhookRefreshTimer)
  webhookRefreshTimer = setTimeout(loadData, 400)
}

function onQueueLog(log) {
  if (log?.channel !== 'whatsapp_cloud' || !String(log.action || '').startsWith('notification.')) return
  events.value = [log, ...events.value.filter((item) => String(recordId(item)) !== String(recordId(log)))].slice(0, 50)
  clearTimeout(webhookRefreshTimer)
  webhookRefreshTimer = setTimeout(loadData, 400)
}

onMounted(() => {
  loadData()
  const socket = connectSocket()
  socket.on('whatsapp_cloud:webhook', onWebhookEvent)
  socket.on('whatsapp-cloud:webhook', onWebhookEvent)
  socket.on('log:created', onQueueLog)
})

onBeforeUnmount(() => {
  clearTimeout(webhookRefreshTimer)
  const socket = getSocket()
  socket.off('whatsapp_cloud:webhook', onWebhookEvent)
  socket.off('whatsapp-cloud:webhook', onWebhookEvent)
  socket.off('log:created', onQueueLog)
})
</script>

<template>
  <q-page class="page-container">
    <PageHeader
      eyebrow="Meta Cloud API"
      title="WhatsApp oficial"
      description="Envie templates aprovados pela fila, acompanhe elegibilidade e gerencie contatos recebidos pelo webhook."
      icon="cloud_sync"
    >
      <template #actions>
        <q-btn outline color="primary" no-caps icon="person_add" label="Cadastrar contato" @click="openCreateContact" />
        <q-btn outline color="primary" no-caps icon="refresh" label="Atualizar" :loading="loading" @click="loadData" />
      </template>
    </PageHeader>

    <div class="cloud-policy q-mb-lg">
      <q-icon name="verified" size="26px" />
      <div>
        <strong>Somente templates oficiais</strong>
        <span>Esta tela envia exclusivamente templates já aprovados na Meta. O processamento acontece pela fila e respeita consentimento por contato.</span>
      </div>
    </div>

    <q-banner rounded class="webhook-contact-banner q-mb-lg">
      <template #avatar><q-icon name="how_to_reg" color="primary" /></template>
      Quando o comando de autorização configurado é recebido pelo WhatsApp Cloud ou Web, o mesmo contato autoriza as duas integrações. Se uma identidade ainda não existir, sua autorização fica pendente até a primeira interação real, sem criar um destino artificial. O administrador ainda pode revisar ou revogar Web e Cloud separadamente.
    </q-banner>

    <section class="page-grid cloud-layout q-mb-lg">
      <q-card flat class="glass-card section-card send-card">
        <div class="section-title-row">
          <div><h2 class="section-title">Novo disparo oficial</h2><p class="section-copy">Escolha um contato ou um ou mais grupos. Os destinos inelegíveis serão registrados, sem bloquear os demais.</p></div>
          <q-badge outline color="primary" label="ENVIO PELA FILA" />
        </div>

        <div class="recipient-switch q-my-lg">
          <button type="button" :class="{ active: form.recipientMode === 'contact' }" @click="setRecipientMode('contact')"><q-icon name="person" />Contato único</button>
          <button type="button" :class="{ active: form.recipientMode === 'groups' }" @click="setRecipientMode('groups')"><q-icon name="groups" />Grupo(s)</button>
        </div>

        <div class="send-form">
          <q-select
            v-if="form.recipientMode === 'contact'"
            v-model="form.contactId"
            outlined
            stack-label
            clearable
            use-input
            emit-value
            map-options
            :options="contactOptions"
            label="Contato autorizado *"
            hint="Somente contatos ativos com consentimento concedido"
            class="large-field"
          />
          <q-select
            v-else
            v-model="form.groupIds"
            outlined
            stack-label
            multiple
            use-chips
            use-input
            emit-value
            map-options
            :options="groupOptions"
            label="Grupos de contatos *"
            hint="A fila remove duplicados e valida cada contato"
            class="large-field"
          />

          <q-select
            v-model="form.templateId"
            outlined
            stack-label
            emit-value
            map-options
            :options="templateOptions"
            label="Template oficial aprovado *"
            class="large-field"
          >
            <template #option="scope">
              <q-item v-bind="scope.itemProps" class="template-option">
                <q-item-section avatar><q-icon name="verified" color="primary" /></q-item-section>
                <q-item-section><q-item-label>{{ scope.opt.label }}</q-item-label><q-item-label caption>{{ scope.opt.description || 'Template oficial Meta' }}</q-item-label></q-item-section>
              </q-item>
            </template>
          </q-select>

          <div v-if="selectedTemplate" class="official-template-summary">
            <q-icon name="verified" />
            <div>
              <strong>{{ selectedTemplate.externalTemplateName }} · {{ selectedTemplate.languageCode || 'pt_BR' }}</strong>
              <span>{{ selectedTemplateDescription }}</span>
            </div>
          </div>

          <section v-if="selectedTemplateParameters.length" class="parameter-form-section">
            <div class="parameter-form-heading"><div><strong>Valores do template</strong><span>Preencha os campos na ordem configurada no template.</span></div><q-badge color="primary" :label="`${selectedTemplateParameters.length} campo(s)`" /></div>
            <div class="parameter-form-grid">
              <q-input
                v-for="parameter in selectedTemplateParameters"
                :key="parameter.key"
                v-model="form.variableValues[parameter.key]"
                outlined
                stack-label
                :type="inputType(parameter)"
                :label="`${parameter.label} *`"
                :hint="parameterHint(parameter)"
                class="large-field"
              >
                <template #prepend><q-icon :name="parameterIcon(parameter.type)" color="primary" /></template>
              </q-input>
            </div>
          </section>

          <q-banner v-else-if="selectedTemplate" rounded class="ready-template-banner">
            <template #avatar><q-icon name="check_circle" color="primary" /></template>
            Este template não exige valores adicionais e está pronto para envio.
          </q-banner>

          <section v-if="form.recipientMode === 'groups' && form.groupIds.length" class="eligibility-panel">
            <header><div><strong>Elegibilidade da seleção</strong><span>{{ groupEligibility.contactIds.length }} contato(s) únicos nos grupos</span></div><div class="eligibility-counts"><q-badge color="positive" :label="`${groupEligibility.eligible.length} elegíveis`" /><q-badge color="warning" text-color="dark" :label="`${groupEligibility.ineligible.length} inelegíveis`" /></div></header>
            <div v-if="groupEligibility.ineligible.length" class="ineligible-list">
              <div v-for="item in groupEligibility.ineligible.slice(0, 12)" :key="item.contactId" class="ineligible-row">
                <q-icon name="warning" color="warning" />
                <div><strong>{{ item.contact?.displayName || item.contactId }}</strong><span>{{ item.reason }}</span></div>
                <q-btn v-if="item.contact" flat color="primary" no-caps icon="manage_accounts" label="Editar permissão" @click="openEditContact(item.contact)" />
              </div>
              <div class="more-issues">
                <q-btn
                  outline
                  color="primary"
                  no-caps
                  icon="manage_search"
                  :label="`Ver todos os ${groupEligibility.ineligible.length} inelegíveis`"
                  @click="openEligibilityDetails"
                />
              </div>
            </div>
          </section>
        </div>

        <q-banner v-if="!cloudSendReady" rounded class="ready-template-banner q-mt-lg">
          <template #avatar><q-icon name="settings" color="warning" /></template>
          O webhook pode continuar recebendo contatos, mas o envio exige Access Token e Phone Number ID.
          <template #action><q-btn flat color="primary" no-caps label="Configurar envio" to="/" /></template>
        </q-banner>

        <div class="send-actions"><q-btn color="dark" unelevated no-caps icon-right="send" label="Enviar template pela fila" :loading="sending" :disable="!cloudSendReady" @click="send" /></div>
      </q-card>

      <aside class="page-grid stats-column">
        <q-card flat class="glass-card section-card stat-card"><q-icon name="description" color="primary" size="30px" /><div><strong>{{ officialTemplates.length }}</strong><span>templates oficiais disponíveis</span></div></q-card>
        <q-card flat class="glass-card section-card stat-card"><q-icon name="contacts" color="primary" size="30px" /><div><strong>{{ eligibleContacts.length }}</strong><span>contatos elegíveis</span></div></q-card>
        <q-card flat class="glass-card section-card stat-card"><q-icon name="auto_awesome" color="primary" size="30px" /><div><strong>{{ webhookContacts.length }}</strong><span>contatos auto-cadastrados</span></div></q-card>
        <q-card flat class="glass-card section-card webhook-card">
          <div class="row items-center q-gutter-sm"><span class="status-dot" :class="webhookReady ? 'status-dot--online' : 'status-dot--warning'" /><strong>{{ webhookStatusLabel }}</strong></div>
          <p class="section-copy">{{ webhookStatusDescription }}</p>
        </q-card>
      </aside>
    </section>

    <q-card v-if="lastDispatch" flat class="glass-card section-card q-mb-lg dispatch-result-card">
      <div class="section-title-row">
        <div><h2 class="section-title">Resultado do último disparo</h2><p class="section-copy">Resumo criado sem carregar milhares de entregas no navegador.</p></div>
        <q-btn flat round icon="close" aria-label="Fechar resultado" @click="lastDispatch = null" />
      </div>
      <div class="result-counters">
        <div><strong>{{ lastDispatchQueued }}</strong><span>enfileirados</span></div>
        <div><strong>{{ lastDispatchSkipped }}</strong><span>ignorados</span></div>
        <div><strong>{{ lastDispatchFailed }}</strong><span>falhas</span></div>
      </div>
      <div v-if="lastDispatchHasIssues && lastDispatchId" class="dispatch-result-actions">
        <q-btn outline color="primary" no-caps icon="manage_search" label="Ver detalhes deste disparo" :loading="issuesLoading && issueNotificationId === lastDispatchId" @click="showDispatchIssues" />
      </div>
    </q-card>

    <q-card flat class="glass-card section-card q-mb-lg webhook-contacts-card">
      <div class="section-title-row">
        <div><h2 class="section-title">Contatos recebidos pelo webhook</h2><p class="section-copy">Mensagens recebidas cadastram ou atualizam o contato. O comando configurado concede Web e Cloud em conjunto; ajustes administrativos permanecem individuais.</p></div>
        <q-badge color="primary" :label="`${webhookContacts.length} AUTO-CADASTRADO(S)`" />
      </div>
      <q-banner rounded class="webhook-contact-banner q-mb-md"><template #avatar><q-icon name="auto_awesome" color="primary" /></template><strong>Cadastro automático ativo.</strong> Você pode atualizar, editar consentimento ou remover cada contato abaixo.</q-banner>
      <EmptyState v-if="!loading && !webhookContacts.length" icon="person_search" title="Nenhum contato recebido ainda" description="Quando alguém enviar uma mensagem ao número oficial, o contato aparecerá aqui." />
      <q-table v-else flat :rows="webhookContacts" :columns="webhookContactColumns" row-key="id" :loading="loading" :rows-per-page-options="[5, 10, 25]">
        <template #body-cell-contact="props"><q-td :props="props"><div class="contact-name"><q-avatar color="teal-1" text-color="primary" icon="person" /><div><strong>{{ props.row.displayName || 'Sem nome' }}</strong><q-badge outline color="positive" icon="auto_awesome" :label="`Cadastro automático: ${cloudRegistration(props.row).label}`" /></div></div></q-td></template>
        <template #body-cell-ids="props">
          <q-td :props="props">
            <div class="cloud-contact-identifiers">
              <code v-for="identifier in cloudIdentifiers(props.row)" :key="identifier.key"><span>{{ identifier.label }}</span>{{ identifier.value }}</code>
            </div>
          </q-td>
        </template>
        <template #body-cell-permission="props"><q-td :props="props"><q-badge :color="isCloudContactEligible(props.row) ? 'positive' : 'warning'" :label="isCloudContactEligible(props.row) ? 'Autorizado' : 'Revisar permissão'" /></q-td></template>
        <template #body-cell-updatedAt="props"><q-td :props="props">{{ formatDate(cloudIdentityOf(props.row)?.interactedAt || props.row.updatedAt) }}</q-td></template>
        <template #body-cell-actions="props"><q-td :props="props"><q-btn flat round dense icon="edit" aria-label="Editar contato" @click="openEditContact(props.row)" /><q-btn flat round dense color="negative" icon="delete" aria-label="Remover contato" @click="removeContact(props.row)" /></q-td></template>
      </q-table>
    </q-card>

    <q-card ref="issuesSection" flat class="glass-card section-card q-mb-lg">
      <div class="section-title-row">
        <div>
          <h2 class="section-title">Contatos ignorados ou com falha</h2>
          <p class="section-copy">{{ issueNotificationId ? 'Exibindo somente o disparo selecionado.' : 'Histórico paginado de elegibilidade e entrega da fila.' }}</p>
        </div>
        <div class="issue-history-actions">
          <q-badge color="warning" text-color="dark" :label="`${issuePagination.rowsNumber} ocorrência(s)`" />
          <q-btn v-if="issueNotificationId" flat color="primary" no-caps icon="history" label="Ver todo o histórico" :loading="issuesLoading" @click="showAllDeliveryIssues" />
        </div>
      </div>
      <q-table
        flat
        class="issues-table q-mt-md"
        :rows="deliveryIssues"
        :columns="issueColumns"
        row-key="id"
        v-model:pagination="issuePagination"
        :loading="issuesLoading"
        :rows-per-page-options="[10, 25, 50, 100]"
        @request="onIssuesRequest"
      >
        <template #body-cell-contact="props"><q-td :props="props"><strong>{{ issueContact(props.row)?.displayName || issueContact(props.row)?.name || props.row.contactId }}</strong></q-td></template>
        <template #body-cell-status="props"><q-td :props="props"><q-badge :color="statusColor(props.row.status)" :label="props.row.status" /></q-td></template>
        <template #body-cell-reason="props"><q-td :props="props" class="issue-reason">{{ props.row.errorMessage }}</q-td></template>
        <template #body-cell-createdAt="props"><q-td :props="props">{{ formatDate(props.row.createdAt) }}</q-td></template>
        <template #body-cell-actions="props">
          <q-td :props="props" class="no-wrap">
            <q-btn flat dense color="primary" no-caps label="Detalhes" @click="openIssue(props.row)" />
            <q-btn v-if="issueContact(props.row)" flat dense color="primary" no-caps icon="manage_accounts" label="Editar permissão" @click="openEditContact(issueContact(props.row))" />
          </q-td>
        </template>
        <template #no-data><div class="full-width text-center q-pa-lg text-muted">Nenhuma entrega ignorada ou com falha neste filtro.</div></template>
      </q-table>
    </q-card>

    <q-card flat class="glass-card section-card">
      <div class="toolbar-row"><div><h2 class="section-title">Eventos do webhook</h2><p class="section-copy">Status de entrega e respostas recentes, sem expor o payload secreto.</p></div></div>
      <EmptyState v-if="!loading && !events.length" icon="webhook" title="Nenhum evento recente" description="Validações e retornos da Meta aparecerão aqui." />
      <q-table v-else flat :rows="events" :columns="eventColumns" row-key="id" :loading="loading" :rows-per-page-options="[10, 25, 50]">
        <template #body-cell-createdAt="props"><q-td :props="props">{{ formatDate(props.row.createdAt || props.row.timestamp) }}</q-td></template>
        <template #body-cell-event="props"><q-td :props="props"><strong>{{ props.row.action || props.row.event || props.row.type || 'webhook' }}</strong></q-td></template>
        <template #body-cell-contact="props"><q-td :props="props">{{ props.row.contact?.displayName || props.row.contact?.name || props.row.contactName || contactById(props.row.context?.contactId)?.displayName || props.row.context?.phone || props.row.phone || '—' }}</q-td></template>
        <template #body-cell-status="props"><q-td :props="props"><q-badge :color="statusColor(eventStatus(props.row))" :label="eventStatus(props.row)" /></q-td></template>
        <template #body-cell-message="props"><q-td :props="props" class="truncate" style="max-width: 360px">{{ contextSummary(props.row) }}</q-td></template>
      </q-table>
    </q-card>

    <ContactDialog v-model="contactDialog" :contact="editingContact" @saved="loadData" />

    <q-dialog v-model="eligibilityDialog" :maximized="$q.screen.lt.md">
      <q-card class="eligibility-dialog">
        <q-card-section class="row items-start q-gutter-md eligibility-dialog__header">
          <div>
            <div class="text-h6 text-weight-bold">Contatos inelegíveis do grupo</div>
            <div class="text-caption text-muted">Revise todos antes de enfileirar. Nenhum contato desta lista receberá a notificação.</div>
          </div>
          <q-space />
          <q-badge color="warning" text-color="dark" :label="`${groupEligibility.ineligible.length} contato(s)`" />
          <q-btn v-close-popup flat round icon="close" aria-label="Fechar" />
        </q-card-section>
        <q-separator />
        <q-card-section class="eligibility-dialog__body">
          <q-input
            v-model="eligibilitySearch"
            outlined
            clearable
            debounce="200"
            label="Buscar por contato, telefone ou motivo"
            class="large-field q-mb-md"
          >
            <template #prepend><q-icon name="search" /></template>
          </q-input>
          <q-table
            flat
            :rows="filteredGroupIneligible"
            :columns="ineligibleColumns"
            row-key="contactId"
            :rows-per-page-options="[10, 25, 50, 100]"
          >
            <template #body-cell-contact="props">
              <q-td :props="props">
                <div class="ineligible-contact-cell">
                  <strong>{{ props.row.contact?.displayName || props.row.contact?.name || props.row.contactId }}</strong>
                  <span>{{ cloudIdentityOf(props.row.contact || {})?.address || 'Sem identidade Cloud' }}</span>
                </div>
              </q-td>
            </template>
            <template #body-cell-reason="props"><q-td :props="props" class="issue-reason">{{ props.row.reason }}</q-td></template>
            <template #body-cell-actions="props">
              <q-td :props="props">
                <q-btn
                  v-if="props.row.contact"
                  outline
                  dense
                  color="primary"
                  no-caps
                  icon="manage_accounts"
                  label="Editar permissão"
                  @click="editIneligibleContact(props.row)"
                />
              </q-td>
            </template>
            <template #no-data><div class="full-width text-center q-pa-lg text-muted">Nenhum contato corresponde à busca.</div></template>
          </q-table>
        </q-card-section>
        <q-card-actions align="right" class="eligibility-dialog__footer"><q-btn v-close-popup flat no-caps label="Fechar" /></q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="issueDialog">
      <q-card class="issue-dialog">
        <q-card-section class="row items-center issue-dialog__header"><div><div class="text-h6 text-weight-bold">Detalhes da entrega</div><div class="text-caption text-muted">Registro persistido pela fila</div></div><q-space /><q-btn v-close-popup flat round icon="close" /></q-card-section>
        <q-separator />
        <q-card-section v-if="selectedIssue" class="issue-details">
          <div><span>Contato</span><strong>{{ selectedIssue.contact?.displayName || selectedIssue.contactId }}</strong></div>
          <div><span>Status</span><q-badge :color="statusColor(selectedIssue.status)" :label="selectedIssue.status" /></div>
          <div><span>Tentativas</span><strong>{{ selectedIssue.attempts ?? 0 }}</strong></div>
          <div><span>Código</span><code>{{ selectedIssue.errorCode || 'DELIVERY_ERROR' }}</code></div>
          <div><span>Motivo</span><strong>{{ selectedIssue.errorMessage }}</strong></div>
          <div><span>Quando</span><strong>{{ formatDate(selectedIssue.createdAt) }}</strong></div>
        </q-card-section>
        <q-card-actions align="right" class="issue-dialog__footer"><q-btn v-if="selectedIssue?.contact" v-close-popup outline color="primary" no-caps icon="manage_accounts" label="Editar permissão" @click="openEditContact(selectedIssue.contact)" /><q-btn v-close-popup flat no-caps label="Fechar" /></q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<style scoped>
.cloud-policy {
  display: flex;
  align-items: flex-start;
  gap: 13px;
  padding: 16px;
  border: 1px solid rgba(22, 134, 111, 0.2);
  border-radius: 16px;
  background: rgba(222, 248, 242, 0.68);
  color: #315f56;
}

.cloud-policy strong,
.cloud-policy span,
.stat-card strong,
.stat-card span {
  display: block;
}

.cloud-policy span {
  margin-top: 3px;
  font-size: 0.84rem;
}

.cloud-layout {
  grid-template-columns: minmax(0, 1.55fr) minmax(260px, 0.45fr);
  align-items: start;
}

.section-title-row,
.parameter-form-heading,
.eligibility-panel > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.recipient-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 5px;
  border-radius: 15px;
  background: rgba(3, 21, 21, 0.05);
}

.recipient-switch button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 48px;
  border: 0;
  border-radius: 11px;
  background: transparent;
  color: #526964;
  cursor: pointer;
  font: inherit;
  font-weight: 750;
}

.recipient-switch button.active {
  background: #fff;
  color: #137d6c;
  box-shadow: 0 6px 18px rgba(5, 70, 61, 0.08);
}

.send-form {
  display: grid;
  gap: 18px;
}

.large-field :deep(.q-field__control) {
  min-height: 62px;
  border-radius: 14px;
}

.large-field :deep(.q-field__label) {
  color: #526964;
  font-size: 0.97rem;
  font-weight: 650;
}

.large-field :deep(.q-field__native),
.large-field :deep(.q-field__input) {
  font-size: 1rem;
}

.template-option {
  min-height: 68px;
}

.official-template-summary,
.ready-template-banner,
.webhook-contact-banner {
  border: 1px solid rgba(22, 134, 111, 0.2);
  background: rgba(222, 248, 242, 0.58);
  color: #315f56;
}

.official-template-summary {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 14px;
}

.official-template-summary .q-icon {
  margin-top: 1px;
  color: #16866f;
  font-size: 21px;
}

.official-template-summary strong,
.official-template-summary span {
  display: block;
}

.official-template-summary span {
  margin-top: 3px;
  font-size: 0.84rem;
  line-height: 1.45;
}

.parameter-form-section,
.eligibility-panel {
  padding: 18px;
  border: 1px solid rgba(3, 21, 21, 0.09);
  border-radius: 16px;
  background: rgba(247, 253, 251, 0.82);
}

.parameter-form-heading > div,
.eligibility-panel > header > div:first-child {
  display: grid;
  gap: 3px;
}

.parameter-form-heading span,
.eligibility-panel header span {
  color: #6d817d;
  font-size: 0.8rem;
}

.parameter-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-top: 17px;
}

.eligibility-counts {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 7px;
}

.ineligible-list,
.issue-list {
  display: grid;
  gap: 9px;
  margin-top: 14px;
}

.ineligible-row,
.issue-row {
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 58px;
  padding: 9px 11px;
  border: 1px solid rgba(192, 125, 28, 0.15);
  border-radius: 12px;
  background: rgba(255, 248, 230, 0.65);
}

.ineligible-row > div,
.issue-row > div {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
}

.ineligible-row span,
.issue-row span {
  color: #756b59;
  font-size: 0.78rem;
}

.more-issues {
  color: #776c57;
  font-size: 0.8rem;
  text-align: center;
}

.send-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 22px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 15px;
}

.stat-card strong {
  font-size: 1.65rem;
  line-height: 1;
}

.stat-card span {
  margin-top: 4px;
  color: #667a77;
  font-size: 0.76rem;
}

.webhook-card {
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.82), rgba(130, 248, 230, 0.17));
}

.result-counters {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}

.result-counters > div {
  min-width: 120px;
  padding: 13px;
  border-radius: 13px;
  background: rgba(39, 183, 159, 0.08);
}

.result-counters strong,
.result-counters span {
  display: block;
}

.result-counters strong {
  font-size: 1.5rem;
}

.result-counters span {
  color: #657a76;
  font-size: 0.78rem;
}

.dispatch-result-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.issue-history-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.webhook-contact-banner {
  font-size: 0.86rem;
}

.contact-name {
  display: flex;
  align-items: center;
  gap: 10px;
}

.contact-name > div {
  display: grid;
  justify-items: start;
  gap: 4px;
}

.cloud-contact-identifiers {
  display: grid;
  min-width: 220px;
  gap: 5px;
}

.cloud-contact-identifiers code {
  display: grid;
  max-width: 330px;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 7px;
  overflow: hidden;
  color: #2d514b;
  font-size: 0.7rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cloud-contact-identifiers code span {
  color: #71837f;
  font-family: inherit;
}

.issue-dialog {
  display: flex;
  flex-direction: column;
  width: min(620px, calc(100vw - 32px));
  max-width: 620px !important;
  max-height: calc(100dvh - 32px);
  overflow: hidden;
  border-radius: 20px;
}

.eligibility-dialog {
  display: flex;
  flex-direction: column;
  width: min(1040px, calc(100vw - 32px));
  max-width: 1040px !important;
  max-height: calc(100dvh - 32px);
  overflow: hidden;
  border-radius: 20px;
}

.eligibility-dialog__body,
.issue-dialog > .issue-details {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.eligibility-dialog__header,
.eligibility-dialog__footer,
.issue-dialog__header,
.issue-dialog__footer {
  flex: 0 0 auto;
}

.eligibility-dialog__footer,
.issue-dialog__footer {
  flex-wrap: wrap;
}

.issue-reason {
  min-width: 260px;
  max-width: 520px;
  white-space: normal;
}

.ineligible-contact-cell {
  display: grid;
  gap: 3px;
  min-width: 190px;
}

.ineligible-contact-cell span {
  color: #6c807c;
  font-size: 0.78rem;
}

.issues-table :deep(.q-table__middle),
.eligibility-dialog :deep(.q-table__middle) {
  overflow-x: auto;
}

.issue-details {
  display: grid;
  gap: 12px;
}

.issue-details > div {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(3, 21, 21, 0.08);
}

.issue-details span {
  color: #6c807c;
  font-size: 0.8rem;
}

@media (max-width: 900px) {
  .cloud-layout {
    grid-template-columns: 1fr;
  }

  .stats-column {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 650px) {
  .eligibility-dialog {
    width: 100%;
    max-width: 100% !important;
    max-height: 100dvh;
    border-radius: 0;
  }

  .eligibility-dialog__header,
  .eligibility-dialog__body {
    padding-right: 16px;
    padding-left: 16px;
  }

  .eligibility-dialog__header {
    flex-wrap: wrap;
  }

  .eligibility-dialog__footer {
    padding-bottom: max(12px, env(safe-area-inset-bottom));
  }

  .issue-dialog__footer .q-btn {
    flex: 1 1 auto;
  }

  .recipient-switch,
  .parameter-form-grid,
  .stats-column {
    grid-template-columns: 1fr;
  }

  .section-title-row,
  .parameter-form-heading,
  .eligibility-panel > header,
  .ineligible-row,
  .issue-row {
    align-items: stretch;
    flex-direction: column;
  }

  .eligibility-counts {
    justify-content: flex-start;
  }

  .issue-history-actions {
    align-items: flex-start;
    justify-content: flex-start;
    flex-direction: column;
  }

  .send-actions .q-btn {
    width: 100%;
  }

  .issue-details > div {
    grid-template-columns: 1fr;
  }
}
</style>
