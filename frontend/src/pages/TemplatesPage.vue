<script>
export const WHATSAPP_CLOUD_PRESETS = Object.freeze([
  Object.freeze({
    value: 'order_confirmation',
    label: 'Confirmação de pedido',
    description: 'Confirmação oficial com nome do cliente, número e data do pedido.',
    templateName: 'jaspers_market_order_confirmation_v1',
    languageCode: 'en_US',
    preview: 'Pedido {{orderNumber}} de {{customerName}} confirmado em {{orderDate}}.',
    parameters: Object.freeze([
      Object.freeze({ key: 'customerName', label: 'Nome do cliente', example: 'John Doe', position: 1 }),
      Object.freeze({ key: 'orderNumber', label: 'Número do pedido', example: '123456', position: 2 }),
      Object.freeze({ key: 'orderDate', label: 'Data do pedido', example: 'Jul 20, 2026', position: 3 }),
    ]),
  }),
  Object.freeze({
    value: 'plain_text',
    label: 'Texto sem formatação',
    description: 'Mensagem oficial de texto simples, sem campos variáveis.',
    templateName: 'jaspers_market_plain_text_v1',
    languageCode: 'en_US',
    preview: 'Mensagem de texto simples aprovada pela Meta.',
    parameters: Object.freeze([]),
  }),
  Object.freeze({
    value: 'hello_world',
    label: 'Olá mundo',
    description: 'Modelo hello_world disponibilizado pela Meta para o primeiro teste.',
    templateName: 'hello_world',
    languageCode: 'en_US',
    preview: 'Hello World',
    parameters: Object.freeze([]),
  }),
])

export function findWhatsAppCloudPreset(value) {
  return WHATSAPP_CLOUD_PRESETS.find((preset) => (
    preset.value === value || preset.templateName === value
  )) || WHATSAPP_CLOUD_PRESETS[0]
}

export function buildWhatsAppCloudTemplateDefinition(value) {
  const preset = findWhatsAppCloudPreset(value)
  const components = preset.parameters.length
    ? [{
        type: 'body',
        parameters: preset.parameters.map((parameter) => ({
          type: 'text',
          text: `{{${parameter.key}}}`,
        })),
      }]
    : []

  return {
    whatsappCloudPreset: preset.value,
    templateType: 'approved_template',
    externalTemplateName: preset.templateName,
    languageCode: preset.languageCode,
    body: preset.preview,
    variables: preset.parameters.map((parameter) => parameter.key),
    payload: components.length ? { components } : {},
  }
}

export function renderWhatsAppCloudPreview(value) {
  const preset = findWhatsAppCloudPreset(value)
  return preset.parameters.reduce(
    (preview, parameter) => preview.replaceAll(`{{${parameter.key}}}`, parameter.example),
    preset.preview,
  )
}
</script>

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

const cloudPresetOptions = WHATSAPP_CLOUD_PRESETS.map((preset) => ({
  label: preset.label,
  value: preset.value,
  description: preset.description,
}))

const emptyForm = () => ({
  name: '',
  channel: 'telegram',
  format: 'text',
  subject: '',
  body: '',
  cloudPreset: 'order_confirmation',
  payloadJson: '{}',
  variantsJson: '{\n  "telegram": { "text": "", "body": "" },\n  "whatsapp_web": { "text": "", "body": "" },\n  "whatsapp_cloud": { "externalTemplateName": "", "components": [] },\n  "email": { "subject": "", "html": "" }\n}',
  variablesText: '',
  metadata: { approvedName: '', language: 'pt_BR' },
})
const form = reactive(emptyForm())
const selectedCloudPreset = computed(() => findWhatsAppCloudPreset(form.cloudPreset))
const cloudPreviewText = computed(() => renderWhatsAppCloudPreview(form.cloudPreset))

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
  if (form.channel === 'whatsapp_cloud') {
    return DOMPurify.sanitize(`<p>${cloudPreviewText.value}</p>`)
  }
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
  if (form.channel === 'whatsapp_cloud') applyCloudPreset('order_confirmation', { suggestName: true })
  dialog.value = true
}

