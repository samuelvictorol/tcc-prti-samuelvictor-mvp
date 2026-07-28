<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import DOMPurify from 'dompurify'
import { useQuasar } from 'quasar'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import ContactDialog from '../components/ContactDialog.vue'
import { asList, errorMessage, fetchAll, http, unwrap } from '../services/http.js'
import { connectSocket, getSocket } from '../services/socket.js'
import {
  channelIdentity,
  deliveryStatusColor,
  dispatchDeliveryCount,
  isContactEligible,
  newIdempotencyKey,
  normalizeDeliveryPage,
  normalizeDeliveryIssuePage,
  recordId,
  selectedRecipientsEligibility,
} from '../services/bulk-notifications.js'

const CHANNEL = 'email'
const $q = useQuasar()
const loading = ref(false)
const sending = ref(false)
const issuesLoading = ref(false)
const deliveriesLoading = ref(false)
const contactDialog = ref(false)
const editingContact = ref(null)
const mode = ref('quick')
const contacts = ref([])
const groups = ref([])
const templates = ref([])
const history = ref([])
const deliveryIssues = ref([])
const dispatchDeliveries = ref([])
const lastDispatch = ref(null)
const issueNotificationId = ref(null)
const issuesSection = ref(null)
const issuePagination = ref({ page: 1, rowsPerPage: 10, rowsNumber: 0 })
const deliveryPagination = ref({ page: 1, rowsPerPage: 10, rowsNumber: 0 })
let refreshTimer
let issueRequestSequence = 0
let deliveryRequestSequence = 0

const form = reactive({
  recipientMode: 'contacts',
  contactIds: [],
  groupIds: [],
  subject: '',
  body: '',
  format: 'html',
  templateId: null,
})

const eligibleContacts = computed(() => contacts.value.filter((contact) => isContactEligible(contact, CHANNEL)))
const contactOptions = computed(() => eligibleContacts.value.map((contact) => ({
  label: `${contact.displayName || contact.name || 'Sem nome'} · ${channelIdentity(contact, CHANNEL)?.address || contact.email || 'sem email'}`,
  value: recordId(contact),
})))
const groupOptions = computed(() => groups.value
  .filter((group) => group.active !== false && !group.notificationDisabled)
  .map((group) => ({
    label: `${group.name || 'Grupo sem nome'} · ${group.contactCount ?? group.contacts?.length ?? 0} contato(s)`,
    value: recordId(group),
  })))
const templateOptions = computed(() => templates.value
  .filter((template) => template.active !== false)
  .map((template) => ({ label: template.name || template.title, value: recordId(template) })))
const selectedTemplate = computed(() => templates.value.find((template) => String(recordId(template)) === String(form.templateId)) || null)
const recipientEligibility = computed(() => selectedRecipientsEligibility({
  selectedContactIds: form.recipientMode === 'contacts' ? form.contactIds : [],
  selectedGroupIds: form.recipientMode === 'groups' ? form.groupIds : [],
  groups: groups.value,
  contacts: contacts.value,
  channel: CHANNEL,
}))
const safePreview = computed(() => {
  if (mode.value === 'template') {
    const template = selectedTemplate.value
    const content = template?.html || template?.body || template?.text || ''
    return DOMPurify.sanitize(content, { USE_PROFILES: { html: true } })
  }
  return DOMPurify.sanitize(
    form.format === 'html' ? form.body : `<p>${String(form.body || '').replace(/\n/g, '<br>')}</p>`,
    { USE_PROFILES: { html: true } },
  )
})
const previewSubject = computed(() => mode.value === 'template'
  ? selectedTemplate.value?.subject || selectedTemplate.value?.name || 'Template de email'
  : form.subject || 'Seu assunto aparecerá aqui')
const lastDispatchId = computed(() => recordId(lastDispatch.value) || lastDispatch.value?.notificationId || null)
const lastDispatchQueued = computed(() => dispatchDeliveryCount(lastDispatch.value, 'queued'))
const lastDispatchSkipped = computed(() => dispatchDeliveryCount(lastDispatch.value, 'skipped'))
const lastDispatchFailed = computed(() => dispatchDeliveryCount(lastDispatch.value, 'failed'))
const lastDispatchHasIssues = computed(() => lastDispatchSkipped.value + lastDispatchFailed.value > 0)

