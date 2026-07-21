<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import DOMPurify from 'dompurify'
import { useQuasar } from 'quasar'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import ContactDialog from '../components/ContactDialog.vue'
import { asList, errorMessage, fetchAll, http, unwrap } from '../services/http.js'

const $q = useQuasar()
const loading = ref(false)
const sending = ref(false)
const contactDialog = ref(false)
const mode = ref('quick')
const contacts = ref([])
const templates = ref([])
const history = ref([])
const form = reactive({ contactIds: [], subject: '', body: '', format: 'html', templateId: null })

function emailIdentity(contact) {
  return contact.channels?.find((item) => item.channel === 'email' && (item.authorized || item.consentStatus === 'granted'))
}

const contactOptions = computed(() => contacts.value
  .filter((item) => emailIdentity(item) || item.email)
  .map((item) => ({ label: `${item.displayName || item.name || 'Sem nome'} · ${emailIdentity(item)?.address || item.email}`, value: item.id || item._id })))
const templateOptions = computed(() => templates.value.map((item) => ({ label: item.name || item.title, value: item.id || item._id })))
const safePreview = computed(() => DOMPurify.sanitize(
  form.format === 'html' ? form.body : `<p>${String(form.body || '').replace(/\n/g, '<br>')}</p>`,
  { USE_PROFILES: { html: true } },
))

const columns = [
  { name: 'createdAt', label: 'Quando', field: 'createdAt', align: 'left' },
  { name: 'subject', label: 'Assunto', field: 'subject', align: 'left' },
  { name: 'recipient', label: 'Destinatário', field: 'recipient', align: 'left' },
  { name: 'status', label: 'Status', field: 'status', align: 'left' },
]

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

async function loadData() {
  loading.value = true
  try {
    const [contactItems, templateItems, logResponse] = await Promise.all([
      fetchAll('/contacts', { params: { channel: 'email', authorized: true }, preferredKey: 'contacts' }),
      fetchAll('/templates', { params: { channel: 'email' }, preferredKey: 'templates' }),
      http.get('/logs', { params: { channel: 'email', limit: 30 } }),
    ])
    contacts.value = contactItems
    templates.value = templateItems
    history.value = asList(unwrap(logResponse), 'logs')
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível carregar o Gmail.') })
  } finally {
    loading.value = false
  }
}

