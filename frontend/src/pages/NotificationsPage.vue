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
const tab = ref('quick')
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
  variablesJson: '{\n  "nome": "{{nome}}"\n}',
})

const channels = computed(() => [
  { label: 'Telegram', value: 'telegram', icon: 'send_to_mobile', enabled: app.isChannelEnabled('telegram') },
  { label: 'WhatsApp Web', value: 'whatsapp_web', icon: 'forum', enabled: app.isChannelEnabled('whatsappWeb') },
  { label: 'WhatsApp Cloud', value: 'whatsapp_cloud', icon: 'cloud_sync', enabled: app.isChannelEnabled('whatsappCloud') },
  { label: 'Email', value: 'email', icon: 'mail', enabled: app.isChannelEnabled('email') },
])

const enabledChannelOptions = computed(() => channels.value.filter((channel) => channel.enabled))
const enabledChannelNames = computed(() => enabledChannelOptions.value.map((channel) => channel.label).join(', '))
const quickChannelOptions = computed(() => [
  ...enabledChannelOptions.value,
  {
    label: 'Todos os canais disponíveis',
    value: 'global',
    icon: 'hub',
    enabled: enabledChannelOptions.value.length > 0,
    disable: enabledChannelOptions.value.length === 0,
  },
])
const contactOptions = computed(() => contacts.value.map((item) => ({ label: item.name || item.email || item.phone, value: item.id || item._id })))
const groupOptions = computed(() => groups.value.map((item) => ({ label: item.name, value: item.id || item._id })))
const templateOptions = computed(() => templates.value
  .filter((template) => {
    if (tab.value === 'global') return (template.channel || template.type) === 'global'
    if (!form.channel) return true
    const channel = String(template.channel || template.type || '').replaceAll('-', '_')
    return form.channel === channel
  })
  .map((item) => ({
    label: `${item.name || item.title} · ${item.channel || item.type}`,
    value: item.id || item._id,
  })))

const selectedRecipients = computed(() => form.contactIds.length + form.groupIds.length)

watch([enabledChannelOptions, tab], ([options, currentTab]) => {
  if (currentTab === 'global') return
  if (currentTab === 'quick' && form.channel === 'global' && options.length) return
  if (!options.some((channel) => channel.value === form.channel)) form.channel = options[0]?.value || null
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
    sent: 'positive',
    queued: 'info',
    processing: 'info',
    partial: 'warning',
    skipped: 'warning',
    failed: 'negative',
    cancelled: 'grey-7',
  }[String(status).toLowerCase()] || 'grey-7'
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
    if (!form.channel && enabledChannelOptions.value.length) form.channel = enabledChannelOptions.value[0].value
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível preparar o disparador.') })
  } finally {
    loading.value = false
  }
}

function buildPayload() {
  let variables = {}
  if (tab.value !== 'quick' && form.variablesJson.trim()) {
    try {
      variables = JSON.parse(form.variablesJson)
    } catch {
      throw new Error('O JSON de variáveis é inválido.')
    }
  }
  return {
    kind: tab.value,
    contactIds: form.contactIds,
    groupIds: form.groupIds,
    channel: notificationChannel(tab.value, form.channel),
    templateId: tab.value === 'quick' ? undefined : form.templateId,
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
    $q.notify({ type: 'warning', message: 'Selecione um template.' })
    return
  }
  if (sendsToAllAvailable && !enabledChannelOptions.value.length) {
    $q.notify({ type: 'warning', message: 'Configure ao menos um canal antes do disparo global.' })
    return
  }
  if (!sendsToAllAvailable && !enabledChannelOptions.value.some((channel) => channel.value === form.channel)) {
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
      ? `A API tentará ${enabledChannelOptions.value.length} canal(is) configurado(s) para cada contato, enviando apenas onde houver autorização. Canais indisponíveis serão ignorados. Deseja continuar?`
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
          <q-tab name="quick" icon="bolt" label="Rápida" />
          <q-tab name="template" icon="description" label="Template" />
          <q-tab name="global" icon="hub" label="Template global" />
        </q-tabs>
        <q-separator class="q-my-lg" />

        <q-tab-panels v-model="tab" animated class="transparent">
          <q-tab-panel v-for="panel in ['quick', 'template', 'global']" :key="panel" :name="panel" class="q-pa-none">
            <div v-if="panel === 'global'" class="global-note q-mb-md">
              <q-icon name="hub" size="24px" />
              <div>
                <strong>Todos os canais disponíveis para cada contato</strong>
                <span v-if="enabledChannelOptions.length">Ativos agora: {{ enabledChannelNames }}. Canais sem configuração ou sem autorização do contato serão ignorados sem bloquear os demais.</span>
                <span v-else>Configure ao menos um canal. Os demais poderão continuar vazios.</span>
              </div>
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
                :options="panel === 'quick' ? quickChannelOptions : enabledChannelOptions"
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
              <template v-else>
                <q-select v-model="form.templateId" outlined emit-value map-options :options="templateOptions" label="Template *" class="full-span" />
                <q-input v-model="form.variablesJson" outlined type="textarea" label="Variáveis em JSON" class="full-span input-code" />
              </template>
            </div>
          </q-tab-panel>
        </q-tab-panels>

        <div class="send-summary">
          <div><span>Destinos selecionados</span><strong>{{ selectedRecipients }}</strong></div>
          <div>
            <span>Canal</span>
            <strong>{{ tab === 'global' || form.channel === 'global' ? `${enabledChannelOptions.length} disponível(is)` : (enabledChannelOptions.find((item) => item.value === form.channel)?.label || '—') }}</strong>
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

.input-code :deep(textarea) {
  font-family: "Cascadia Code", Consolas, monospace;
  font-size: 0.82rem;
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