const historyColumns = [
  { name: 'createdAt', label: 'Quando', field: 'createdAt', align: 'left' },
  { name: 'event', label: 'Evento', field: 'action', align: 'left' },
  { name: 'contact', label: 'Contato', field: 'contact', align: 'left' },
  { name: 'status', label: 'Status', field: 'status', align: 'left' },
  { name: 'message', label: 'Resumo', field: 'message', align: 'left' },
]
const issueColumns = [
  { name: 'contact', label: 'Contato', field: 'contactId', align: 'left' },
  { name: 'status', label: 'Status', field: 'status', align: 'left' },
  { name: 'reason', label: 'Motivo', field: 'errorMessage', align: 'left' },
  { name: 'createdAt', label: 'Quando', field: 'createdAt', align: 'left' },
  { name: 'actions', label: '', field: 'actions', align: 'right' },
]
const deliveryColumns = [
  { name: 'contact', label: 'Contato', field: 'contactId', align: 'left' },
  { name: 'status', label: 'Status', field: 'status', align: 'left' },
  { name: 'attempts', label: 'Tentativas', field: 'attempts', align: 'center' },
  { name: 'detail', label: 'Detalhe', field: 'errorMessage', align: 'left' },
  { name: 'updatedAt', label: 'Atualizado', field: 'updatedAt', align: 'left' },
]

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function logStatus(log = {}) {
  return log.context?.status || log.status || (log.level === 'error' ? 'failed' : log.action?.split('.').at(-1)) || 'info'
}

function logContact(log = {}) {
  return log.contact?.displayName || log.contact?.name || log.context?.contactName || log.context?.email || log.recipient || 'Lote'
}

function setRecipientMode(recipientMode) {
  form.recipientMode = recipientMode
  if (recipientMode === 'contacts') form.groupIds = []
  else form.contactIds = []
}

async function loadDeliveryIssues({ pagination = issuePagination.value, notificationId = issueNotificationId.value, showError = true } = {}) {
  const requestId = ++issueRequestSequence
  const page = Math.max(1, Number(pagination?.page) || 1)
  const limit = Math.max(1, Number(pagination?.rowsPerPage || pagination?.limit) || 10)
  issuesLoading.value = true
  try {
    const result = normalizeDeliveryIssuePage(unwrap(await http.get('/notifications/delivery-issues', {
      params: { channel: CHANNEL, page, limit, ...(notificationId ? { notificationId } : {}) },
    })) || {}, contacts.value)
    if (requestId !== issueRequestSequence) return
    deliveryIssues.value = result.items
    issuePagination.value = { page: result.page, rowsPerPage: result.limit, rowsNumber: result.total }
  } catch (error) {
    if (requestId === issueRequestSequence && showError) {
      $q.notify({ type: 'warning', message: errorMessage(error, 'Não foi possível carregar as falhas de email.') })
    }
  } finally {
    if (requestId === issueRequestSequence) issuesLoading.value = false
  }
}

async function loadDispatchDeliveries({ pagination = deliveryPagination.value, showError = true } = {}) {
  if (!lastDispatchId.value) {
    dispatchDeliveries.value = []
    return
  }
  const requestId = ++deliveryRequestSequence
  const page = Math.max(1, Number(pagination?.page) || 1)
  const limit = Math.max(1, Number(pagination?.rowsPerPage || pagination?.limit) || 10)
  deliveriesLoading.value = true
  try {
    const result = normalizeDeliveryPage(unwrap(await http.get(`/notifications/${lastDispatchId.value}/deliveries`, {
      params: { channel: CHANNEL, page, limit },
    })) || {}, contacts.value)
    if (requestId !== deliveryRequestSequence) return
    dispatchDeliveries.value = result.items
    deliveryPagination.value = { page: result.page, rowsPerPage: result.limit, rowsNumber: result.total }
  } catch (error) {
    if (requestId === deliveryRequestSequence && showError) {
      $q.notify({ type: 'warning', message: errorMessage(error, 'Não foi possível carregar as entregas deste disparo.') })
    }
  } finally {
    if (requestId === deliveryRequestSequence) deliveriesLoading.value = false
  }
}

async function loadData() {
  loading.value = true
  try {
    const [contactItems, groupItems, templateItems, logResponse] = await Promise.all([
      fetchAll('/contacts', { preferredKey: 'contacts', maxItems: 10000, maxPages: 100 }),
      fetchAll('/contact-groups', { preferredKey: 'groups' }),
      fetchAll('/templates', { params: { channel: CHANNEL }, preferredKey: 'templates' }),
      http.get('/logs', { params: { channel: CHANNEL, limit: 50 } }),
    ])
    contacts.value = contactItems
    groups.value = groupItems
    templates.value = templateItems
    history.value = asList(unwrap(logResponse), 'logs')
    await loadDeliveryIssues({ showError: false })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível carregar o Gmail.') })
  } finally {
    loading.value = false
  }
}

