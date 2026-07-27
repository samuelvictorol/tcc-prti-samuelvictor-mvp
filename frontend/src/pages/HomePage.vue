<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { copyToClipboard, useQuasar } from 'quasar'
import PageHeader from '../components/PageHeader.vue'
import StatusBadge from '../components/StatusBadge.vue'
import EmptyState from '../components/EmptyState.vue'
import ContextHelp from '../components/ContextHelp.vue'
import { useAppStore } from '../stores/app.js'
import {
  channelSettingsPayload,
  generateSecureWebhookSecret,
  isMaskedSecret,
  normalizeTelegramWebhookUrl,
} from '../services/channels.js'
import { asList, errorMessage, http, paginationOf, unwrap } from '../services/http.js'
import { connectSocket, getSocket } from '../services/socket.js'
import {
  DEFAULT_TELEGRAM_PERMISSION_COMMAND,
  telegramBotIdentity,
  telegramPermissionCommandFromSettings,
} from '../services/telegram.js'
import {
  DEFAULT_WHATSAPP_PERMISSION_COMMAND,
  normalizeWhatsappWebStatus,
  shouldShowOperationalLog,
  whatsappPermissionCommandFromSettings,
} from '../services/whatsapp-web.js'

const $q = useQuasar()
const app = useAppStore()
const loading = ref(true)
const savingChannel = reactive({ telegram: false, whatsappCloud: false, email: false })
const registeringWebhook = ref(false)
const savingWhatsappPermission = ref(false)
const savingTelegramPermission = ref(false)
const connectingWhatsappWeb = ref(false)
const regeneratingWhatsappWeb = ref(false)
const disconnectingWhatsappWeb = ref(false)
const telegramWebhookSecretVisible = ref(false)
const whatsappWebStatus = ref(normalizeWhatsappWebStatus())
const logItems = ref([])
const logLoading = ref(false)
const logPage = ref(1)
const logPages = ref(1)
const stats = reactive({ contacts: 0, deliveries: 0, failed: 0 })
const settings = reactive({
  telegram: { botToken: '', webhookSecret: '', webhookUrl: '', bot: null },
  whatsappCloud: { accessToken: '', phoneNumberId: '', displayPhoneNumber: '', businessAccountId: '', verifyToken: '', appSecret: '', apiVersion: 'v25.0' },
  whatsappPermission: { command: DEFAULT_WHATSAPP_PERMISSION_COMMAND },
  telegramPermission: { command: DEFAULT_TELEGRAM_PERMISSION_COMMAND },
  email: { user: '', appPassword: '', from: '', fromName: '' },
})

const TELEGRAM_WEBHOOK_SECRET_MASK = '••••••••••••••••••••••••'

let whatsappWebPollTimer
let whatsappWebPollDeadline = 0

