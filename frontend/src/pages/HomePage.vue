<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import QRCode from 'qrcode'
import { useQuasar } from 'quasar'
import PageHeader from '../components/PageHeader.vue'
import StatusBadge from '../components/StatusBadge.vue'
import EmptyState from '../components/EmptyState.vue'
import { useAppStore } from '../stores/app.js'
import { channelSettingsPayload, normalizeTelegramWebhookUrl } from '../services/channels.js'
import { asList, errorMessage, http, paginationOf, unwrap } from '../services/http.js'
import { connectSocket, getSocket } from '../services/socket.js'
import { telegramBotIdentity } from '../services/telegram.js'

const $q = useQuasar()
const app = useAppStore()
const loading = ref(true)
const savingChannel = reactive({ telegram: false, whatsappWeb: false, whatsappCloud: false, email: false })
const generatingQr = ref(false)
const registeringWebhook = ref(false)
const qrWaiting = ref(false)
const qrDataUrl = ref('')
const logItems = ref([])
const logLoading = ref(false)
const logPage = ref(1)
const logPages = ref(1)
const stats = reactive({ contacts: 0, deliveries: 0, failed: 0 })
const settings = reactive({
  telegram: { botToken: '', webhookSecret: '', webhookUrl: '', bot: null },
  whatsappWeb: { sessionTtlDays: 90 },
  whatsappCloud: { accessToken: '', phoneNumberId: '', businessAccountId: '', verifyToken: '', appSecret: '' },
  email: { user: '', appPassword: '', from: '', fromName: '' },
})

const channels = computed(() => [
  { key: 'telegram', name: 'Telegram', icon: 'send_to_mobile', description: 'Bot e conversas autorizadas' },
  { key: 'whatsappWeb', name: 'WhatsApp Web', icon: 'forum', description: 'Sessão QR em tempo real' },
  { key: 'whatsappCloud', name: 'WhatsApp Cloud', icon: 'cloud_sync', description: 'API oficial da Meta' },
  { key: 'email', name: 'Gmail', icon: 'mail', description: 'SMTP ou senha de app' },
])

const channelNames = {
  telegram: 'Telegram',
  whatsappWeb: 'WhatsApp Web',
  whatsappCloud: 'WhatsApp Cloud',
  email: 'Gmail',
}

const telegramTokenConfigured = computed(() => Boolean(
  settings.telegram.botToken?.trim()
  || settings.telegram.botTokenConfigured
  || app.isChannelEnabled('telegram'),
))

const telegramBot = computed(() => telegramBotIdentity({
  bot: settings.telegram.bot || app.channelStatus('telegram')?.bot,
}))

const telegramBotUsername = computed(() => telegramBot.value?.username ? `@${telegramBot.value.username}` : '')

function applySettings(value = {}) {
  const source = value.configuration || value.settings || value
  settings.telegram.botToken = ''
  settings.telegram.webhookSecret = ''
  settings.telegram.bot = null
  settings.whatsappCloud.accessToken = ''
  settings.whatsappCloud.verifyToken = ''
  settings.whatsappCloud.appSecret = ''
  settings.email.appPassword = ''
  Object.assign(settings.telegram, source.telegram || {})
  Object.assign(settings.whatsappWeb, source.whatsappWeb || source.whatsapp_web || {})
  Object.assign(settings.whatsappCloud, source.whatsappCloud || source.whatsapp_cloud || source.meta || {})
  Object.assign(settings.email, source.email || source.gmail || {})
}

async function refreshTelegramIdentity() {
  if (!telegramTokenConfigured.value) {
    settings.telegram.bot = null
    return null
  }
  try {
    const status = unwrap(await http.get('/telegram/status', { params: { probe: true } })) || {}
    settings.telegram.bot = telegramBotIdentity(status)
    return settings.telegram.bot
  } catch {
    settings.telegram.bot = null
    return null
  }
}