function validateSend() {
  if (form.recipientMode === 'contacts' && !form.contactIds.length) return 'Selecione ao menos um contato autorizado.'
  if (form.recipientMode === 'groups' && !form.groupIds.length) return 'Selecione ao menos um grupo de contatos.'
  if (mode.value === 'template' && !form.templateId) return 'Selecione um template.'
  if (mode.value === 'quick' && (!form.subject.trim() || !form.body.trim())) return 'Informe assunto e conteúdo.'
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
      kind: mode.value,
      channel: CHANNEL,
      contactIds: form.recipientMode === 'contacts' ? form.contactIds : [],
      groupIds: form.recipientMode === 'groups' ? form.groupIds : [],
      templateId: mode.value === 'template' ? form.templateId : undefined,
      content: mode.value === 'quick'
        ? { subject: form.subject, ...(form.format === 'html' ? { html: form.body } : { text: form.body }) }
        : { variables: {} },
      idempotencyKey: newIdempotencyKey('email'),
    })
    lastDispatch.value = unwrap(response) || {}
    await loadDispatchDeliveries()
    const queued = lastDispatchQueued.value
    const skipped = lastDispatchSkipped.value
    const failed = lastDispatchFailed.value
    $q.notify({
      type: queued ? 'positive' : 'warning',
      message: queued ? `${queued} email(s) colocado(s) na fila.` : 'Nenhum email elegível foi enfileirado.',
      caption: skipped || failed ? `${skipped} ignorado(s) e ${failed} falha(s); os demais continuam normalmente.` : undefined,
    })
    if (mode.value === 'quick') {
      form.subject = ''
      form.body = ''
    }
    await loadData()
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível enfileirar os emails.') })
  } finally {
    sending.value = false
  }
}

function openEditContact(contact) {
  if (!contact) return
  editingContact.value = contact
  contactDialog.value = true
}

function openCreateContact() {
  editingContact.value = null
  contactDialog.value = true
}

async function showDispatchIssues() {
  if (!lastDispatchId.value) return
  issueNotificationId.value = lastDispatchId.value
  await loadDeliveryIssues({ pagination: { ...issuePagination.value, page: 1 } })
  await nextTick()
  const element = issuesSection.value?.$el || issuesSection.value
  element?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}

async function showAllDeliveryIssues() {
  issueNotificationId.value = null
  await loadDeliveryIssues({ pagination: { ...issuePagination.value, page: 1 }, notificationId: null })
}

function onIssuesRequest({ pagination }) {
  loadDeliveryIssues({ pagination })
}

function onDeliveriesRequest({ pagination }) {
  loadDispatchDeliveries({ pagination })
}

function onQueueLog(log) {
  if (log?.channel !== CHANNEL || !String(log.action || '').startsWith('notification.')) return
  history.value = [log, ...history.value.filter((item) => String(recordId(item)) !== String(recordId(log)))].slice(0, 50)
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(async () => {
    await loadData()
    if (lastDispatchId.value) await loadDispatchDeliveries({ showError: false })
  }, 450)
}

onMounted(() => {
  loadData()
  connectSocket().on('log:created', onQueueLog)
})

onBeforeUnmount(() => {
  clearTimeout(refreshTimer)
  getSocket().off('log:created', onQueueLog)
})
</script>