const channels = computed(() => [
  { key: 'telegram', name: 'Telegram', icon: 'send_to_mobile', description: 'Bot e conversas autorizadas' },
  { key: 'whatsappWeb', name: 'WhatsApp Web', icon: 'forum', description: 'Monitor de conversas diretas' },
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

const telegramWebhookSecretConfigured = computed(() => Boolean(
  settings.telegram.webhookSecretConfigured
  || isMaskedSecret(settings.telegram.webhookSecret),
))

const telegramWebhookSecretIsMasked = computed(() => isMaskedSecret(settings.telegram.webhookSecret))

const telegramBot = computed(() => telegramBotIdentity({
  bot: settings.telegram.bot || app.channelStatus('telegram')?.bot,
}))

const telegramBotUsername = computed(() => telegramBot.value?.username ? `@${telegramBot.value.username}` : '')

const whatsappWebReady = computed(() => Boolean(whatsappWebStatus.value.ready))
const whatsappWebQr = computed(() => whatsappWebStatus.value.qrCode || '')
const whatsappWebAttemptActive = computed(() => Boolean(whatsappWebStatus.value.attemptActive))
const visibleLogItems = computed(() => logItems.value.filter((log) => shouldShowOperationalLog(log, whatsappWebReady.value)))

const whatsappWebStateLabel = computed(() => {
  if (whatsappWebReady.value) return 'Conectado em tempo real'
  if (whatsappWebQr.value) return 'Aguardando leitura do QR Code'
  if (whatsappWebAttemptActive.value) return 'Preparando QR Code'
  if (whatsappWebStatus.value.lastError) return 'Falha na última tentativa'
  return 'Desconectado'
})

const whatsappCloudCallbackUrl = computed(() => {
  const origin = typeof window !== 'undefined' ? window.location.origin.replace(/\/$/, '') : ''
  const publicOrigin = origin.startsWith('https://') ? origin : 'https://seudominio.com'
  return `${publicOrigin}/api/webhooks/whatsapp-cloud`
})

async function copyWhatsappCloudCallbackUrl() {
  try {
    await copyToClipboard(whatsappCloudCallbackUrl.value)
    $q.notify({ type: 'positive', message: 'URL de callback copiada.' })
  } catch {
    $q.notify({ type: 'warning', message: 'Não foi possível copiar. Selecione a URL manualmente.' })
  }
}

function generateTelegramWebhookSecret({ notify = true } = {}) {
  try {
    settings.telegram.webhookSecret = generateSecureWebhookSecret()
    telegramWebhookSecretVisible.value = false
    if (notify) {
      $q.notify({
        type: 'positive',
        message: 'Novo webhook secret gerado com segurança.',
        caption: 'Salve o Telegram ou registre o webhook para ativar este novo valor.',
      })
    }
    return settings.telegram.webhookSecret
  } catch (error) {
    $q.notify({ type: 'negative', message: error.message || 'Não foi possível gerar um segredo seguro neste navegador.' })
    return ''
  }
}

async function copyTelegramWebhookSecretValue(value, { generated = false } = {}) {
  try {
    await copyToClipboard(value)
    $q.notify({
      type: 'positive',
      message: generated ? 'Novo webhook secret gerado e copiado.' : 'Webhook secret copiado.',
      caption: generated ? 'O segredo anterior não foi recuperado. Salve ou registre o webhook para ativar o novo valor.' : undefined,
    })
  } catch {
    $q.notify({ type: 'warning', message: 'Não foi possível copiar o webhook secret.' })
  }
}

function generateAndCopyTelegramWebhookSecret() {
  const value = generateTelegramWebhookSecret({ notify: false })
  if (value) copyTelegramWebhookSecretValue(value, { generated: true })
}

function copyTelegramWebhookSecret() {
  const value = String(settings.telegram.webhookSecret || '').trim()
  if (value && !isMaskedSecret(value)) {
    copyTelegramWebhookSecretValue(value)
    return
  }

  if (!telegramWebhookSecretConfigured.value) {
    generateAndCopyTelegramWebhookSecret()
    return
  }

  $q.dialog({
    title: 'Gerar um novo webhook secret?',
    message: 'Por segurança, a API não devolve o segredo já salvo. Para copiar um valor, será gerado um novo segredo no seu navegador. Ele só substituirá o atual depois que você salvar o Telegram ou registrar o webhook.',
    cancel: { flat: true, label: 'Cancelar' },
    ok: { color: 'primary', label: 'Gerar e copiar' },
    persistent: true,
  }).onOk(generateAndCopyTelegramWebhookSecret)
}

function applySettings(value = {}) {
  const source = value.configuration || value.settings || value
  settings.telegram.botToken = ''
  settings.telegram.webhookSecret = ''
  settings.telegram.webhookSecretConfigured = false
  settings.telegram.bot = null
  settings.whatsappCloud.accessToken = ''
  settings.whatsappCloud.verifyToken = ''
  settings.whatsappCloud.appSecret = ''
  settings.email.appPassword = ''
  const telegramSource = { ...(source.telegram || {}) }
  delete telegramSource.botToken
  delete telegramSource.webhookSecret
  Object.assign(settings.telegram, telegramSource)
  settings.telegram.webhookSecret = telegramSource.webhookSecretConfigured
    ? TELEGRAM_WEBHOOK_SECRET_MASK
    : ''
  telegramWebhookSecretVisible.value = false
  Object.assign(settings.whatsappCloud, source.whatsappCloud || source.whatsapp_cloud || source.meta || {})
  Object.assign(settings.email, source.email || source.gmail || {})
  settings.whatsappPermission.command = whatsappPermissionCommandFromSettings(value)
  settings.telegramPermission.command = telegramPermissionCommandFromSettings(value)
}

function stopWhatsappWebPolling() {
  if (whatsappWebPollTimer) window.clearInterval(whatsappWebPollTimer)
  whatsappWebPollTimer = undefined
  whatsappWebPollDeadline = 0
}

function applyWhatsappWebStatus(payload = {}) {
  const status = normalizeWhatsappWebStatus(payload, whatsappWebStatus.value)
  whatsappWebStatus.value = status
  app.updateChannelStatus('whatsappWeb', status)
  if (status.ready || !status.attemptActive) stopWhatsappWebPolling()
  return status
}

async function loadWhatsappWebStatus({ quiet = false } = {}) {
  try {
    const status = applyWhatsappWebStatus(unwrap(await http.get('/whatsapp-web/status')) || {})
    return status
  } catch (error) {
    if (!quiet) $q.notify({ type: 'warning', message: errorMessage(error, 'Não foi possível consultar a sessão do WhatsApp Web.') })
    return whatsappWebStatus.value
  }
}

function startWhatsappWebPolling() {
  if (whatsappWebPollTimer) return
  if (!whatsappWebPollDeadline) whatsappWebPollDeadline = Date.now() + 120_000
  whatsappWebPollTimer = window.setInterval(async () => {
    const status = await loadWhatsappWebStatus({ quiet: true })
    if (status.ready || !status.attemptActive || Date.now() >= whatsappWebPollDeadline) stopWhatsappWebPolling()
  }, 2500)
}

async function generateWhatsappWebQr({ regenerate = false, confirmed = false } = {}) {
  if (regenerate && whatsappWebReady.value && !confirmed) {
    $q.dialog({
      title: 'Gerar um novo QR Code?',
      message: 'A sessão atual será encerrada. Depois, leia o novo QR Code para reativar o monitor.',
      cancel: { flat: true, label: 'Cancelar' },
      ok: { color: 'primary', label: 'Gerar novo QR' },
      persistent: true,
    }).onOk(() => generateWhatsappWebQr({ regenerate: true, confirmed: true }))
    return
  }

  const isRegenerate = regenerate
  if (isRegenerate) regeneratingWhatsappWeb.value = true
  else connectingWhatsappWeb.value = true
  try {
    whatsappWebPollDeadline = Date.now() + 120_000
    const path = isRegenerate ? '/whatsapp-web/session/regenerate' : '/whatsapp-web/session'
    const status = applyWhatsappWebStatus(unwrap(await http.post(path)) || { state: 'initializing', attemptActive: true })
    if (!status.ready) {
      applyWhatsappWebStatus({ ...status, attemptActive: true })
      startWhatsappWebPolling()
    }
    $q.notify({
      type: status.ready ? 'positive' : 'info',
      message: status.ready ? 'WhatsApp Web já está conectado.' : 'Sessão iniciada. O QR Code aparecerá automaticamente.',
    })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível gerar o QR Code do WhatsApp Web.') })
    await loadWhatsappWebStatus({ quiet: true })
  } finally {
    connectingWhatsappWeb.value = false
    regeneratingWhatsappWeb.value = false
  }
}

function confirmDisconnectWhatsappWeb() {
  $q.dialog({
    title: 'Desconectar WhatsApp Web?',
    message: 'A sessão autenticada será encerrada e o monitor ficará indisponível até a leitura de um novo QR Code.',
    cancel: { flat: true, label: 'Cancelar' },
    ok: { color: 'negative', label: 'Desconectar' },
    persistent: true,
  }).onOk(disconnectWhatsappWeb)
}

async function disconnectWhatsappWeb() {
  disconnectingWhatsappWeb.value = true
  try {
    const status = unwrap(await http.delete('/whatsapp-web/session')) || { state: 'disconnected', ready: false, attemptActive: false, qrCode: '' }
    applyWhatsappWebStatus({ ...status, state: 'disconnected', ready: false, attemptActive: false, qrCode: '' })
    $q.notify({ type: 'positive', message: 'WhatsApp Web desconectado.' })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível desconectar o WhatsApp Web.') })
  } finally {
    disconnectingWhatsappWeb.value = false
  }
}

async function saveWhatsappPermission() {
  const command = String(settings.whatsappPermission.command || '').trim()
  if (!command) {
    $q.notify({ type: 'warning', message: 'Informe o texto que o contato deverá enviar para autorizar as notificações.' })
    return
  }
  savingWhatsappPermission.value = true
  try {
    const result = await app.saveSettings({ whatsappPermission: { command } })
    settings.whatsappPermission.command = whatsappPermissionCommandFromSettings(result)
    $q.notify({ type: 'positive', message: 'Comando de autorização do WhatsApp salvo.' })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível salvar o comando de autorização.') })
  } finally {
    savingWhatsappPermission.value = false
  }
}

async function saveTelegramPermission() {
  const command = String(settings.telegramPermission.command || '').trim()
  if (!command) {
    $q.notify({ type: 'warning', message: 'Informe o comando que abre o onboarding do Telegram.' })
    return
  }
  savingTelegramPermission.value = true
  try {
    const result = await app.saveSettings({ telegramPermission: { command } })
    settings.telegramPermission.command = telegramPermissionCommandFromSettings(result)
    $q.notify({ type: 'positive', message: 'Comando de onboarding do Telegram salvo.' })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível salvar o comando do Telegram.') })
  } finally {
    savingTelegramPermission.value = false
  }
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
  const [settingsResult, statusResult, whatsappWebResult, statsResult, contactsResult] = await Promise.allSettled([
    app.fetchSettings(),
    app.fetchStatus(true),
    http.get('/whatsapp-web/status'),
    http.get('/notifications/stats'),
    http.get('/contacts', { params: { active: true, page: 1, limit: 1 } }),
  ])
  if (settingsResult.status === 'fulfilled') applySettings(settingsResult.value)
  if (whatsappWebResult.status === 'fulfilled') {
    const status = applyWhatsappWebStatus(unwrap(whatsappWebResult.value) || {})
    if (status.attemptActive && !status.ready) startWhatsappWebPolling()
  }
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

function addRealtimeLog(log) {
  if (!log || logPage.value !== 1) return
  if (!shouldShowOperationalLog(log, whatsappWebReady.value)) return
  logItems.value = [log, ...logItems.value].slice(0, 12)
}

function onWhatsappWebQr(payload = {}) {
  applyWhatsappWebStatus({ ...payload, state: 'qr', ready: false, attemptActive: true })
  whatsappWebPollDeadline = Date.now() + 120_000
  startWhatsappWebPolling()
}

function onWhatsappWebStatus(payload = {}) {
  const status = applyWhatsappWebStatus(payload)
  if (status.attemptActive && !status.ready) startWhatsappWebPolling()
}

function onWhatsappWebReady(payload = {}) {
  applyWhatsappWebStatus({ ...payload, state: 'ready', ready: true, attemptActive: false, qrCode: '' })
}

function onWhatsappWebDisconnected(payload = {}) {
  applyWhatsappWebStatus({ ...payload, state: 'disconnected', ready: false, attemptActive: false, qrCode: '' })
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
  socket.on('whatsapp_web:qr', onWhatsappWebQr)
  socket.on('whatsapp_web:status', onWhatsappWebStatus)
  socket.on('whatsapp_web:ready', onWhatsappWebReady)
  socket.on('whatsapp_web:disconnected', onWhatsappWebDisconnected)
})

onBeforeUnmount(() => {
  const socket = getSocket()
  socket.off('log', addRealtimeLog)
  socket.off('log:new', addRealtimeLog)
  socket.off('logs:new', addRealtimeLog)
  socket.off('log:created', addRealtimeLog)
  socket.off('channels:status')
  socket.off('whatsapp_web:qr', onWhatsappWebQr)
  socket.off('whatsapp_web:status', onWhatsappWebStatus)
  socket.off('whatsapp_web:ready', onWhatsappWebReady)
  socket.off('whatsapp_web:disconnected', onWhatsappWebDisconnected)
  stopWhatsappWebPolling()
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
      <article
        v-for="channel in channels"
        :key="channel.key"
        class="channel-card glass-card"
        :class="{ 'channel-card--configured': app.isChannelEnabled(channel.key) }"
      >
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
          <div class="row items-center q-gutter-xs">
            <h2 class="section-title">Credenciais e canais</h2>
            <ContextHelp
              title="Configurações independentes por canal"
              tooltip="Entenda como as credenciais são salvas"
              text="Salve cada provedor separadamente. Campos vazios mantêm os valores existentes e um canal incompleto não bloqueia os demais."
            />
          </div>
        </div>

        <q-expansion-item
          icon="send_to_mobile"
          label="Telegram"
          :caption="app.isChannelEnabled('telegram') ? 'Configurado e disponível' : undefined"
          :header-class="app.isChannelEnabled('telegram') ? 'channel-config-header channel-config-header--configured text-weight-bold' : 'channel-config-header text-weight-bold'"
        >
          <div class="form-grid q-pa-md">
            <div v-if="telegramBot" class="full-span telegram-bot-card">
              <q-avatar class="telegram-bot-avatar" color="primary" text-color="white" icon="smart_toy" size="36px" />
              <div class="telegram-bot-copy">
                <span>Bot identificado automaticamente</span>
                <strong>{{ telegramBot.displayName }}</strong>
                <small v-if="telegramBotUsername">{{ telegramBotUsername }}</small>
              </div>
              <q-icon name="verified" color="positive" size="22px" />
            </div>
            <q-input v-model="settings.telegram.botToken" outlined type="password" label="Token do Bot API" autocomplete="off" hint="O token sozinho já permite testar envios manuais" />
            <q-input
              v-model="settings.telegram.webhookSecret"
              outlined
              :type="telegramWebhookSecretVisible ? 'text' : 'password'"
              :label="telegramWebhookSecretIsMasked ? 'Webhook secret configurado' : 'Novo webhook secret (opcional)'"
              autocomplete="new-password"
            >
              <template #append>
                <q-btn
                  v-if="settings.telegram.webhookSecret && !telegramWebhookSecretIsMasked"
                  flat
                  round
                  dense
                  :icon="telegramWebhookSecretVisible ? 'visibility_off' : 'visibility'"
                  :aria-label="telegramWebhookSecretVisible ? 'Ocultar novo webhook secret' : 'Exibir novo webhook secret'"
                  @click="telegramWebhookSecretVisible = !telegramWebhookSecretVisible"
                >
                  <q-tooltip>{{ telegramWebhookSecretVisible ? 'Ocultar segredo' : 'Exibir novo segredo' }}</q-tooltip>
                </q-btn>
                <q-btn flat round dense color="primary" icon="key" aria-label="Gerar novo webhook secret" @click="generateTelegramWebhookSecret()">
                  <q-tooltip>Gerar novo segredo seguro</q-tooltip>
                </q-btn>
                <q-btn flat round dense color="primary" icon="content_copy" aria-label="Copiar webhook secret" @click="copyTelegramWebhookSecret">
                  <q-tooltip>Copiar webhook secret</q-tooltip>
                </q-btn>
                <ContextHelp
                  title="Webhook secret do Telegram"
                  tooltip="Entenda como o segredo é protegido"
                  :text="[
                    'Se ficar vazio ao registrar, a API gera um segredo seguro.',
                    'Um segredo já salvo aparece somente como máscara e nunca é devolvido pela API. Para copiá-lo, o navegador gera um novo valor seguro; salve ou registre o webhook para ativá-lo.',
                  ]"
                />
              </template>
            </q-input>
            <q-input
              v-model="settings.telegram.webhookUrl"
              class="full-span"
              outlined
              type="url"
              label="URL pública do webhook (opcional para enviar)"
              placeholder="https://seu-id.ngrok-free.app"
            >
              <template #append>
                <ContextHelp
                  title="URL do webhook do Telegram"
                  tooltip="Entenda como a URL é completada"
                  text="Se você colar apenas a URL base do ngrok, a rota /api/webhooks/telegram será acrescentada."
                />
              </template>
            </q-input>
            <div class="full-span channel-actions">
              <q-btn outline color="primary" no-caps icon="save" label="Salvar Telegram" :loading="savingChannel.telegram" @click="saveChannel('telegram')" />
              <q-btn color="primary" unelevated no-caps icon="webhook" label="Salvar e registrar webhook" :loading="registeringWebhook" @click="registerTelegramWebhook" />
              <q-btn flat color="primary" no-caps icon="send" label="Teste manual" to="/telegram" :disable="!app.isChannelEnabled('telegram')" />
            </div>
            <div class="full-span channel-hint"><q-icon name="info" /> O webhook recebe /start e respostas; ele não é obrigatório para enviar a contatos que já possuem chat_id autorizado.</div>
          </div>
        </q-expansion-item>
        <q-separator />
        <q-expansion-item
          icon="cloud_sync"
          label="WhatsApp Cloud API"
          :caption="app.isChannelEnabled('whatsappCloud') ? 'Configurado e disponível' : undefined"
          :header-class="app.isChannelEnabled('whatsappCloud') ? 'channel-config-header channel-config-header--configured text-weight-bold' : 'channel-config-header text-weight-bold'"
        >
          <div class="form-grid q-pa-md">
            <q-input
              :model-value="whatsappCloudCallbackUrl"
              class="full-span"
              outlined
              readonly
              label="URL de callback do webhook"
            >
              <template #append>
                <ContextHelp
                  title="Callback do WhatsApp Cloud"
                  tooltip="Saiba onde cadastrar esta URL"
                  text="Cadastre esta URL em Meta Developers. Em acesso local, substitua seudominio.com pelo seu domínio HTTPS ou ngrok."
                />
                <q-btn flat round dense color="primary" icon="content_copy" aria-label="Copiar URL de callback" @click="copyWhatsappCloudCallbackUrl" />
              </template>
            </q-input>
            <div class="full-span whatsapp-cloud-webhook-hint">
              <q-icon name="verified_user" />
              <span>Use o mesmo <strong>Webhook verify token</strong> abaixo no painel da Meta e assine o campo <strong>messages</strong>.</span>
            </div>
            <q-input
              v-model="settings.whatsappCloud.phoneNumberId"
              outlined
              label="Phone Number ID"
            >
              <template #append>
                <ContextHelp
                  title="Phone Number ID"
                  tooltip="Diferencie o ID do número público"
                  text="Identificador técnico fornecido pela Meta; não é o número de telefone."
                />
              </template>
            </q-input>
            <q-input
              v-model="settings.whatsappCloud.displayPhoneNumber"
              outlined
              label="Número público do WhatsApp (com DDI)"
              mask="+## (##) #####-####"
              unmasked-value
              placeholder="+55 (61) 98174-8795"
            >
              <template #append>
                <ContextHelp
                  title="Número público do WhatsApp"
                  tooltip="Entenda onde este número é usado"
                  text="Usado nos links wa.me dos convites. Salvo separado do Phone Number ID."
                />
              </template>
            </q-input>
            <q-input v-model="settings.whatsappCloud.businessAccountId" outlined label="Business Account ID" />
            <q-input v-model.trim="settings.whatsappCloud.apiVersion" outlined label="Versão da Graph API">
              <template #append>
                <ContextHelp
                  title="Versão da Graph API"
                  tooltip="Entenda a versão usada nos exemplos"
                  text="Use v25.0 para reproduzir os exemplos deste ambiente de testes."
                />
              </template>
            </q-input>
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
        <q-expansion-item
          icon="mail"
          label="Gmail"
          :caption="app.isChannelEnabled('email') ? 'Configurado e disponível' : undefined"
          :header-class="app.isChannelEnabled('email') ? 'channel-config-header channel-config-header--configured text-weight-bold' : 'channel-config-header text-weight-bold'"
        >
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

      <q-card flat class="glass-card section-card direct-chat-card">
        <div class="direct-chat-card__heading">
          <div class="direct-chat-card__icon"><q-icon name="forum" /></div>
          <div>
            <div class="row items-center q-gutter-xs">
              <h2 class="section-title">WhatsApp Web: conexão do monitor</h2>
              <ContextHelp
                title="Conexão e privacidade do monitor"
                tooltip="Como funciona o QR Code e o monitor"
                :text="[
                  'Leia o QR Code aqui. O menu de conversas será liberado somente depois da autenticação.',
                  'O WhatsApp Web mostra somente mensagens novas recebidas após a conexão. Interações sem permissão ficam em uma inbox temporária e somente para leitura; não há importação de chats ou histórico.',
                ]"
              />
            </div>
          </div>
        </div>

        <div class="direct-chat-card__status" aria-live="polite">
          <StatusBadge :value="whatsappWebReady" />
          <span>{{ whatsappWebStateLabel }}</span>
          <q-spinner-dots v-if="whatsappWebAttemptActive && !whatsappWebQr" color="primary" size="20px" />
        </div>

        <div class="whatsapp-web-auth-stage" :class="{ 'whatsapp-web-auth-stage--ready': whatsappWebReady }">
          <img
            v-if="whatsappWebQr"
            :src="whatsappWebQr"
            alt="QR Code para autenticar o WhatsApp Web"
            class="whatsapp-web-qr"
          />
          <template v-else-if="whatsappWebReady">
            <q-icon name="phonelink_lock" />
            <div><strong>Sessão autenticada</strong><span>Novas mensagens autorizadas aparecem em tempo real.</span></div>
          </template>
          <template v-else-if="whatsappWebAttemptActive">
            <q-spinner color="primary" size="48px" />
            <div><strong>Preparando o QR Code…</strong><span>A tela será atualizada automaticamente.</span></div>
          </template>
          <template v-else>
            <q-icon name="qr_code_2" />
            <div><strong>Nenhuma sessão ativa</strong><span>Gere um QR Code e leia-o em Aparelhos conectados no WhatsApp.</span></div>
          </template>
        </div>

        <div v-if="whatsappWebStatus.lastError && !whatsappWebReady" class="whatsapp-web-error">
          <q-icon name="error_outline" />
          <span>{{ whatsappWebStatus.lastError }}</span>
        </div>

        <div class="whatsapp-web-actions">
          <q-btn
            v-if="!whatsappWebReady && !whatsappWebAttemptActive && !whatsappWebQr"
            color="primary"
            unelevated
            no-caps
            icon="qr_code_2"
            label="Gerar QR Code"
            :loading="connectingWhatsappWeb"
            @click="generateWhatsappWebQr()"
          />
          <q-btn
            v-if="whatsappWebAttemptActive || whatsappWebQr || whatsappWebReady"
            outline
            color="primary"
            no-caps
            icon="refresh"
            :label="whatsappWebReady ? 'Gerar novo QR Code' : 'Gerar novamente'"
            :loading="regeneratingWhatsappWeb"
            @click="generateWhatsappWebQr({ regenerate: true })"
          />
          <q-btn
            v-if="whatsappWebReady || whatsappWebStatus.initialized || whatsappWebAttemptActive"
            flat
            color="negative"
            no-caps
            icon="link_off"
            label="Desconectar"
            :loading="disconnectingWhatsappWeb"
            @click="confirmDisconnectWhatsappWeb"
          />
          <q-btn
            color="primary"
            unelevated
            no-caps
            icon="open_in_new"
            label="Abrir monitor"
            to="/whatsapp-web"
            :disable="!whatsappWebReady"
          />
        </div>
      </q-card>
    </section>

    <q-card flat class="glass-card section-card whatsapp-permission-card q-mb-lg">
      <div class="whatsapp-permission-card__icon"><q-icon name="send_to_mobile" /></div>
      <div class="whatsapp-permission-card__copy">
        <div class="row items-center q-gutter-xs">
          <h2 class="section-title">Onboarding automático do Telegram</h2>
          <ContextHelp
            title="Comando de onboarding do Telegram"
            tooltip="Entenda o onboarding automático"
            :text="[
              'Quando o usuário enviar este comando ao bot, ele será autorizado e receberá um menu com vínculo seguro de telefone, acesso ao Meu perfil e Ajuda. O comando dinâmico do WhatsApp também continua válido no Telegram e abre o mesmo menu.',
              'Pode ser alterado; /notify-me permanece dinâmico conforme a configuração do WhatsApp.',
            ]"
          />
        </div>
        <code>START_VERIFY_TELEGRAM_PERMISSION</code>
      </div>
      <q-input
        v-model="settings.telegramPermission.command"
        outlined
        label="Comando do onboarding Telegram"
        placeholder="/verify-me"
        maxlength="100"
        counter
        class="whatsapp-permission-card__input"
        @keydown.enter.prevent="saveTelegramPermission"
      />
      <q-btn
        color="primary"
        unelevated
        no-caps
        icon="save"
        label="Salvar comando Telegram"
        :loading="savingTelegramPermission"
        @click="saveTelegramPermission"
      />
    </q-card>

    <q-card flat class="glass-card section-card whatsapp-permission-card q-mb-lg">
      <div class="whatsapp-permission-card__icon"><q-icon name="how_to_reg" /></div>
      <div class="whatsapp-permission-card__copy">
        <div class="row items-center q-gutter-xs">
          <h2 class="section-title">Autorização automática de contatos do WhatsApp</h2>
          <ContextHelp
            title="Quando um contato do WhatsApp é cadastrado"
            tooltip="Entenda a autorização automática"
            :text="[
              'No WhatsApp Web, mensagens comuns de um remetente desconhecido aparecem temporariamente no monitor, sem criar contato, consentimento ou aviso de novo usuário. O contato só é cadastrado automaticamente quando envia este texto exato. Quando o comando chega pelo Web ou Cloud, a conversa pendente é associada sem duplicar mensagens e o sistema autoriza as duas integrações para o mesmo contato. A integração já identificada é liberada imediatamente; a outra é liberada quando sua identidade real existir. As permissões continuam separadas para ajustes e revogações individuais.',
              'O comando recebido no WhatsApp Web ou Cloud autoriza as duas integrações, sem criar um destino que ainda não foi identificado.',
            ]"
          />
        </div>
        <code>START_NOTIFY_WHATSAPP_PERMISSION</code>
      </div>
      <q-input
        v-model="settings.whatsappPermission.command"
        outlined
        label="Texto de autorização"
        placeholder="/notify-me"
        maxlength="100"
        counter
        class="whatsapp-permission-card__input"
        @keydown.enter.prevent="saveWhatsappPermission"
      />
      <q-btn
        color="primary"
        unelevated
        no-caps
        icon="save"
        label="Salvar comando"
        :loading="savingWhatsappPermission"
        @click="saveWhatsappPermission"
      />
    </q-card>

    <q-card flat class="glass-card section-card">
      <div class="toolbar-row">
        <div>
          <h2 class="section-title">Console de eventos</h2>
          <p class="section-copy"><span class="status-dot status-dot--online" /> Atualizações recebidas em tempo real e dados sensíveis ocultados pela API.</p>
        </div>
        <q-btn flat round icon="refresh" aria-label="Atualizar logs" :loading="logLoading" @click="loadLogs" />
      </div>
      <q-inner-loading :showing="logLoading" label="Carregando eventos..." />
      <EmptyState v-if="!logLoading && !visibleLogItems.length" icon="terminal" title="Nenhum evento registrado" description="Novos eventos da API aparecerão aqui em tempo real." />
      <div v-else class="log-list">
        <div v-for="(log, index) in visibleLogItems" :key="log.id || log._id || index" class="log-row">
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