async function loadLogs() {
  logLoading.value = true
  try {
    const payload = unwrap(await http.get('/logs', { params: { page: logPage.value, limit: 12 } }))
    logItems.value = asList(payload, 'logs')
    const pagination = paginationOf(payload, { page: logPage.value, rowsPerPage: 12, rowsNumber: logItems.value.length })
    logPages.value = Math.max(1, Math.ceil(pagination.rowsNumber / pagination.rowsPerPage))
  } catch (error) {
    $q.notify({ type: 'warning', message: errorMessage(error, 'Não foi possível carregar os logs.') })
  } finally {
    logLoading.value = false
  }
}

async function loadDashboard() {
  loading.value = true
  const [settingsResult, statusResult, statsResult, contactsResult] = await Promise.allSettled([
    app.fetchSettings(),
    app.fetchStatus(true),
    http.get('/notifications/stats'),
    http.get('/contacts', { params: { active: true, page: 1, limit: 1 } }),
  ])
  if (settingsResult.status === 'fulfilled') applySettings(settingsResult.value)
  if (telegramTokenConfigured.value && !telegramBot.value) refreshTelegramIdentity()
  if (statsResult.status === 'fulfilled') {
    const result = unwrap(statsResult.value) || {}
    const totals = result.totals || result
    stats.contacts = result.contacts || result.totalContacts || 0
    stats.deliveries = totals.sent || result.deliveries || result.totalSent || 0
    stats.failed = totals.failed || result.errors || 0
  }
  if (contactsResult.status === 'fulfilled') {
    const payload = unwrap(contactsResult.value) || {}
    const contactItems = asList(payload, 'contacts')
    stats.contacts = paginationOf(payload, { page: 1, rowsPerPage: 1, rowsNumber: contactItems.length }).rowsNumber || contactItems.length
  }
  await loadLogs()
  loading.value = false
}

async function saveChannel(channel, { quiet = false } = {}) {
  const payload = channelSettingsPayload(channel, settings[channel])
  if (!payload) {
    if (!quiet) $q.notify({ type: 'info', message: `Nenhum novo valor de ${channelNames[channel]} para salvar.` })
    return false
  }
  savingChannel[channel] = true
  try {
    const result = await app.saveSettings(payload)
    applySettings(result)
    if (channel === 'telegram' && !telegramBot.value) await refreshTelegramIdentity()
    if (!quiet) $q.notify({ type: 'positive', message: `${channelNames[channel]} salvo sem alterar os outros canais.` })
    return true
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, `Não foi possível salvar ${channelNames[channel]}.`) })
    return false
  } finally {
    savingChannel[channel] = false
  }
}

async function generateQr() {
  generatingQr.value = true
  try {
    const result = unwrap(await http.post('/whatsapp-web/session')) || {}
    const qr = result.qrCode || result.qr || result.dataUrl
    qrWaiting.value = !qr
    if (qr) qrDataUrl.value = String(qr).startsWith('data:image') ? qr : await QRCode.toDataURL(qr, { width: 360, margin: 2 })
    else $q.notify({ type: 'info', message: 'Sessão iniciada. Aguardando o QR Code em tempo real…' })
    await app.fetchStatus(true)
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível gerar o QR Code.') })
  } finally {
    generatingQr.value = false
  }
}

async function registerTelegramWebhook() {
  if (!settings.telegram.webhookUrl?.trim()) {
    $q.notify({ type: 'warning', message: 'Informe a URL pública HTTPS do webhook.' })
    return
  }
  let url
  try {
    url = normalizeTelegramWebhookUrl(settings.telegram.webhookUrl)
  } catch (error) {
    $q.notify({ type: 'warning', message: error.message || 'Informe uma URL HTTPS válida.' })
    return
  }
  registeringWebhook.value = true
  try {
    const pendingCredentials = channelSettingsPayload('telegram', settings.telegram)
    if (pendingCredentials && !(await saveChannel('telegram', { quiet: true }))) return
    if (!telegramTokenConfigured.value) {
      $q.notify({ type: 'warning', message: 'Salve ou informe o token do bot antes de registrar o webhook.' })
      return
    }
    const result = unwrap(await http.post('/telegram/webhook/register', { url })) || {}
    settings.telegram.webhookUrl = url
    $q.notify({
      type: 'positive',
      message: 'Webhook do Telegram registrado.',
      caption: result.webhookSecretGenerated
        ? 'Um segredo de webhook foi gerado e armazenado automaticamente.'
        : 'O token do bot e o webhook continuam independentes dos outros canais.',
    })
    await app.fetchStatus(true)
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível registrar o webhook.') })
  } finally {
    registeringWebhook.value = false
  }
}