<template>
  <q-page class="page-container email-channel-page">
    <PageHeader
      eyebrow="Canal de email"
      title="Gmail"
      description="Envie para contatos ou grupos pela fila e acompanhe cada sucesso, falha ou destinatário sem permissão."
      icon="mail"
    >
      <template #actions>
        <q-btn outline color="primary" no-caps icon="person_add" label="Cadastrar contato" @click="openCreateContact" />
        <q-btn outline color="primary" no-caps icon="refresh" label="Atualizar" :loading="loading" @click="loadData" />
      </template>
    </PageHeader>

    <section class="page-grid email-layout q-mb-lg">
      <q-card flat class="glass-card section-card">
        <div class="section-title-row">
          <div><h2 class="section-title">Novo disparo de email</h2><p class="section-copy">A fila deduplica os contatos e registra inelegíveis sem interromper os demais.</p></div>
          <q-badge outline color="primary" label="ENVIO PELA FILA" />
        </div>

        <q-btn-toggle
          v-model="mode"
          spread
          no-caps
          unelevated
          toggle-color="primary"
          color="white"
          text-color="dark"
          :options="[{ label: 'Email rápido', value: 'quick' }, { label: 'Usar template', value: 'template' }]"
          class="q-my-lg"
        />

        <div class="recipient-switch q-mb-lg">
          <button type="button" :class="{ active: form.recipientMode === 'contacts' }" @click="setRecipientMode('contacts')"><q-icon name="people" />Contatos autorizados</button>
          <button type="button" :class="{ active: form.recipientMode === 'groups' }" @click="setRecipientMode('groups')"><q-icon name="groups" />Grupo(s) de contatos</button>
        </div>

        <div class="form-grid">
          <q-select
            v-if="form.recipientMode === 'contacts'"
            v-model="form.contactIds"
            outlined
            multiple
            use-chips
            use-input
            emit-value
            map-options
            :options="contactOptions"
            label="Contatos autorizados *"
            hint="Você pode selecionar um ou vários destinatários"
            class="full-span"
          />
          <q-select
            v-else
            v-model="form.groupIds"
            outlined
            multiple
            use-chips
            use-input
            emit-value
            map-options
            :options="groupOptions"
            label="Grupos de contatos *"
            hint="Os contatos repetidos serão enviados apenas uma vez"
            class="full-span"
          />

          <template v-if="mode === 'quick'">
            <q-input v-model="form.subject" outlined label="Assunto *" class="full-span" />
            <q-btn-toggle v-model="form.format" no-caps unelevated toggle-color="primary" color="white" text-color="dark" :options="[{ label: 'HTML', value: 'html' }, { label: 'Texto', value: 'text' }]" class="full-span" />
            <q-editor v-if="form.format === 'html'" v-model="form.body" min-height="220px" class="full-span" :toolbar="[['bold', 'italic', 'underline'], ['unordered', 'ordered'], ['link'], ['undo', 'redo']]" />
            <q-input v-else v-model="form.body" outlined type="textarea" autogrow label="Conteúdo *" class="full-span" />
          </template>
          <q-select v-else v-model="form.templateId" outlined emit-value map-options :options="templateOptions" label="Template de email *" class="full-span" />
        </div>

        <section v-if="recipientEligibility.contactIds.length" class="eligibility-panel q-mt-lg">
          <header>
            <div><strong>Elegibilidade da seleção</strong><span>{{ recipientEligibility.contactIds.length }} contato(s) único(s)</span></div>
            <div class="eligibility-counts"><q-badge color="positive" :label="`${recipientEligibility.eligible.length} elegíveis`" /><q-badge color="warning" text-color="dark" :label="`${recipientEligibility.ineligible.length} inelegíveis`" /></div>
          </header>
          <div v-if="recipientEligibility.ineligible.length" class="ineligible-list">
            <div v-for="item in recipientEligibility.ineligible.slice(0, 8)" :key="item.contactId" class="ineligible-row">
              <q-icon name="warning" color="warning" />
              <div><strong>{{ item.contact?.displayName || item.contactId }}</strong><span>{{ item.reason }}</span></div>
              <q-btn v-if="item.contact" flat color="primary" no-caps icon="manage_accounts" label="Editar permissão" @click="openEditContact(item.contact)" />
            </div>
          </div>
        </section>

        <div class="send-actions q-mt-lg"><q-btn color="dark" unelevated no-caps icon-right="send" label="Enviar emails pela fila" :loading="sending" @click="send" /></div>
      </q-card>

      <q-card flat class="glass-card section-card preview-card">
        <div class="preview-label"><span>Prévia</span><q-badge color="primary" :label="mode === 'template' ? 'Template salvo' : form.format.toUpperCase()" /></div>
        <div class="mail-preview">
          <div class="mail-preview__header"><span>Assunto</span><strong>{{ previewSubject }}</strong></div>
          <div class="preview-frame" v-html="safePreview || '<p style=&quot;color:#72837f&quot;>Escreva ou selecione um conteúdo para visualizar.</p>'" />
        </div>
        <div class="preview-stats">
          <div><strong>{{ recipientEligibility.eligible.length }}</strong><span>aptos para fila</span></div>
          <div><strong>{{ recipientEligibility.ineligible.length }}</strong><span>serão ignorados</span></div>
        </div>
      </q-card>
    </section>

    <q-card v-if="lastDispatch" flat class="glass-card section-card q-mb-lg dispatch-result-card">
      <div class="section-title-row">
        <div><h2 class="section-title">Resultado do último disparo</h2><p class="section-copy">O resumo é atualizado pela fila sem interromper o lote por falhas individuais.</p></div>
        <q-btn flat round icon="close" aria-label="Fechar resultado" @click="lastDispatch = null" />
      </div>
      <div class="result-counters">
        <div><strong>{{ lastDispatchQueued }}</strong><span>enfileirados</span></div>
        <div><strong>{{ lastDispatchSkipped }}</strong><span>ignorados</span></div>
        <div><strong>{{ lastDispatchFailed }}</strong><span>falhas</span></div>
      </div>
      <q-btn v-if="lastDispatchHasIssues && lastDispatchId" outline color="primary" no-caps icon="manage_search" label="Ver detalhes deste disparo" :loading="issuesLoading && issueNotificationId === lastDispatchId" @click="showDispatchIssues" />
      <q-table
        flat
        class="dispatch-deliveries q-mt-md"
        :rows="dispatchDeliveries"
        :columns="deliveryColumns"
        row-key="id"
        v-model:pagination="deliveryPagination"
        :loading="deliveriesLoading"
        :rows-per-page-options="[10, 25, 50, 100]"
        @request="onDeliveriesRequest"
      >
        <template #body-cell-contact="props"><q-td :props="props"><strong>{{ props.row.contact?.displayName || props.row.contact?.name || props.row.contactId }}</strong></q-td></template>
        <template #body-cell-status="props"><q-td :props="props"><q-badge :color="deliveryStatusColor(props.row.status)" :label="props.row.status" /></q-td></template>
        <template #body-cell-attempts="props"><q-td :props="props" class="text-center">{{ props.row.attempts || 0 }}</q-td></template>
        <template #body-cell-detail="props"><q-td :props="props" class="issue-reason">{{ props.row.errorMessage || (['sent', 'delivered', 'read'].includes(props.row.status) ? 'Entrega concluída' : 'Aguardando processamento') }}</q-td></template>
        <template #body-cell-updatedAt="props"><q-td :props="props">{{ formatDate(props.row.updatedAt || props.row.sentAt || props.row.createdAt) }}</q-td></template>
      </q-table>
    </q-card>

    <q-card ref="issuesSection" flat class="glass-card section-card q-mb-lg">
      <div class="section-title-row">
        <div><h2 class="section-title">Ignorados e falhas</h2><p class="section-copy">{{ issueNotificationId ? 'Exibindo somente o último disparo selecionado.' : 'Histórico individual de elegibilidade, tentativas e falhas.' }}</p></div>
        <div class="row items-center q-gutter-sm"><q-badge color="warning" text-color="dark" :label="`${issuePagination.rowsNumber} ocorrência(s)`" /><q-btn v-if="issueNotificationId" flat color="primary" no-caps icon="history" label="Todo o histórico" @click="showAllDeliveryIssues" /></div>
      </div>
      <q-table
        flat
        :rows="deliveryIssues"
        :columns="issueColumns"
        row-key="id"
        v-model:pagination="issuePagination"
        :loading="issuesLoading"
        :rows-per-page-options="[10, 25, 50, 100]"
        @request="onIssuesRequest"
      >
        <template #body-cell-contact="props"><q-td :props="props"><strong>{{ props.row.contact?.displayName || props.row.contact?.name || props.row.contactId }}</strong></q-td></template>
        <template #body-cell-status="props"><q-td :props="props"><q-badge :color="deliveryStatusColor(props.row.status)" :label="props.row.status" /></q-td></template>
        <template #body-cell-reason="props"><q-td :props="props" class="issue-reason">{{ props.row.errorMessage }}</q-td></template>
        <template #body-cell-createdAt="props"><q-td :props="props">{{ formatDate(props.row.createdAt) }}</q-td></template>
        <template #body-cell-actions="props"><q-td :props="props"><q-btn v-if="props.row.contact" flat dense color="primary" no-caps icon="manage_accounts" label="Editar permissão" @click="openEditContact(props.row.contact)" /></q-td></template>
        <template #no-data><div class="full-width text-center q-pa-lg text-muted">Nenhuma entrega ignorada ou com falha.</div></template>
      </q-table>
    </q-card>

    <q-card flat class="glass-card section-card">
      <div class="toolbar-row"><div><h2 class="section-title">Logs da fila</h2><p class="section-copy">Sucessos, falhas e tentativas recentes registrados por entrega.</p></div></div>
      <EmptyState v-if="!loading && !history.length" icon="mark_email_unread" title="Nenhum email processado" description="Os próximos eventos da fila aparecerão aqui." />
      <q-table v-else flat :rows="history" :columns="historyColumns" row-key="id" :loading="loading" :rows-per-page-options="[10, 25, 50]">
        <template #body-cell-createdAt="props"><q-td :props="props">{{ formatDate(props.row.createdAt) }}</q-td></template>
        <template #body-cell-event="props"><q-td :props="props"><strong>{{ props.row.action || 'notification.event' }}</strong></q-td></template>
        <template #body-cell-contact="props"><q-td :props="props">{{ logContact(props.row) }}</q-td></template>
        <template #body-cell-status="props"><q-td :props="props"><q-badge :color="deliveryStatusColor(logStatus(props.row))" :label="logStatus(props.row)" /></q-td></template>
        <template #body-cell-message="props"><q-td :props="props" class="truncate" style="max-width: 420px">{{ props.row.message || props.row.summary || 'Evento processado' }}</q-td></template>
      </q-table>
    </q-card>

    <ContactDialog v-model="contactDialog" :contact="editingContact" @saved="loadData" />
  </q-page>