function applyCloudPreset(value, { suggestName = false } = {}) {
  const previousPreset = findWhatsAppCloudPreset(form.cloudPreset)
  const preset = findWhatsAppCloudPreset(value)
  const canSuggestName = suggestName || !form.name || form.name === previousPreset.label
  form.cloudPreset = preset.value
  form.format = 'approved_template'
  form.metadata.approvedName = preset.templateName
  form.metadata.language = preset.languageCode
  form.body = preset.preview
  form.variablesText = preset.parameters.map((parameter) => parameter.key).join(', ')
  if (canSuggestName) form.name = preset.label
}

function onChannelChange(value) {
  if (value === 'email') {
    form.format = 'html'
    return
  }
  if (value === 'whatsapp_cloud') {
    applyCloudPreset(form.cloudPreset || 'order_confirmation', { suggestName: !editingId.value })
    return
  }
  if (form.format === 'approved_template') form.format = 'text'
}

function onCloudPresetChange(value) {
  applyCloudPreset(value, { suggestName: true })
}

function openEdit(template) {
  editingId.value = recordId(template)
  const metadata = template.metadata || {}
  const variables = template.variables || []
  const channel = normalizedChannel(template.channel || template.type)
  const cloudPreset = findWhatsAppCloudPreset(template.whatsappCloudPreset || template.externalTemplateName).value
  Object.assign(form, emptyForm(), {
    name: template.name || template.title || '',
    channel,
    cloudPreset,
    format: template.templateType || template.format || (channel === 'email' && template.html ? 'html' : 'text'),
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
  if (channel === 'whatsapp_cloud') applyCloudPreset(cloudPreset)
  dialog.value = true
}

async function save() {
  saving.value = true
  let payloadJson = {}
  let variants = {}
  try {
    if (form.channel === 'global') {
      variants = JSON.parse(form.variantsJson || '{}')
      if (!Object.keys(variants).length) throw new Error('Defina ao menos uma variante para o template global.')
    } else if (form.channel !== 'whatsapp_cloud') {
      payloadJson = JSON.parse(form.payloadJson || '{}')
    }
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
  const cloudDefinition = form.channel === 'whatsapp_cloud'
    ? buildWhatsAppCloudTemplateDefinition(form.cloudPreset)
    : null
  const payload = {
    name: form.name,
    channel: form.channel,
    templateType: cloudDefinition?.templateType || form.format,
    format: cloudDefinition?.templateType || form.format,
    subject: form.subject || undefined,
    body: cloudDefinition?.body || form.body,
    html: form.channel === 'email' && form.format === 'html' ? form.body : undefined,
    variables: cloudDefinition?.variables || form.variablesText.split(',').map((item) => item.trim()).filter(Boolean),
    payload: cloudDefinition?.payload || nonEmptyPayload,
    variants: form.channel === 'global' ? variants : undefined,
    whatsappCloudPreset: cloudDefinition?.whatsappCloudPreset,
    externalTemplateName: cloudDefinition?.externalTemplateName,
    languageCode: cloudDefinition?.languageCode,
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
        <template #body-cell-format="props">
          <q-td :props="props">
            {{ (props.row.templateType || props.row.format || 'text') === 'approved_template' ? 'OFICIAL META' : (props.row.templateType || props.row.format || 'text').toUpperCase() }}
          </q-td>
        </template>
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
            <div class="dialog-subtitle">
              {{ form.channel === 'whatsapp_cloud'
                ? 'Escolha um modelo aprovado pela Meta; o sistema monta o payload automaticamente.'
                : 'Use variáveis entre chaves duplas para personalizar o conteúdo.' }}
            </div>
          </div>
          <q-space />
          <q-btn v-close-popup flat round dense icon="close" aria-label="Fechar" />
        </q-card-section>
        <q-separator />
        <q-form @submit.prevent="save">
          <q-card-section class="template-builder q-pa-lg">
            <div class="editor-column">
              <section class="builder-section">
                <div class="section-heading">
                  <div>
                    <strong>Identificação</strong>
                    <span>Defina como este template aparecerá no Notify App.</span>
                  </div>
                </div>
                <div class="form-grid template-basics-grid">
                  <q-input
                    v-model.trim="form.name"
                    outlined
                    stack-label
                    label="Nome no Notify App *"
                    class="template-field"
                    :rules="[(value) => Boolean(value) || 'Informe o nome']"
                  />
                  <q-select
                    v-model="form.channel"
                    outlined
                    stack-label
                    emit-value
                    map-options
                    :options="channelOptions"
                    label="Canal de envio *"
                    class="template-field"
                    @update:model-value="onChannelChange"
                  />
                  <q-select
                    v-if="form.channel !== 'whatsapp_cloud'"
                    v-model="form.format"
                    outlined
                    stack-label
                    emit-value
                    map-options
                    label="Formato do conteúdo"
                    class="template-field"
                    :options="[{ label: 'Texto', value: 'text' }, { label: 'HTML', value: 'html' }]"
                  />
                  <q-input
                    v-if="form.channel === 'email'"
                    v-model="form.subject"
                    outlined
                    stack-label
                    label="Assunto do email"
                    class="template-field"
                  />
                </div>
              </section>

              <template v-if="form.channel === 'whatsapp_cloud'">
                <section class="builder-section cloud-builder-section">
                  <div class="section-heading">
                    <span class="step-number">1</span>
                    <div>
                      <strong>Escolha o modelo oficial</strong>
                      <span>Estes são os três modelos habilitados no ambiente de testes da Meta.</span>
                    </div>
                  </div>

                  <q-select
                    v-model="form.cloudPreset"
                    outlined
                    stack-label
                    emit-value
                    map-options
                    :options="cloudPresetOptions"
                    label="Modelo aprovado pela Meta *"
                    class="template-field cloud-preset-select"
                    @update:model-value="onCloudPresetChange"
                  >
                    <template #option="scope">
                      <q-item v-bind="scope.itemProps" class="cloud-preset-option">
                        <q-item-section avatar><q-icon name="verified" color="primary" /></q-item-section>
                        <q-item-section>
                          <q-item-label>{{ scope.opt.label }}</q-item-label>
                          <q-item-label caption>{{ scope.opt.description }}</q-item-label>
                        </q-item-section>
                      </q-item>
                    </template>
                  </q-select>

                  <div class="official-fields">
                    <q-input
                      :model-value="selectedCloudPreset.templateName"
                      outlined
                      stack-label
                      readonly
                      label="Nome oficial na Meta"
                      class="template-field official-name-field"
                    >
                      <template #prepend><q-icon name="verified" color="primary" /></template>
                    </q-input>
                    <q-input
                      :model-value="selectedCloudPreset.languageCode"
                      outlined
                      stack-label
                      readonly
                      label="Idioma aprovado"
                      class="template-field language-field"
                    />
                  </div>
                </section>

                <section class="builder-section cloud-builder-section">
                  <div class="section-heading">
                    <span class="step-number">2</span>
                    <div>
                      <strong>Campos da notificação</strong>
                      <span v-if="selectedCloudPreset.parameters.length">O usuário preencherá estes valores na tela de disparo.</span>
                      <span v-else>Este modelo não possui campos variáveis.</span>
                    </div>
                  </div>

                  <div v-if="selectedCloudPreset.parameters.length" class="parameter-list">
                    <div v-for="parameter in selectedCloudPreset.parameters" :key="parameter.key" class="parameter-row">
                      <span class="parameter-position">{{ parameter.position }}</span>
                      <div class="parameter-copy">
                        <strong>{{ parameter.label }}</strong>
                        <span>Exemplo da Meta: {{ parameter.example }}</span>
                      </div>
                      <code>{{ parameter.key }}</code>
                    </div>
                  </div>
                  <q-banner v-else rounded class="no-parameters-banner">
                    <template #avatar><q-icon name="check_circle" color="primary" /></template>
                    Pronto para usar: nenhum parâmetro precisa ser configurado.
                  </q-banner>
                </section>

                <q-banner rounded class="automatic-payload-banner">
                  <template #avatar><q-icon name="auto_awesome" color="primary" /></template>
                  <strong>Sem configuração JSON.</strong>
                  O nome oficial, idioma e componentes são gerados automaticamente ao salvar.
                </q-banner>
              </template>

              <template v-else>
                <section class="builder-section">
                  <div class="section-heading">
                    <div>
                      <strong>Conteúdo e variáveis</strong>
                      <span>Monte a mensagem reutilizável deste canal.</span>
                    </div>
                  </div>
                  <div class="form-grid">
                    <q-input
                      v-model="form.variablesText"
                      outlined
                      stack-label
                      label="Variáveis"
                      hint="Separe por vírgula: nome, protocolo"
                      class="full-span template-field"
                    />
                    <q-input
                      v-if="form.channel !== 'global'"
                      v-model="form.payloadJson"
                      outlined
                      stack-label
                      type="textarea"
                      label="Payload adicional (JSON)"
                      class="full-span json-input template-field"
                    />
                    <q-input
                      v-else
                      v-model="form.variantsJson"
                      outlined
                      stack-label
                      type="textarea"
                      label="Variantes por canal (JSON) *"
                      class="full-span json-input template-field"
                    />
                  </div>

                  <div class="content-editor">
                    <div class="field-heading">Conteúdo *</div>
                    <q-editor v-if="form.format === 'html'" v-model="form.body" min-height="260px" :toolbar="[['bold', 'italic', 'underline'], ['quote', 'unordered', 'ordered'], ['link'], ['undo', 'redo']]" />
                    <q-input v-else v-model="form.body" outlined stack-label type="textarea" autogrow label="Mensagem" class="template-field" :rules="[(value) => Boolean(value) || 'Escreva a mensagem']" />
                  </div>
                </section>
              </template>
            </div>

            <aside class="preview-column">
              <div class="preview-label"><span>Prévia em tempo real</span><q-badge color="primary" :label="channelLabel(form.channel)" /></div>
              <div class="preview-email">
                <div v-if="form.channel === 'email'" class="preview-subject"><strong>Assunto:</strong> {{ form.subject || 'Sem assunto' }}</div>
                <div v-if="form.channel === 'whatsapp_cloud'" class="preview-meta-header">
                  <q-icon name="verified" color="primary" />
                  <div><strong>{{ selectedCloudPreset.label }}</strong><span>{{ selectedCloudPreset.templateName }}</span></div>
                </div>
                <div class="preview-frame" v-html="safePreview" />
              </div>
              <div class="preview-warning" :class="{ 'cloud-preview-note': form.channel === 'whatsapp_cloud' }">
                <q-icon :name="form.channel === 'whatsapp_cloud' ? 'info' : 'security'" color="primary" />
                <span v-if="form.channel === 'whatsapp_cloud'">A Meta controla o texto e o layout final. Esta prévia mostra apenas a posição dos valores do disparo.</span>
                <span v-else>HTML perigoso é removido da prévia. A API ainda deve sanitizar antes do envio.</span>
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
  width: min(1280px, calc(100vw - 48px)) !important;
  max-width: 1280px !important;
  max-height: calc(100vh - 32px);
  border-radius: 24px;
  background: #f9fffd;
}

.dialog-subtitle {
  margin-top: 3px;
  color: #667a77;
  font-size: 0.86rem;
  line-height: 1.45;
}

.template-builder {
  display: grid;
  grid-template-columns: minmax(570px, 1.35fr) minmax(340px, 0.65fr);
  gap: 28px;
  max-height: calc(100vh - 190px);
  overflow: auto;
}

.editor-column {
  display: grid;
  align-content: start;
  gap: 18px;
}

.builder-section {
  padding: 20px;
  border: 1px solid rgba(3, 21, 21, 0.09);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.66);
}

.cloud-builder-section {
  background: rgba(240, 252, 249, 0.8);
}

.section-heading {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 17px;
}

.section-heading > div {
  display: grid;
  gap: 3px;
}

.section-heading strong {
  color: #102d29;
  font-size: 1rem;
}

.section-heading span:not(.step-number) {
  color: #667a77;
  font-size: 0.84rem;
  line-height: 1.45;
}

.step-number,
.parameter-position {
  display: grid;
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: 50%;
  background: #27b79f;
  color: #fff;
  font-size: 0.83rem;
  font-weight: 800;
  place-items: center;
}

.template-field :deep(.q-field__control) {
  min-height: 60px;
  border-radius: 14px;
}

.template-field :deep(.q-field__label) {
  color: #506763;
  font-size: 0.96rem;
  font-weight: 650;
}

.template-field :deep(.q-field__native),
.template-field :deep(.q-field__input),
.template-field :deep(.q-field__marginal) {
  font-size: 1rem;
}

.template-field :deep(.q-field__bottom) {
  padding-top: 7px;
  font-size: 0.78rem;
}

.cloud-preset-select {
  margin-bottom: 16px;
}

.cloud-preset-option {
  min-height: 68px;
}

.official-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  gap: 14px;
}

.official-fields :deep(.q-field--readonly .q-field__control) {
  background: rgba(255, 255, 255, 0.76);
}

.official-name-field :deep(.q-field__native) {
  font-family: "Cascadia Code", Consolas, monospace;
  font-size: 0.9rem;
}

.language-field :deep(.q-field__native) {
  font-weight: 750;
}

.parameter-list {
  display: grid;
  gap: 10px;
}

.parameter-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 10px 13px;
  border: 1px solid rgba(3, 21, 21, 0.08);
  border-radius: 14px;
  background: #fff;
}

.parameter-position {
  width: 24px;
  height: 24px;
  background: rgba(39, 183, 159, 0.14);
  color: #137d6c;
}

.parameter-copy {
  display: grid;
  gap: 2px;
}

.parameter-copy strong {
  color: #173833;
  font-size: 0.92rem;
}

.parameter-copy span {
  color: #71837f;
  font-size: 0.78rem;
}

.parameter-row code {
  padding: 6px 9px;
  border-radius: 8px;
  background: #edf8f5;
  color: #116f61;
  font-size: 0.78rem;
}

.no-parameters-banner,
.automatic-payload-banner {
  border: 1px solid rgba(39, 183, 159, 0.18);
  background: rgba(39, 183, 159, 0.07);
  color: #385c56;
  font-size: 0.86rem;
}

.automatic-payload-banner strong {
  margin-right: 3px;
  color: #174c44;
}

.content-editor {
  margin-top: 18px;
}

.field-heading {
  margin-bottom: 9px;
  color: #193c36;
  font-size: 0.94rem;
  font-weight: 750;
}

.preview-column {
  position: sticky;
  top: 0;
  align-self: start;
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

.preview-meta-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(3, 21, 21, 0.08);
  background: #f7fffd;
}

.preview-meta-header > div {
  display: grid;
  min-width: 0;
}

.preview-meta-header strong {
  font-size: 0.88rem;
}

.preview-meta-header span {
  overflow: hidden;
  color: #71837f;
  font-family: "Cascadia Code", Consolas, monospace;
  font-size: 0.7rem;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  font-size: 0.78rem;
  line-height: 1.45;
}

.cloud-preview-note {
  padding: 11px;
  border-radius: 11px;
  background: rgba(39, 183, 159, 0.08);
}

@media (max-width: 1050px) {
  .template-builder {
    grid-template-columns: minmax(0, 1fr) minmax(300px, 0.7fr);
  }
}

@media (max-width: 850px) {
  .template-dialog {
    width: 100% !important;
    max-width: 100% !important;
    max-height: 100%;
    border-radius: 0;
  }

  .template-builder {
    grid-template-columns: 1fr;
    max-height: calc(100vh - 180px);
  }

  .preview-column {
    position: static;
  }
}

@media (max-width: 600px) {
  .builder-section {
    padding: 16px;
  }

  .official-fields {
    grid-template-columns: 1fr;
  }

  .parameter-row {
    grid-template-columns: 24px minmax(0, 1fr);
  }

  .parameter-row code {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