async function revokeSession() {
  try {
    await http.delete('/whatsapp-web/session')
    qrDataUrl.value = ''
    qrWaiting.value = false
    await app.fetchStatus(true)
    $q.notify({ type: 'positive', message: 'Sessão do WhatsApp Web encerrada.' })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error) })
  }
}

function addRealtimeLog(log) {
  if (!log || logPage.value !== 1) return
  logItems.value = [log, ...logItems.value].slice(0, 12)
}

async function onWhatsappQr(payload) {
  const qr = payload?.qrCode || payload?.qr || payload?.dataUrl || payload
  if (!qr) return
  qrDataUrl.value = String(qr).startsWith('data:image') ? qr : await QRCode.toDataURL(String(qr), { width: 360, margin: 2 })
  qrWaiting.value = false
}

function onWhatsappStatus(payload) {
  const state = payload?.state || payload?.status || payload
  if (['ready', 'connected', 'authenticated'].includes(String(state).toLowerCase())) {
    qrWaiting.value = false
    qrDataUrl.value = ''
  }
  app.fetchStatus(true)
}

function severityColor(level = '') {
  return { error: 'negative', warn: 'warning', warning: 'warning', info: 'info', success: 'positive' }[level.toLowerCase()] || 'grey-7'
}

function formatDate(value) {
  if (!value) return 'agora'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value))
}

onMounted(() => {
  loadDashboard()
  const socket = connectSocket()
  socket.on('log', addRealtimeLog)
  socket.on('log:new', addRealtimeLog)
  socket.on('logs:new', addRealtimeLog)
  socket.on('log:created', addRealtimeLog)
  socket.on('channels:status', () => app.fetchStatus(true))
  socket.on('whatsapp_web:qr', onWhatsappQr)
  socket.on('whatsapp_web:status', onWhatsappStatus)
})

onBeforeUnmount(() => {
  const socket = getSocket()
  socket.off('log', addRealtimeLog)
  socket.off('log:new', addRealtimeLog)
  socket.off('logs:new', addRealtimeLog)
  socket.off('log:created', addRealtimeLog)
  socket.off('channels:status')
  socket.off('whatsapp_web:qr', onWhatsappQr)
  socket.off('whatsapp_web:status', onWhatsappStatus)
})
</script>