</template>

<style scoped>
.email-channel-page {
  --q-primary: #d93025;
}

.email-channel-page :deep(.q-btn.bg-dark) {
  background: #d93025 !important;
  color: #fff !important;
}

.email-layout {
  grid-template-columns: minmax(0, 1.35fr) minmax(310px, 0.65fr);
  align-items: start;
}

.recipient-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 6px;
  border-radius: 16px;
  background: rgba(18, 106, 91, 0.07);
}

.recipient-switch button {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: #536b66;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.recipient-switch button.active {
  background: #fff;
  color: var(--q-primary);
  box-shadow: 0 7px 22px rgba(3, 62, 55, 0.09);
}

.preview-card {
  position: sticky;
  top: 92px;
}

.preview-label,
.eligibility-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.preview-label {
  margin-bottom: 14px;
  font-size: 0.77rem;
  font-weight: 800;
  text-transform: uppercase;
}

.mail-preview {
  overflow: hidden;
  border-radius: 17px;
  background: #fff;
  box-shadow: 0 12px 36px rgba(3, 62, 55, 0.08);
}

.mail-preview__header {
  padding: 14px 18px;
  border-bottom: 1px solid rgba(3, 21, 21, 0.08);
}

.mail-preview__header span,
.mail-preview__header strong {
  display: block;
}