.channel-card--configured {
  border-color: rgba(21, 157, 130, 0.34);
  background: linear-gradient(135deg, rgba(220, 250, 241, 0.88), rgba(255, 255, 255, 0.58));
  box-shadow: inset 4px 0 0 #1a9f83;
}

:deep(.channel-config-header) {
  transition: background-color 160ms ease, color 160ms ease;
}

:deep(.channel-config-header--configured) {
  background: rgba(218, 249, 240, 0.72);
  color: #116b59;
  box-shadow: inset 4px 0 0 #1a9f83;
}

:deep(.channel-config-header--configured .q-item__label--caption) {
  color: #368273;
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

.telegram-bot-avatar {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  align-self: center;
}

.telegram-bot-copy {
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

.whatsapp-cloud-webhook-hint {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: -6px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(222, 248, 242, 0.6);
  color: #426b64;
  font-size: 0.78rem;
  line-height: 1.45;
}

.whatsapp-cloud-webhook-hint .q-icon {
  margin-top: 2px;
  color: #16866f;
  font-size: 17px;
}

.direct-chat-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.direct-chat-card__heading {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.direct-chat-card__icon {
  display: grid;
  width: 52px;
  height: 52px;
  flex: 0 0 52px;
  border-radius: 17px;
  background: rgba(53, 188, 164, 0.14);
  color: #137d6c;
  font-size: 27px;
  place-items: center;
}

.direct-chat-card__status {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #5d7470;
}

.whatsapp-web-auth-stage {
  display: grid;
  min-height: 260px;
  align-content: center;
  justify-items: center;
  gap: 14px;
  padding: 22px;
  border: 1px dashed rgba(19, 125, 108, 0.28);
  border-radius: 18px;
  background: rgba(243, 252, 250, 0.72);
  color: #506d68;
  text-align: center;
}

.whatsapp-web-auth-stage--ready {
  min-height: 190px;
  border-style: solid;
  border-color: rgba(27, 158, 130, 0.24);
  background: linear-gradient(135deg, rgba(218, 249, 240, 0.74), rgba(255, 255, 255, 0.72));
}

.whatsapp-web-auth-stage > .q-icon {
  color: #1a9f83;
  font-size: 58px;
}

.whatsapp-web-auth-stage strong,
.whatsapp-web-auth-stage span {
  display: block;
}

.whatsapp-web-auth-stage span {
  max-width: 360px;
  margin-top: 4px;
  font-size: 0.8rem;
  line-height: 1.45;
}

.whatsapp-web-qr {
  width: min(280px, 100%);
  border: 10px solid #fff;
  border-radius: 16px;
  box-shadow: 0 14px 34px rgba(3, 62, 55, 0.12);
}

.whatsapp-web-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.whatsapp-web-actions .q-btn:last-child {
  margin-left: auto;
}

.whatsapp-web-error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(224, 68, 94, 0.08);
  color: #9d2d41;
  font-size: 0.78rem;
  overflow-wrap: anywhere;
}

.whatsapp-permission-card {
  display: grid;
  grid-template-columns: auto minmax(260px, 1fr) minmax(260px, 0.85fr) auto;
  align-items: center;
  gap: 18px;
}

.whatsapp-permission-card__icon {
  display: grid;
  width: 52px;
  height: 52px;
  border-radius: 17px;
  background: rgba(53, 188, 164, 0.14);
  color: #137d6c;
  font-size: 27px;
  place-items: center;
}

.whatsapp-permission-card__copy code {
  display: inline-block;
  margin-top: 8px;
  padding: 4px 8px;
  border-radius: 7px;
  background: rgba(3, 21, 21, 0.06);
  color: #46635e;
  font-size: 0.7rem;
}

.whatsapp-permission-card__input {
  min-width: 0;
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

  .whatsapp-permission-card {
    grid-template-columns: auto minmax(0, 1fr) minmax(260px, 0.9fr);
  }

  .whatsapp-permission-card > .q-btn {
    grid-column: 3;
    justify-self: end;
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

  .direct-chat-card__heading {
    align-items: center;
  }

  .whatsapp-web-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .whatsapp-web-actions .q-btn:last-child {
    margin-left: 0;
  }

  .whatsapp-permission-card {
    grid-template-columns: 1fr;
  }

  .whatsapp-permission-card__icon {
    width: 46px;
    height: 46px;
  }

  .whatsapp-permission-card > .q-btn {
    grid-column: auto;
    justify-self: stretch;
  }
}
</style>