<template>
  <q-page class="page-container">
    <PageHeader
      eyebrow="Visão operacional"
      title="Sua central está sob controle"
      description="Acompanhe a disponibilidade dos canais, proteja credenciais e observe cada evento da operação."
      icon="space_dashboard"
    >
      <template #actions>
        <q-btn outline color="primary" icon="refresh" label="Atualizar" no-caps :loading="loading" @click="loadDashboard" />
      </template>
    </PageHeader>

    <div v-if="$route.query.unavailable" class="unavailable-banner q-mb-lg">
      <q-icon name="lock" size="22px" />
      <div><strong>Canal protegido</strong><span>Configure e conecte o canal antes de acessar suas funções.</span></div>
    </div>

    <section class="page-grid page-grid--3 q-mb-lg" aria-label="Resumo da operação">
      <article class="metric-card glass-card">
        <div class="text-muted">Contatos ativos</div>
        <div class="metric-value">{{ stats.contacts.toLocaleString('pt-BR') }}</div>
        <q-icon class="metric-icon" name="group" />
      </article>
      <article class="metric-card glass-card">
        <div class="text-muted">Entregas concluídas</div>
        <div class="metric-value">{{ stats.deliveries.toLocaleString('pt-BR') }}</div>
        <q-icon class="metric-icon" name="task_alt" />
      </article>
      <article class="metric-card glass-card">
        <div class="text-muted">Falhas para revisar</div>
        <div class="metric-value">{{ stats.failed.toLocaleString('pt-BR') }}</div>
        <q-icon class="metric-icon" name="error_outline" />
      </article>
    </section>

    <section class="page-grid channel-grid q-mb-lg" aria-label="Status dos canais">
      <article v-for="channel in channels" :key="channel.key" class="channel-card glass-card">
        <div class="channel-icon"><q-icon :name="channel.icon" size="24px" /></div>
        <div class="channel-copy">
          <strong>{{ channel.name }}</strong>
          <span>{{ channel.description }}</span>
        </div>
        <StatusBadge :value="app.isChannelEnabled(channel.key)" />
      </article>
    </section>

    <section class="page-grid page-grid--2 q-mb-lg">
      <q-card flat class="glass-card section-card">
        <div class="toolbar-row">
          <div>
            <h2 class="section-title">Credenciais e canais</h2>
            <p class="section-copy">Salve cada provedor separadamente. Campos vazios mantêm os valores existentes e um canal incompleto não bloqueia os demais.</p>
          </div>
        </div>

        <q-expansion-item default-opened icon="send_to_mobile" label="Telegram" header-class="text-weight-bold">
          <div class="form-grid q-pa-md">
            <div v-if="telegramBot" class="full-span telegram-bot-card">
              <q-avatar color="primary" text-color="white" icon="smart_toy" size="42px" />
              <div>
                <span>Bot identificado automaticamente</span>
                <strong>{{ telegramBot.displayName }}</strong>
                <small v-if="telegramBotUsername">{{ telegramBotUsername }}</small>
              </div>
              <q-icon name="verified" color="positive" size="22px" />
            </div>
            <q-input v-model="settings.telegram.botToken" outlined type="password" label="Token do Bot API" autocomplete="off" hint="O token sozinho já permite testar envios manuais" />
            <q-input v-model="settings.telegram.webhookSecret" outlined type="password" label="Novo webhook secret (opcional)" autocomplete="new-password" hint="Se ficar vazio ao registrar, a API gera um segredo seguro" />
            <q-input v-model="settings.telegram.webhookUrl" class="full-span" outlined type="url" label="URL pública do webhook (opcional para enviar)" placeholder="https://seu-id.ngrok-free.app" hint="Se você colar apenas a URL base do ngrok, a rota /api/webhooks/telegram será acrescentada" />
            <div class="full-span channel-actions">
              <q-btn outline color="primary" no-caps icon="save" label="Salvar Telegram" :loading="savingChannel.telegram" @click="saveChannel('telegram')" />
              <q-btn color="primary" unelevated no-caps icon="webhook" label="Salvar e registrar webhook" :loading="registeringWebhook" @click="registerTelegramWebhook" />
              <q-btn flat color="primary" no-caps icon="send" label="Teste manual" to="/telegram" :disable="!app.isChannelEnabled('telegram')" />
            </div>
            <div class="full-span channel-hint"><q-icon name="info" /> O webhook recebe /start e respostas; ele não é obrigatório para enviar a contatos que já possuem chat_id autorizado.</div>
          </div>
        </q-expansion-item>
        <q-separator />
        <q-expansion-item icon="cloud_sync" label="WhatsApp Cloud API" header-class="text-weight-bold">
          <div class="form-grid q-pa-md">
            <q-input v-model="settings.whatsappCloud.phoneNumberId" outlined label="Phone Number ID" />
            <q-input v-model="settings.whatsappCloud.businessAccountId" outlined label="Business Account ID" />
            <q-input v-model="settings.whatsappCloud.accessToken" outlined type="password" label="Access token" autocomplete="off" />
            <q-input v-model="settings.whatsappCloud.verifyToken" outlined type="password" label="Webhook verify token" autocomplete="off" />
            <q-input v-model="settings.whatsappCloud.appSecret" class="full-span" outlined type="password" label="App secret (validação X-Hub-Signature-256)" autocomplete="off" />
            <div class="full-span channel-actions">
              <q-btn outline color="primary" no-caps icon="save" label="Salvar WhatsApp Cloud" :loading="savingChannel.whatsappCloud" @click="saveChannel('whatsappCloud')" />
              <q-btn flat color="primary" no-caps icon="send" label="Teste manual" to="/whatsapp-cloud" :disable="!app.isChannelEnabled('whatsappCloud')" />
            </div>
          </div>
        </q-expansion-item>
        <q-separator />
        <q-expansion-item icon="mail" label="Gmail" header-class="text-weight-bold">
          <div class="form-grid q-pa-md">
            <q-input v-model="settings.email.user" outlined type="email" label="Conta Gmail" />
            <q-input v-model="settings.email.from" outlined type="email" label="Email do remetente (GMAIL_FROM)" />
            <q-input v-model="settings.email.fromName" outlined label="Nome do remetente (opcional)" />
            <q-input v-model="settings.email.appPassword" class="full-span" outlined type="password" label="Senha de app" autocomplete="off" />
            <div class="full-span channel-actions">
              <q-btn outline color="primary" no-caps icon="save" label="Salvar Gmail" :loading="savingChannel.email" @click="saveChannel('email')" />
              <q-btn flat color="primary" no-caps icon="send" label="Teste manual" to="/email" :disable="!app.isChannelEnabled('email')" />
            </div>
          </div>
        </q-expansion-item>
      </q-card>

      <q-card flat class="glass-card section-card qr-card">
        <div>
          <h2 class="section-title">Sessão WhatsApp Web</h2>
          <p class="section-copy">Escaneie o QR Code e mantenha os dados da sessão no volume protegido da API.</p>
        </div>
        <div class="qr-stage">
          <img v-if="qrDataUrl" :src="qrDataUrl" alt="QR Code para conectar o WhatsApp Web" />
          <div v-else class="qr-placeholder">
            <q-spinner v-if="qrWaiting" color="primary" size="58px" />
            <q-icon v-else name="qr_code_2" size="76px" />
            <strong>{{ qrWaiting ? 'Aguardando QR Code…' : 'Nenhum QR Code ativo' }}</strong>
            <span>{{ qrWaiting ? 'A sessão foi iniciada; o código chegará pelo canal em tempo real.' : 'Gere um código quando estiver pronto para conectar.' }}</span>
          </div>
        </div>
        <q-input
          v-model.number="settings.whatsappWeb.sessionTtlDays"
          outlined
          type="number"
          min="1"
          max="365"
          label="Expiração local da sessão (dias)"
        />
        <q-btn class="q-mt-sm" flat color="primary" no-caps icon="save" label="Salvar validade desta sessão" :loading="savingChannel.whatsappWeb" @click="saveChannel('whatsappWeb')" />
        <div class="row q-col-gutter-sm q-mt-sm">
          <div class="col"><q-btn class="full-width" color="primary" unelevated no-caps icon="qr_code" label="Gerar novo QR" :loading="generatingQr" @click="generateQr" /></div>
          <div class="col"><q-btn class="full-width" outline color="negative" no-caps icon="link_off" label="Encerrar sessão" @click="revokeSession" /></div>
        </div>
      </q-card>
    </section>

    <q-card flat class="glass-card section-card">
      <div class="toolbar-row">
        <div>
          <h2 class="section-title">Console de eventos</h2>
          <p class="section-copy"><span class="status-dot status-dot--online" /> Atualizações recebidas em tempo real e dados sensíveis ocultados pela API.</p>
        </div>
        <q-btn flat round icon="refresh" aria-label="Atualizar logs" :loading="logLoading" @click="loadLogs" />
      </div>
      <q-inner-loading :showing="logLoading" label="Carregando eventos..." />
      <EmptyState v-if="!logLoading && !logItems.length" icon="terminal" title="Nenhum evento registrado" description="Novos eventos da API aparecerão aqui em tempo real." />
      <div v-else class="log-list">
        <div v-for="(log, index) in logItems" :key="log.id || log._id || index" class="log-row">
          <q-badge :color="severityColor(log.level || log.severity)" :label="(log.level || log.severity || 'info').toUpperCase()" />
          <div class="log-main">
            <strong>{{ log.event || log.title || log.message || 'Evento da aplicação' }}</strong>
            <span v-if="log.message && log.message !== log.title">{{ log.message }}</span>
          </div>
          <time>{{ formatDate(log.createdAt || log.timestamp || log.date) }}</time>
        </div>
      </div>
      <div v-if="logPages > 1" class="row justify-center q-mt-lg">
        <q-pagination v-model="logPage" :max="logPages" direction-links color="primary" @update:model-value="loadLogs" />
      </div>
    </q-card>
  </q-page>
