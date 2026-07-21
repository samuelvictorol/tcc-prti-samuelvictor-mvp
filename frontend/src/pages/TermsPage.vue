<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import DOMPurify from 'dompurify'
import { useQuasar } from 'quasar'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import { errorMessage, fetchAll, http, unwrap } from '../services/http.js'

const $q = useQuasar()
const tab = ref('documents')
const loading = ref(false)
const saving = ref(false)
const dialog = ref(false)
const editingId = ref(null)
const terms = ref([])
const contacts = ref([])
const privacy = reactive({ activeContacts: 0, revokedConsents: 0, authorizedChannels: 0 })
const form = reactive({
  type: 'terms_of_use',
  title: 'Termos de Uso',
  version: '1.0',
  content: '',
  status: 'draft',
  effectiveAt: '',
})

const typeOptions = [
  { label: 'Termos de Uso', value: 'terms_of_use' },
  { label: 'Termos de Serviço', value: 'terms_of_service' },
  { label: 'Política de Privacidade', value: 'privacy_policy' },
]

const safePreview = computed(() => DOMPurify.sanitize(form.content || '<p>O conteúdo aparecerá aqui.</p>', { USE_PROFILES: { html: true } }))

const requestColumns = [
  { name: 'contact', label: 'Titular', field: 'contact', align: 'left' },
  { name: 'channels', label: 'Canais e consentimento', field: 'channels', align: 'left' },
  { name: 'updatedAt', label: 'Atualizado', field: 'updatedAt', align: 'left' },
  { name: 'actions', label: '', field: 'actions', align: 'right' },
]

function recordId(record) {
  return record?.id || record?._id
}

function typeLabel(value) {
  return typeOptions.find((item) => item.value === value)?.label || value
}

function statusColor(value) {
  return { published: 'positive', active: 'positive', draft: 'grey-7', pending: 'warning', completed: 'positive', rejected: 'negative' }[value] || 'grey-7'
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

async function loadData() {
  loading.value = true
  const [termsResult, contactsResult] = await Promise.allSettled([
    fetchAll('/terms', { preferredKey: 'terms' }),
    fetchAll('/contacts', { preferredKey: 'contacts' }),
  ])
  if (termsResult.status === 'fulfilled') terms.value = termsResult.value
  if (contactsResult.status === 'fulfilled') {
    contacts.value = contactsResult.value
    privacy.activeContacts = contacts.value.length
    privacy.revokedConsents = contacts.value.flatMap((item) => item.channels || []).filter((channel) => channel.consentStatus === 'revoked').length
    privacy.authorizedChannels = contacts.value.flatMap((item) => item.channels || []).filter((channel) => channel.authorized || channel.consentStatus === 'granted').length
  }
  if (termsResult.status === 'rejected') $q.notify({ type: 'negative', message: errorMessage(termsResult.reason, 'Não foi possível carregar os termos.') })
  loading.value = false
}

function openTerm(term) {
  editingId.value = term ? recordId(term) : null
  Object.assign(form, {
    type: term?.type || 'terms_of_use',
    title: term?.title || 'Termos de Uso',
    version: term?.version || '1.0',
    content: term?.content || '',
    status: term?.status || 'draft',
    effectiveAt: term?.effectiveAt ? String(term.effectiveAt).slice(0, 10) : '',
  })
  dialog.value = true
}

async function save() {
  saving.value = true
  try {
    const payload = {
      ...form,
      content: DOMPurify.sanitize(form.content, { USE_PROFILES: { html: true } }),
      effectiveAt: form.effectiveAt || undefined,
    }
    if (editingId.value) await http.put(`/terms/${editingId.value}`, payload)
    else await http.post('/terms', payload)
    dialog.value = false
    $q.notify({ type: 'positive', message: form.status === 'published' ? 'Documento publicado.' : 'Rascunho salvo.' })
    await loadData()
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error) })
  } finally {
    saving.value = false
  }
}

function authorizedIdentities(contact) {
  return (contact.channels || []).filter((item) => item.authorized || item.consentStatus === 'granted')
}

