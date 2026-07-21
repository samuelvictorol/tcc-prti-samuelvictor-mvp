<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useQuasar } from 'quasar'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import ContactDialog from '../components/ContactDialog.vue'
import { asList, errorMessage, fetchAll, http, unwrap } from '../services/http.js'
import { connectSocket, getSocket } from '../services/socket.js'

const $q = useQuasar()
const loading = ref(false)
const sending = ref(false)
const contactDialog = ref(false)
const contacts = ref([])
const templates = ref([])
const events = ref([])
const mode = ref('template')
const form = reactive({ contactId: null, templateId: null, message: '', variablesJson: '{}' })

function cloudIdentity(contact) {
  return contact.channels?.find((item) => String(item.channel).replaceAll('-', '_') === 'whatsapp_cloud' && (item.authorized || item.consentStatus === 'granted'))
}

const contactOptions = computed(() => contacts.value.map((item) => ({
  label: `${item.displayName || item.name || 'Sem nome'} · ${cloudIdentity(item)?.address || item.phone || 'sem telefone'}`,
  value: item.id || item._id,
})))
const templateOptions = computed(() => templates.value.map((item) => ({
  label: `${item.name || item.title}${item.languageCode ? ` · ${item.languageCode}` : ''}`,
  value: item.id || item._id,
})))

const eventColumns = [
  { name: 'createdAt', label: 'Quando', field: 'createdAt', align: 'left' },
  { name: 'event', label: 'Ação', field: 'action', align: 'left' },
  { name: 'contact', label: 'Contato', field: 'contact', align: 'left' },
  { name: 'status', label: 'Status', field: 'status', align: 'left' },
  { name: 'message', label: 'Resumo', field: 'message', align: 'left' },
]

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value))
}

function statusColor(value = '') {
  return { delivered: 'positive', read: 'positive', sent: 'info', received: 'info', failed: 'negative', error: 'negative' }[String(value).toLowerCase()] || 'grey-7'
}

function contextSummary(event) {
  if (event.message || event.summary) return event.message || event.summary
  const context = event.context
  if (!context) return 'Evento processado'
  if (typeof context === 'string') return context
  return Object.entries(context).slice(0, 4).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')
}

async function loadData() {
  loading.value = true
  try {
    const [contactItems, templateItems, logResponse] = await Promise.all([
      fetchAll('/contacts', { params: { channel: 'whatsapp_cloud', authorized: true }, preferredKey: 'contacts' }),
      fetchAll('/templates', { params: { channel: 'whatsapp_cloud' }, preferredKey: 'templates' }),
      http.get('/logs', { params: { channel: 'whatsapp_cloud', limit: 50 } }),
    ])
    contacts.value = contactItems
    templates.value = templateItems
    events.value = asList(unwrap(logResponse), 'logs')
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível carregar o canal oficial.') })
  } finally {
    loading.value = false
  }
}

async function send() {
  if (!form.contactId) {
    $q.notify({ type: 'warning', message: 'Selecione um contato autorizado.' })
    return
  }
  if (mode.value === 'template' && !form.templateId) {
    $q.notify({ type: 'warning', message: 'Selecione um template aprovado.' })
    return
  }
  if (mode.value === 'quick' && !form.message.trim()) {
    $q.notify({ type: 'warning', message: 'Escreva uma mensagem.' })
    return
  }

  let variables = {}
  try {
    variables = JSON.parse(form.variablesJson || '{}')
  } catch {
    $q.notify({ type: 'negative', message: 'O JSON de variáveis é inválido.' })
    return
  }

  sending.value = true
  try {
    await http.post('/notifications', {
      kind: mode.value === 'quick' ? 'quick' : 'template',
      channel: 'whatsapp_cloud',
      contactIds: [form.contactId],
      groupIds: [],
      templateId: mode.value === 'template' ? form.templateId : undefined,
      content: mode.value === 'quick' ? { text: form.message } : { variables },
    })
    form.message = ''
    $q.notify({ type: 'positive', message: 'Mensagem enviada para a fila multicanal.' })
    await loadData()
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'A Cloud API recusou o envio.') })
  } finally {
    sending.value = false
  }
}

function onWebhookEvent(event) {
  events.value = [event, ...events.value].slice(0, 50)
}

onMounted(() => {
  loadData()
  const socket = connectSocket()
  socket.on('whatsapp_cloud:webhook', onWebhookEvent)
  socket.on('whatsapp-cloud:webhook', onWebhookEvent)
})

onBeforeUnmount(() => {
  const socket = getSocket()
  socket.off('whatsapp_cloud:webhook', onWebhookEvent)
  socket.off('whatsapp-cloud:webhook', onWebhookEvent)
})
</script>