</template>

<style scoped>
.unavailable-banner {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 14px 16px;
  border: 1px solid rgba(199, 125, 23, 0.22);
  border-radius: 16px;
  background: rgba(255, 243, 216, 0.82);
  color: #6e4912;
}

.unavailable-banner strong,
.unavailable-banner span {
  display: block;
}

.unavailable-banner span {
  margin-top: 2px;
  font-size: 0.82rem;
}

.metric-icon {
  position: absolute;
  top: 18px;
  right: 18px;
  z-index: 1;
  color: #137d6c;
  font-size: 28px;
}

.channel-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.channel-card {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
  padding: 16px;
}

.channel-icon {
  display: grid;
  width: 45px;
  height: 45px;
  flex: none;
  border-radius: 14px;
  background: rgba(130, 248, 230, 0.27);
  color: #137d6c;
  place-items: center;
}

.channel-copy {
  min-width: 0;
  flex: 1;
}

.channel-copy strong,
.channel-copy span {
  display: block;
}

.channel-copy span {
  margin-top: 3px;
  overflow: hidden;
  color: #637875;
  font-size: 0.74rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.channel-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.telegram-bot-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid rgba(36, 123, 160, 0.16);
  border-radius: 14px;
  background: rgba(224, 246, 255, 0.46);
}

