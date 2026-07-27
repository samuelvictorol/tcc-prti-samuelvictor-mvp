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
</script>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useQuasar } from 'quasar'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import { useAppStore } from '../stores/app.js'
import { notificationChannel, notificationDeliveryCounts, sendsToAllAvailableChannels } from '../services/channels.js'
import { asList, errorMessage, fetchAll, http, unwrap } from '../services/http.js'

const $q = useQuasar()
const app = useAppStore()
const tab = ref('global')
const loading = ref(false)
const sending = ref(false)
const contacts = ref([])
const groups = ref([])
const templates = ref([])
const deliveries = ref([])

const form = reactive({
  contactIds: [],
  groupIds: [],
  channel: null,
  message: '',
  subject: '',
  templateId: null,
  templateIds: { telegram: null, whatsapp_cloud: null, email: null },
  variableValues: {},
})

const channels = computed(() => [
  { label: 'Telegram', value: 'telegram', icon: 'send_to_mobile', enabled: app.isChannelEnabled('telegram') },
  { label: 'WhatsApp Cloud', value: 'whatsapp_cloud', icon: 'cloud_sync', enabled: app.isChannelEnabled('whatsappCloud') },
  { label: 'Email', value: 'email', icon: 'mail', enabled: app.isChannelEnabled('email') },
])

const enabledChannelOptions = computed(() => channels.value.filter((channel) => channel.enabled))
const enabledChannelNames = computed(() => enabledChannelOptions.value.map((channel) => channel.label).join(', '))
const quickEnabledChannelOptions = computed(() => enabledChannelOptions.value.filter((channel) => channel.value !== 'whatsapp_cloud'))
const templateEnabledChannelOptions = computed(() => enabledChannelOptions.value.filter((channel) => channel.value !== 'whatsapp_cloud'))
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

const selectedTemplate = computed(() => templateById(form.templateId))
const selectedGlobalTemplates = computed(() => enabledChannelOptions.value
  .map((channel) => ({ channel: channel.value, template: templateById(form.templateIds[channel.value]) }))
  .filter((entry) => entry.template))
const variableDefinitions = computed(() => tab.value === 'global'
  ? mergeNotificationVariableDefinitions(selectedGlobalTemplates.value)
  : tab.value === 'template' && selectedTemplate.value
    ? notificationTemplateVariableDefinitions(selectedTemplate.value, form.channel)
    : [])

const selectedRecipients = computed(() => form.contactIds.length + form.groupIds.length)

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

async function loadData() {
  loading.value = true
  try {
    await app.fetchStatus(true)
    const [contactItems, groupItems, templateItems, notificationResponse] = await Promise.all([
      fetchAll('/contacts', { params: { active: true }, preferredKey: 'contacts' }),
      fetchAll('/contact-groups', { params: { active: true }, preferredKey: 'groups' }),
      fetchAll('/templates', { preferredKey: 'templates' }),
      http.get('/notifications', { params: { limit: 20 } }),
    ])
    contacts.value = contactItems
    groups.value = groupItems
    templates.value = templateItems
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
    templateIds,
    content: {
      text: tab.value === 'quick' ? form.message : undefined,
      subject: tab.value === 'quick' ? form.subject || undefined : undefined,
      variables,
    },
  }
}