<template>
  <q-page class="page-container">
    <PageHeader
      eyebrow="Meta Cloud API"
      title="WhatsApp oficial"
      description="Envie templates aprovados, acompanhe webhooks e sincronize respostas com a base de contatos."
      icon="cloud_sync"
    >
      <template #actions><q-btn outline color="primary" no-caps icon="person_add" label="Cadastrar contato" @click="contactDialog = true" /><q-btn outline color="primary" no-caps icon="refresh" label="Atualizar" :loading="loading" @click="loadData" /></template>
    </PageHeader>

    <div class="cloud-policy q-mb-lg">
      <q-icon name="policy" size="26px" />
      <div><strong>Política de conversas</strong><span>Mensagens livres dependem da janela de atendimento. Fora dela, use um template aprovado e consentimento válido.</span></div>
    </div>

    <section class="page-grid cloud-layout q-mb-lg">
      <q-card flat class="glass-card section-card">
        <h2 class="section-title">Novo disparo oficial</h2>
        <p class="section-copy">A API deve validar a elegibilidade final antes de enviar.</p>
        <q-btn-toggle v-model="mode" spread no-caps unelevated toggle-color="primary" color="white" text-color="dark" :options="[{ label: 'Template aprovado', value: 'template' }, { label: 'Mensagem na janela', value: 'quick' }]" class="q-my-lg" />
        <div class="form-grid">
          <q-select v-model="form.contactId" outlined clearable use-input emit-value map-options :options="contactOptions" label="Contato autorizado" class="full-span" />
          <template v-if="mode === 'template'">
            <q-select v-model="form.templateId" outlined emit-value map-options :options="templateOptions" label="Template aprovado *" class="full-span" />
            <q-input v-model="form.variablesJson" outlined type="textarea" label="Variáveis em JSON" class="full-span json-field" />
          </template>
          <q-input v-else v-model="form.message" outlined type="textarea" autogrow label="Mensagem dentro da janela" class="full-span" />
        </div>
        <div class="row justify-end q-mt-lg"><q-btn color="dark" unelevated no-caps icon-right="send" label="Enviar via Cloud API" :loading="sending" @click="send" /></div>
      </q-card>

      <aside class="page-grid">
        <q-card flat class="glass-card section-card stat-card"><q-icon name="description" color="primary" size="30px" /><div><strong>{{ templates.length }}</strong><span>templates disponíveis</span></div></q-card>
        <q-card flat class="glass-card section-card stat-card"><q-icon name="contacts" color="primary" size="30px" /><div><strong>{{ contacts.length }}</strong><span>contatos elegíveis</span></div></q-card>
        <q-card flat class="glass-card section-card webhook-card">
          <div class="row items-center q-gutter-sm"><span class="status-dot status-dot--online" /><strong>Webhook em tempo real</strong></div>
          <p class="section-copy">Respostas recebidas podem criar ou atualizar o contato e seu identificador do canal.</p>
        </q-card>
      </aside>
    </section>

    <q-card flat class="glass-card section-card">
      <div class="toolbar-row"><div><h2 class="section-title">Eventos do webhook</h2><p class="section-copy">Status de entrega e respostas recentes, sem expor o payload secreto.</p></div></div>
      <EmptyState v-if="!loading && !events.length" icon="webhook" title="Nenhum evento recente" description="Validações e retornos da Meta aparecerão aqui." />
      <q-table v-else flat :rows="events" :columns="eventColumns" row-key="id" :loading="loading" :rows-per-page-options="[10, 25, 50]">
        <template #body-cell-createdAt="props"><q-td :props="props">{{ formatDate(props.row.createdAt || props.row.timestamp) }}</q-td></template>
        <template #body-cell-event="props"><q-td :props="props"><strong>{{ props.row.action || props.row.event || props.row.type || 'webhook' }}</strong></q-td></template>
        <template #body-cell-contact="props"><q-td :props="props">{{ props.row.contact?.displayName || props.row.contact?.name || props.row.contactName || props.row.context?.phone || props.row.phone || '—' }}</q-td></template>
        <template #body-cell-status="props"><q-td :props="props"><q-badge :color="statusColor(props.row.status || props.row.level)" :label="props.row.status || props.row.level || 'received'" /></q-td></template>
        <template #body-cell-message="props"><q-td :props="props" class="truncate" style="max-width: 360px">{{ contextSummary(props.row) }}</q-td></template>
      </q-table>
    </q-card>
    <ContactDialog v-model="contactDialog" @saved="loadData" />
  </q-page>
</template>

<style scoped>
.cloud-policy {
  display: flex;
  align-items: flex-start;
  gap: 13px;
  padding: 16px;
  border: 1px solid rgba(199, 125, 23, 0.22);
  border-radius: 16px;
  background: rgba(255, 247, 226, 0.8);
  color: #6e4c19;
}

.cloud-policy strong,
.cloud-policy span {
  display: block;
}

.cloud-policy span {
  margin-top: 3px;
  font-size: 0.82rem;
}

.cloud-layout {
  grid-template-columns: minmax(0, 1.5fr) minmax(260px, 0.5fr);
  align-items: start;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 15px;
}

.stat-card strong,
.stat-card span {
  display: block;
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

.json-field :deep(textarea) {
  font-family: "Cascadia Code", Consolas, monospace;
  font-size: 0.82rem;
}

@media (max-width: 900px) {
  .cloud-layout {
    grid-template-columns: 1fr;
  }
}
</style>