.telegram-bot-card > div {
  display: grid;
  min-width: 0;
  flex: 1;
}

.telegram-bot-card span,
.telegram-bot-card small {
  color: #5d7470;
  font-size: 0.72rem;
}

.telegram-bot-card strong {
  color: #203f3b;
}

.channel-hint {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  color: #5d7470;
  font-size: 0.78rem;
  line-height: 1.45;
}

.qr-card {
  display: flex;
  flex-direction: column;
}

.qr-stage {
  display: grid;
  min-height: 290px;
  margin: 18px 0;
  border: 1px dashed rgba(3, 21, 21, 0.16);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.54);
  place-items: center;
}

.qr-stage img {
  width: min(260px, 85%);
  height: auto;
  border-radius: 10px;
}

.qr-placeholder {
  display: grid;
  justify-items: center;
  max-width: 280px;
  padding: 25px;
  color: #718581;
  text-align: center;
}

.qr-placeholder strong {
  margin-top: 10px;
  color: #294641;
}

.qr-placeholder span {
  margin-top: 4px;
  font-size: 0.8rem;
}

.log-list {
  border: 1px solid rgba(3, 21, 21, 0.08);
  border-radius: 16px;
  overflow: hidden;
}

.log-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 13px 15px;
  border-bottom: 1px solid rgba(3, 21, 21, 0.07);
  background: rgba(255, 255, 255, 0.38);
}

.log-row:last-child {
  border-bottom: 0;
}

.log-main {
  min-width: 0;
}

.log-main strong,
.log-main span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-main span,
.log-row time {
  color: #657976;
  font-size: 0.76rem;
}

@media (max-width: 1250px) {
  .channel-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 650px) {
  .channel-grid {
    grid-template-columns: 1fr;
  }

  .log-row {
    grid-template-columns: 64px minmax(0, 1fr);
  }

  .log-row time {
    grid-column: 2;
  }

  .channel-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
