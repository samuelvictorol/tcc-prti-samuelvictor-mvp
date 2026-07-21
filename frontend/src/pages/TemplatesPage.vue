<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import DOMPurify from 'dompurify'
import { useQuasar } from 'quasar'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import { errorMessage, fetchAll, http } from '../services/http.js'

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
  { label: 'WhatsApp Web', value: 'whatsapp_web', icon: 'forum' },
  { label: 'WhatsApp Cloud', value: 'whatsapp_cloud', icon: 'cloud_sync' },
  { label: 'Email', value: 'email', icon: 'mail' },
  { label: 'Global', value: 'global', icon: 'hub' },
]

const emptyForm = () => ({
  name: '',
  channel: 'telegram',
  format: 'text',
  subject: '',
  body: '',
  payloadJson: '{}',
  variantsJson: '{\n  "telegram": { "text": "", "body": "" },\n  "whatsapp_web": { "text": "", "body": "" },\n  "whatsapp_cloud": { "externalTemplateName": "", "components": [] },\n  "email": { "subject": "", "html": "" }\n}',
  variablesText: '',
  metadata: { approvedName: '', language: 'pt_BR' },
})
const form = reactive(emptyForm())

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
    const matchesTab = tab.value === 'all' || channel === tab.value
    const matchesSearch = !needle || [template.name, template.subject, template.body]
      .some((value) => String(value || '').toLowerCase().includes(needle))
    return matchesTab && matchesSearch
  })
})

const safePreview = computed(() => {
  const body = form.body || '<p class="text-muted">Comece a escrever para visualizar o conteúdo.</p>'
  if (form.format === 'html' || form.channel === 'email') {
    return DOMPurify.sanitize(body, { USE_PROFILES: { html: true } })
  }
  return DOMPurify.sanitize(`<p>${body.replace(/\n/g, '<br>')}</p>`)
})

function recordId(record) {
  return record?.id || record?._id
}

function normalizedChannel(value = '') {
  const key = String(value).toLowerCase().replaceAll('-', '_')
  if (key === 'whatsappweb') return 'whatsapp_web'
  if (['whatsappcloud', 'meta', 'whatsapp_official'].includes(key)) return 'whatsapp_cloud'
  if (key === 'gmail') return 'email'
  return key
}

function channelLabel(value) {
  return channelOptions.find((option) => option.value === normalizedChannel(value))?.label || value || '—'
}

function channelIcon(value) {
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
  dialog.value = true
}

function openEdit(template) {
  editingId.value = recordId(template)
  const metadata = template.metadata || {}
  const variables = template.variables || []
  Object.assign(form, emptyForm(), {
    name: template.name || template.title || '',
    channel: normalizedChannel(template.channel || template.type),
    format: template.templateType || template.format || (normalizedChannel(template.channel) === 'email' && template.html ? 'html' : 'text'),
    subject: template.subject || '',
    body: template.html || template.body || template.content || template.message || '',
    payloadJson: JSON.stringify(template.payload || {}, null, 2),
    variantsJson: JSON.stringify(template.variants || {}, null, 2),
    variablesText: Array.isArray(variables) ? variables.join(', ') : String(variables || ''),
    metadata: {
      approvedName: template.externalTemplateName || metadata.approvedName || template.approvedName || '',
      language: template.languageCode || metadata.language || template.language || 'pt_BR',
    },
  })
  dialog.value = true
}