async function send() {
  if (!form.contactIds.length) {
    $q.notify({ type: 'warning', message: 'Selecione ao menos um contato autorizado.' })
    return
  }
  if (mode.value === 'template' && !form.templateId) {
    $q.notify({ type: 'warning', message: 'Selecione um template.' })
    return
  }
  if (mode.value === 'quick' && (!form.subject.trim() || !form.body.trim())) {
    $q.notify({ type: 'warning', message: 'Informe assunto e conteúdo.' })
    return
  }
  sending.value = true
  try {
    await http.post('/notifications', {
      kind: mode.value === 'quick' ? 'quick' : 'template',
      channel: 'email',
      contactIds: form.contactIds,
      groupIds: [],
      templateId: mode.value === 'template' ? form.templateId : undefined,
      content: mode.value === 'quick'
        ? { subject: form.subject, ...(form.format === 'html' ? { html: form.body } : { text: form.body }) }
        : { variables: {} },
    })
    form.subject = ''
    form.body = ''
    $q.notify({ type: 'positive', message: 'Email colocado na fila de envio.' })
    await loadData()
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível enviar o email.') })
  } finally {
    sending.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <q-page class="page-container">
    <PageHeader
      eyebrow="Canal de email"
      title="Gmail"
      description="Prepare emails em texto ou HTML, visualize o resultado e acompanhe a fila de entregas."
      icon="mail"
    >
      <template #actions><q-btn outline color="primary" no-caps icon="person_add" label="Cadastrar contato" @click="contactDialog = true" /><q-btn outline color="primary" no-caps icon="refresh" label="Atualizar" :loading="loading" @click="loadData" /></template>
    </PageHeader>

    <section class="page-grid email-layout q-mb-lg">
      <q-card flat class="glass-card section-card">
        <div class="toolbar-row"><div><h2 class="section-title">Compor email</h2><p class="section-copy">Destinatários da base ainda serão validados pelo consentimento mais recente.</p></div></div>
        <q-btn-toggle v-model="mode" spread no-caps unelevated toggle-color="primary" color="white" text-color="dark" :options="[{ label: 'Email rápido', value: 'quick' }, { label: 'Usar template', value: 'template' }]" class="q-mb-lg" />
        <div class="form-grid">
          <q-select v-model="form.contactIds" outlined multiple use-chips use-input emit-value map-options :options="contactOptions" label="Contatos autorizados" class="full-span" />
          <template v-if="mode === 'quick'">
            <q-input v-model="form.subject" outlined label="Assunto *" class="full-span" />
            <q-btn-toggle v-model="form.format" no-caps unelevated toggle-color="primary" color="white" text-color="dark" :options="[{ label: 'HTML', value: 'html' }, { label: 'Texto', value: 'text' }]" class="full-span" />
            <q-editor v-if="form.format === 'html'" v-model="form.body" min-height="220px" class="full-span" :toolbar="[['bold', 'italic', 'underline'], ['unordered', 'ordered'], ['link'], ['undo', 'redo']]" />
            <q-input v-else v-model="form.body" outlined type="textarea" autogrow label="Conteúdo *" class="full-span" />
          </template>
          <q-select v-else v-model="form.templateId" outlined emit-value map-options :options="templateOptions" label="Template de email *" class="full-span" />
        </div>
        <div class="row justify-end q-mt-lg"><q-btn color="dark" unelevated no-caps icon-right="send" label="Enviar email" :loading="sending" @click="send" /></div>
      </q-card>

      <q-card flat class="glass-card section-card preview-card">
        <div class="preview-label"><span>Prévia</span><q-badge color="primary" :label="mode === 'template' ? 'Template salvo' : form.format.toUpperCase()" /></div>
        <div v-if="mode === 'quick'" class="mail-preview">
          <div class="mail-preview__header"><span>Assunto</span><strong>{{ form.subject || 'Seu assunto aparecerá aqui' }}</strong></div>
          <div class="preview-frame" v-html="safePreview || '<p style=&quot;color:#72837f&quot;>Escreva o conteúdo para visualizar.</p>'" />
        </div>
        <div v-else class="template-placeholder"><q-icon name="description" size="52px" color="primary" /><strong>Prévia do template</strong><span>Edite o conteúdo completo na biblioteca de Templates.</span></div>
      </q-card>
    </section>

    <q-card flat class="glass-card section-card">
      <div class="toolbar-row"><div><h2 class="section-title">Histórico do canal</h2><p class="section-copy">Resultados recentes informados pelo serviço de email.</p></div></div>
      <EmptyState v-if="!loading && !history.length" icon="mark_email_unread" title="Nenhum email enviado" description="Os próximos envios aparecerão aqui." />
      <q-table v-else flat :rows="history" :columns="columns" row-key="id" :loading="loading">
        <template #body-cell-createdAt="props"><q-td :props="props">{{ formatDate(props.row.createdAt) }}</q-td></template>
        <template #body-cell-subject="props"><q-td :props="props"><strong>{{ props.row.subject || props.row.template?.name || 'Email' }}</strong></q-td></template>
        <template #body-cell-recipient="props"><q-td :props="props">{{ props.row.recipient || props.row.email || props.row.contact?.email || 'Lote' }}</q-td></template>
        <template #body-cell-status="props"><q-td :props="props"><q-badge :color="props.row.status === 'failed' ? 'negative' : 'positive'" :label="props.row.status || 'sent'" /></q-td></template>
      </q-table>
    </q-card>
    <ContactDialog v-model="contactDialog" @saved="loadData" />
  </q-page>
</template>

<style scoped>
.email-layout {
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.65fr);
  align-items: start;
}

.preview-card {
  position: sticky;
  top: 92px;
}

.preview-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  font-size: 0.77rem;
  font-weight: 800;
  text-transform: uppercase;
}

.mail-preview {
  border-radius: 17px;
  background: #fff;
  box-shadow: 0 12px 36px rgba(3, 62, 55, 0.08);
  overflow: hidden;
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

.mail-preview__header strong {
  margin-top: 3px;
}

.preview-frame {
  min-height: 360px;
  border: 0;
  border-radius: 0;
}

.template-placeholder {
  display: grid;
  min-height: 420px;
  justify-items: center;
  align-content: center;
  color: #6b7f7b;
  text-align: center;
}

.template-placeholder strong {
  margin-top: 12px;
  color: #294641;
}

.template-placeholder span {
  max-width: 260px;
  margin-top: 4px;
  font-size: 0.78rem;
}

@media (max-width: 950px) {
  .email-layout {
    grid-template-columns: 1fr;
  }

  .preview-card {
    position: static;
  }
}
</style>