.mail-preview__header span {
  color: #6a7e7a;
  font-size: 0.66rem;
  text-transform: uppercase;
}

.preview-frame {
  min-height: 280px;
  padding: 18px;
}

.preview-stats,
.result-counters {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.preview-stats {
  grid-template-columns: repeat(2, 1fr);
}

.result-counters {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-bottom: 16px;
}

.preview-stats > div,
.result-counters > div {
  display: grid;
  padding: 13px;
  border: 1px solid rgba(18, 106, 91, 0.12);
  border-radius: 14px;
  background: rgba(231, 251, 246, 0.45);
}

.preview-stats strong,
.result-counters strong {
  color: #0d6f5c;
  font-size: 1.35rem;
}

.preview-stats span,
.result-counters span,
.eligibility-panel header span,
.ineligible-row span {
  color: #6b7f7b;
  font-size: 0.76rem;
}

.eligibility-panel {
  padding: 15px;
  border: 1px solid rgba(18, 106, 91, 0.15);
  border-radius: 16px;
  background: rgba(244, 253, 250, 0.7);
}

.eligibility-panel header > div:first-child,
.ineligible-row > div {
  display: grid;
  min-width: 0;
}

.eligibility-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.ineligible-list {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.ineligible-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 9px;
  border-radius: 12px;
  background: #fff;
}

.send-actions {
  display: flex;
  justify-content: flex-end;
}

.issue-reason {
  max-width: 420px;
  white-space: normal;
}

@media (max-width: 950px) {
  .email-layout {
    grid-template-columns: 1fr;
  }

  .preview-card {
    position: static;
  }
}

@media (max-width: 600px) {
  .recipient-switch,
  .result-counters {
    grid-template-columns: 1fr;
  }

  .eligibility-panel header,
  .ineligible-row {
    align-items: flex-start;
    grid-template-columns: 1fr;
  }

  .eligibility-counts {
    justify-content: flex-start;
  }

  .send-actions .q-btn {
    width: 100%;
  }
}
</style>