async function exportContact(contact) {
  try {
    const data = unwrap(await http.get(`/privacy/contacts/${recordId(contact)}/export`))
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `dados-${recordId(contact)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error) })
  }
}

async function revokeConsent(contact, channel) {
  try {
    await http.post(`/privacy/contacts/${recordId(contact)}/consents`, {
      channel,
      status: 'revoked',
      source: 'admin_ui',
      purpose: 'notificacoes',
    })
    $q.notify({ type: 'positive', message: `Consentimento de ${channel} revogado.` })
    await loadData()
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error) })
  }
}

function deleteContact(contact) {
  $q.dialog({
    title: 'Excluir dados do titular?',
    message: 'A API cancelará entregas pendentes e aplicará pseudonimização conforme a política de retenção.',
    cancel: { flat: true, label: 'Cancelar' },
    ok: { color: 'negative', label: 'Excluir dados' },
  }).onOk(async () => {
    try {
      await http.delete(`/privacy/contacts/${recordId(contact)}`)
      $q.notify({ type: 'positive', message: 'Solicitação de exclusão processada.' })
      await loadData()
    } catch (error) {
      $q.notify({ type: 'negative', message: errorMessage(error) })
    }
  })
}

onMounted(loadData)
</script>

<template>
  <q-page class="page-container">
    <PageHeader
      eyebrow="Governança e transparência"
      title="Termos e LGPD"
      description="Versione documentos legais e acompanhe solicitações dos titulares em um fluxo auditável."
      icon="verified_user"
    >
      <template #actions><q-btn color="primary" unelevated no-caps icon="post_add" label="Novo documento" @click="openTerm()" /></template>
    </PageHeader>

    <section class="page-grid page-grid--3 q-mb-lg">
      <article class="metric-card glass-card"><div class="text-muted">Contatos ativos</div><div class="metric-value">{{ privacy.activeContacts || 0 }}</div><q-icon name="contacts" class="privacy-icon" /></article>
      <article class="metric-card glass-card"><div class="text-muted">Consentimentos revogados</div><div class="metric-value">{{ privacy.revokedConsents || 0 }}</div><q-icon name="do_not_disturb_on" class="privacy-icon" /></article>
      <article class="metric-card glass-card"><div class="text-muted">Canais autorizados</div><div class="metric-value">{{ privacy.authorizedChannels || 0 }}</div><q-icon name="check_circle" class="privacy-icon" /></article>
    </section>

    <q-card flat class="glass-card section-card">
      <q-tabs v-model="tab" no-caps inline-label active-color="primary" indicator-color="transparent" class="q-mb-lg">
        <q-tab name="documents" icon="gavel" label="Documentos e versões" />
        <q-tab name="subjects" icon="manage_accounts" label="Direitos dos titulares" />
      </q-tabs>
      <q-tab-panels v-model="tab" animated class="transparent">
        <q-tab-panel name="documents" class="q-pa-none">
          <EmptyState v-if="!loading && !terms.length" icon="policy" title="Nenhum documento publicado" description="Crie a primeira versão dos termos e da política de privacidade.">
            <q-btn color="primary" unelevated no-caps label="Criar documento" @click="openTerm()" />
          </EmptyState>
          <div v-else class="term-list">
            <article v-for="term in terms" :key="recordId(term)" class="term-row">
              <div class="term-icon"><q-icon name="description" /></div>
              <div class="term-copy"><strong>{{ term.title || typeLabel(term.type) }}</strong><span>{{ typeLabel(term.type) }} · versão {{ term.version || '1.0' }} · {{ formatDate(term.effectiveAt || term.updatedAt) }}</span></div>
              <q-badge :color="statusColor(term.status)" :label="term.status || 'draft'" />
              <q-btn flat round dense icon="edit" aria-label="Editar documento" @click="openTerm(term)" />
            </article>
          </div>
        </q-tab-panel>

        <q-tab-panel name="subjects" class="q-pa-none">
          <div class="rights-note q-mb-lg"><q-icon name="info" /><span>Antes de concluir exclusão ou portabilidade, confirme a identidade do titular e aplique a política de retenção obrigatória.</span></div>
          <EmptyState v-if="!loading && !contacts.length" icon="contacts" title="Nenhum titular cadastrado" description="Contatos cadastrados aparecerão aqui para exportação, revogação ou exclusão." />
          <q-table v-else flat :rows="contacts" :columns="requestColumns" row-key="id" :loading="loading">
            <template #body-cell-contact="props"><q-td :props="props"><strong>{{ props.row.displayName || props.row.name || props.row.email || 'Titular' }}</strong><div class="text-caption text-muted">{{ props.row.email || props.row.phone || 'Sem identificador visível' }}</div></q-td></template>
            <template #body-cell-channels="props"><q-td :props="props"><div class="row q-gutter-xs"><q-badge v-for="identity in props.row.channels || []" :key="identity.channel" outline :color="identity.authorized || identity.consentStatus === 'granted' ? 'positive' : identity.consentStatus === 'revoked' ? 'negative' : 'grey-7'" :label="`${identity.channel}: ${identity.consentStatus || (identity.authorized ? 'granted' : 'unknown')}`" /></div></q-td></template>
            <template #body-cell-updatedAt="props"><q-td :props="props">{{ formatDate(props.row.updatedAt) }}</q-td></template>
            <template #body-cell-actions="props"><q-td :props="props"><q-btn flat round dense icon="download" aria-label="Exportar dados" @click="exportContact(props.row)" /><q-btn flat round dense icon="block" color="warning" aria-label="Revogar consentimento"><q-menu><q-list><q-item v-for="identity in authorizedIdentities(props.row)" :key="identity.channel" v-close-popup clickable @click="revokeConsent(props.row, identity.channel)"><q-item-section>Revogar {{ identity.channel }}</q-item-section></q-item><q-item v-if="!authorizedIdentities(props.row).length" disable><q-item-section>Nenhum canal autorizado</q-item-section></q-item></q-list></q-menu></q-btn><q-btn flat round dense icon="delete_forever" color="negative" aria-label="Excluir dados" @click="deleteContact(props.row)" /></q-td></template>
          </q-table>
        </q-tab-panel>
      </q-tab-panels>
    </q-card>

    <q-dialog v-model="dialog" persistent maximized-on-mobile>
      <q-card class="terms-dialog">
        <q-card-section class="row items-center q-px-lg"><div><div class="text-h6 text-weight-bold">{{ editingId ? 'Editar documento' : 'Novo documento' }}</div><div class="text-caption text-muted">Publicar uma nova versão não altera registros históricos.</div></div><q-space /><q-btn v-close-popup flat round dense icon="close" /></q-card-section>
        <q-separator />
        <q-form @submit.prevent="save">
          <q-card-section class="terms-builder q-pa-lg">
            <section>
              <div class="form-grid">
                <q-select v-model="form.type" outlined emit-value map-options :options="typeOptions" label="Tipo *" />
                <q-input v-model.trim="form.title" outlined label="Título *" :rules="[(v) => Boolean(v) || 'Informe o título']" />
                <q-input v-model.trim="form.version" outlined label="Versão *" />
                <q-input v-model="form.effectiveAt" outlined type="date" label="Vigência" stack-label />
                <q-select v-model="form.status" outlined emit-value map-options :options="[{label:'Rascunho',value:'draft'},{label:'Publicado',value:'published'}]" label="Status" class="full-span" />
              </div>
              <div class="text-weight-bold q-mt-lg q-mb-sm">Conteúdo *</div>
              <q-editor v-model="form.content" min-height="400px" :toolbar="[['bold','italic','underline'],['title','subtitle','paragraph'],['unordered','ordered'],['link'],['undo','redo']]" />
            </section>
            <aside><div class="preview-label">Prévia sanitizada</div><div class="legal-preview" v-html="safePreview" /></aside>
          </q-card-section>
          <q-separator />
          <q-card-actions align="right" class="q-pa-md q-px-lg"><q-btn v-close-popup flat no-caps label="Cancelar" /><q-btn type="submit" color="primary" unelevated no-caps icon="save" label="Salvar versão" :loading="saving" /></q-card-actions>
        </q-form>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<style scoped>
.privacy-icon {
  position: absolute;
  top: 18px;
  right: 18px;
  color: #137d6c;
  font-size: 28px;
}

.term-list {
  display: grid;
  gap: 8px;
}

.term-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 13px;
  padding: 14px;
  border: 1px solid rgba(3, 21, 21, 0.07);
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.43);
}

.term-icon {
  display: grid;
  width: 42px;
  height: 42px;
  border-radius: 13px;
  background: rgba(130, 248, 230, 0.2);
  color: #137d6c;
  place-items: center;
}

.term-copy strong,
.term-copy span {
  display: block;
}

.term-copy span {
  margin-top: 3px;
  color: #667a77;
  font-size: 0.74rem;
}

.rights-note {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 14px;
  border-radius: 14px;
  background: rgba(130, 248, 230, 0.1);
  color: #476660;
  font-size: 0.8rem;
}

.terms-dialog {
  width: min(1220px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  border-radius: 24px;
  background: #f9fffd;
}

.terms-builder {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(360px, 0.85fr);
  gap: 25px;
  max-height: calc(100vh - 185px);
  overflow: auto;
}

.preview-label {
  margin-bottom: 10px;
  color: #617572;
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
}

.legal-preview {
  min-height: 500px;
  padding: 30px;
  border: 1px solid rgba(3, 21, 21, 0.08);
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 12px 35px rgba(3, 62, 55, 0.07);
  line-height: 1.65;
}

@media (max-width: 900px) {
  .terms-dialog {
    width: 100%;
    max-height: 100%;
    border-radius: 0;
  }

  .terms-builder {
    grid-template-columns: 1fr;
  }
}
</style>