async function send() {
  const sendsToAllAvailable = sendsToAllAvailableChannels(tab.value, form.channel)
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
    const missing = enabledChannelOptions.value.filter((channel) => !form.templateIds[channel.value])
    if (missing.length) {
      $q.notify({ type: 'warning', message: `Selecione o template de: ${missing.map((channel) => channel.label).join(', ')}.` })
      return
    }
  }
  if (sendsToAllAvailable && !dispatchChannelOptions.value.length) {
    $q.notify({ type: 'warning', message: 'Configure ao menos um canal antes do disparo global.' })
    return
  }
  if (!sendsToAllAvailable && !dispatchChannelOptions.value.some((channel) => channel.value === form.channel)) {
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

  $q.dialog({
    title: 'Confirmar disparo',
    message: sendsToAllAvailable
      ? `A API tentará ${dispatchChannelOptions.value.length} canal(is) configurado(s) para cada contato, enviando apenas onde houver autorização. Canais indisponíveis serão ignorados. Deseja continuar?`
      : `A API validará o consentimento no canal escolhido para ${selectedRecipients.value} seleção(ões). Deseja continuar?`,
    cancel: { flat: true, label: 'Revisar' },
    ok: { color: 'primary', label: 'Colocar na fila' },
  }).onOk(async () => {
    sending.value = true
    try {
      const result = unwrap(await http.post('/notifications', payload)) || {}
      const { queued, skipped } = notificationDeliveryCounts(result)
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
          form.templateIds = { telegram: null, whatsapp_cloud: null, email: null }
        }
      }
      await loadData()
    } catch (error) {
      $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível agendar as notificações.') })
    } finally {
      sending.value = false
    }
  })
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
            <div v-if="panel === 'global'" class="global-note q-mb-md">
              <q-icon name="hub" size="24px" />
              <div>
                <strong>Todos os canais disponíveis para cada contato</strong>
                <span v-if="enabledChannelOptions.length">Ativos agora: {{ enabledChannelNames }}. Escolha um template próprio para cada canal; contatos sem autorização serão ignorados sem bloquear os demais.</span>
                <span v-else>Configure ao menos um canal. Os demais poderão continuar vazios.</span>
              </div>
            </div>
            <div v-else-if="panel === 'template' && app.isChannelEnabled('whatsappCloud')" class="global-note q-mb-md">
              <q-icon name="cloud_sync" size="24px" />
              <div><strong>WhatsApp oficial usa um formulário próprio</strong><span>Nome aprovado, componentes e permissões são montados sem JSON na tela do canal.</span></div>
              <q-space />
              <q-btn flat color="primary" no-caps label="Abrir WhatsApp oficial" to="/whatsapp-cloud" />
            </div>

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
                <section class="full-span global-template-grid" aria-label="Templates do envio global">
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
                      :label="`Template ${channel.label} *`"
                      :hint="templatesForChannel(channel.value).length ? 'Somente templates ativos deste canal' : 'Cadastre um template para continuar'"
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
            <strong>{{ tab === 'global' || form.channel === 'global' ? `${dispatchChannelOptions.length} disponível(is)` : (dispatchChannelOptions.find((item) => item.value === form.channel)?.label || '—') }}</strong>
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
      <q-table v-else flat :rows="deliveries" :columns="deliveryColumns" row-key="id" :loading="loading" :rows-per-page-options="[10, 20]">
        <template #body-cell-createdAt="props"><q-td :props="props">{{ formatDate(props.row.createdAt) }}</q-td></template>
        <template #body-cell-mode="props"><q-td :props="props">{{ props.row.mode || props.row.type || '—' }}</q-td></template>
        <template #body-cell-channel="props"><q-td :props="props"><q-badge outline color="primary" :label="props.row.channel || 'global'" /></q-td></template>
        <template #body-cell-recipient="props"><q-td :props="props">{{ props.row.recipient?.name || props.row.contact?.name || props.row.recipient || 'Lote' }}</q-td></template>
        <template #body-cell-status="props"><q-td :props="props"><q-badge :color="statusColor(props.row.status)" :label="props.row.status || 'queued'" /></q-td></template>
      </q-table>
    </q-card>
  </q-page>
</template>

<style scoped>
.notification-layout {
  grid-template-columns: minmax(0, 1.6fr) minmax(280px, 0.55fr);
  align-items: start;
}

.composer-tabs {
  justify-content: flex-start;
}

.global-note {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 15px;
  border: 1px solid rgba(53, 188, 164, 0.2);
  border-radius: 15px;
  background: rgba(130, 248, 230, 0.12);
  color: #184b44;
}

.global-note strong,
.global-note span {
  display: block;
}

.global-note span {
  margin-top: 2px;
  color: #55706c;
  font-size: 0.78rem;
}

.global-template-grid,
.variable-fields {
  display: grid;
  gap: 12px;
}

.global-template-grid {
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
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

@media (max-width: 1000px) {
  .notification-layout {
    grid-template-columns: 1fr;
  }

  .safety-column {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 650px) {
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
}
</style>