async function save() {
  saving.value = true
  let payloadJson
  let variants
  try {
    payloadJson = JSON.parse(form.payloadJson || '{}')
    variants = JSON.parse(form.variantsJson || '{}')
    if (form.channel === 'global' && !Object.keys(variants).length) throw new Error('Defina ao menos uma variante para o template global.')
  } catch (error) {
    $q.notify({ type: 'negative', message: `JSON inválido: ${error.message}` })
    saving.value = false
    return
  }
  if (form.channel === 'global') {
    for (const channel of ['telegram', 'whatsapp_web']) {
      if (!variants[channel]) continue
      const text = variants[channel].text ?? variants[channel].body ?? ''
      variants[channel] = { ...variants[channel], text, body: variants[channel].body ?? text }
    }
  }
  const nonEmptyPayload = Object.keys(payloadJson).length ? payloadJson : undefined
  const payload = {
    name: form.name,
    channel: form.channel,
    templateType: form.format,
    format: form.format,
    subject: form.subject || undefined,
    body: form.body,
    html: form.channel === 'email' && form.format === 'html' ? form.body : undefined,
    variables: form.variablesText.split(',').map((item) => item.trim()).filter(Boolean),
    payload: nonEmptyPayload,
    variants: form.channel === 'global' ? variants : undefined,
    externalTemplateName: form.channel === 'whatsapp_cloud' ? form.metadata.approvedName : undefined,
    languageCode: form.channel === 'whatsapp_cloud' ? form.metadata.language : undefined,
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
              <span class="template-icon"><q-icon :name="channelIcon(props.row.channel || props.row.type)" /></span>
              <div><strong>{{ props.row.name || props.row.title }}</strong><span>{{ props.row.subject || String(props.row.body || props.row.content || '').slice(0, 78) || 'Sem prévia' }}</span></div>
            </div>
          </q-td>
        </template>
        <template #body-cell-channel="props"><q-td :props="props"><q-badge outline color="primary" :label="channelLabel(props.row.channel || props.row.type)" /></q-td></template>
        <template #body-cell-format="props"><q-td :props="props">{{ (props.row.format || 'text').toUpperCase() }}</q-td></template>
        <template #body-cell-updatedAt="props"><q-td :props="props">{{ formatDate(props.row.updatedAt) }}</q-td></template>
        <template #body-cell-actions="props">
          <q-td :props="props">
            <q-btn flat round dense icon="edit" aria-label="Editar template" @click="openEdit(props.row)" />
            <q-btn flat round dense color="negative" icon="delete" aria-label="Remover template" @click="remove(props.row)" />
          </q-td>
        </template>
      </q-table>
    </q-card>

    <q-dialog v-model="dialog" persistent maximized-on-mobile>
      <q-card class="template-dialog">
        <q-card-section class="row items-center q-px-lg q-py-md">
          <div>
            <div class="text-h6 text-weight-bold">{{ editingId ? 'Editar template' : 'Novo template' }}</div>
            <div class="text-caption text-muted">Use <code v-pre>{{variavel}}</code> para conteúdo personalizado.</div>
          </div>
          <q-space />
          <q-btn v-close-popup flat round dense icon="close" aria-label="Fechar" />
        </q-card-section>
        <q-separator />
        <q-form @submit.prevent="save">
          <q-card-section class="template-builder q-pa-lg">
            <div class="editor-column">
              <div class="form-grid">
                <q-input v-model.trim="form.name" outlined label="Nome *" :rules="[(value) => Boolean(value) || 'Informe o nome']" />
                <q-select v-model="form.channel" outlined emit-value map-options :options="channelOptions" label="Canal *" @update:model-value="(value) => value === 'email' && (form.format = 'html')" />
                <q-select v-model="form.format" outlined emit-value map-options label="Formato" :options="[{ label: 'Texto', value: 'text' }, { label: 'HTML', value: 'html' }]" />
                <q-input v-if="form.channel === 'email'" v-model="form.subject" outlined label="Assunto do email" />
                <q-input v-if="form.channel === 'whatsapp_cloud'" v-model="form.metadata.approvedName" outlined label="Nome aprovado na Meta" hint="Obrigatório fora da janela de atendimento" />
                <q-input v-if="form.channel === 'whatsapp_cloud'" v-model="form.metadata.language" outlined label="Idioma" />
                <q-input v-model="form.variablesText" outlined label="Variáveis" hint="Separe por vírgula: nome, protocolo" class="full-span" />
                <q-input v-if="form.channel !== 'global'" v-model="form.payloadJson" outlined type="textarea" label="Payload adicional (JSON)" class="full-span json-input" />
                <q-input v-else v-model="form.variantsJson" outlined type="textarea" label="Variantes por canal (JSON) *" class="full-span json-input" />
              </div>

              <div class="q-mt-md">
                <div class="text-weight-bold q-mb-sm">Conteúdo *</div>
                <q-editor v-if="form.format === 'html'" v-model="form.body" min-height="260px" :toolbar="[['bold', 'italic', 'underline'], ['quote', 'unordered', 'ordered'], ['link'], ['undo', 'redo']]" />
                <q-input v-else v-model="form.body" outlined type="textarea" autogrow label="Mensagem" :rules="[(value) => Boolean(value) || 'Escreva a mensagem']" />
              </div>
            </div>

            <aside class="preview-column">
              <div class="preview-label"><span>Prévia em tempo real</span><q-badge color="primary" :label="channelLabel(form.channel)" /></div>
              <div class="preview-email">
                <div v-if="form.channel === 'email'" class="preview-subject"><strong>Assunto:</strong> {{ form.subject || 'Sem assunto' }}</div>
                <div class="preview-frame" v-html="safePreview" />
              </div>
              <div class="preview-warning">
                <q-icon name="security" color="primary" />
                HTML perigoso é removido da prévia. A API ainda deve sanitizar antes do envio.
              </div>
            </aside>
          </q-card-section>
          <q-separator />
          <q-card-actions align="right" class="q-pa-md q-px-lg">
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
  display: flex;
  align-items: center;
  gap: 11px;
}

.template-icon {
  display: grid;
  width: 38px;
  height: 38px;
  flex: none;
  border-radius: 12px;
  background: rgba(130, 248, 230, 0.22);
  color: #137d6c;
  place-items: center;
}

.template-name strong,
.template-name span {
  display: block;
}

.template-name span {
  max-width: 430px;
  overflow: hidden;
  color: #667a77;
  font-size: 0.76rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-dialog {
  width: min(1180px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  border-radius: 24px;
  background: #f9fffd;
}

.template-builder {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 0.8fr);
  gap: 24px;
  max-height: calc(100vh - 190px);
  overflow: auto;
}

.preview-column {
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

.preview-frame {
  border: 0;
  border-radius: 0;
}

.preview-warning {
  display: flex;
  gap: 8px;
  margin-top: 13px;
  color: #637875;
  font-size: 0.72rem;
  line-height: 1.45;
}

@media (max-width: 850px) {
  .template-dialog {
    width: 100%;
    max-height: 100%;
    border-radius: 0;
  }

  .template-builder {
    grid-template-columns: 1fr;
    max-height: calc(100vh - 180px);
  }
}
</style>
