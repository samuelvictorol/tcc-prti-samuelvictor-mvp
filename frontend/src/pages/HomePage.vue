<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { copyToClipboard, useQuasar } from 'quasar'
import { useRouter } from 'vue-router'
import PageHeader from '../components/PageHeader.vue'
import StatusBadge from '../components/StatusBadge.vue'
import EmptyState from '../components/EmptyState.vue'
import ContextHelp from '../components/ContextHelp.vue'
import { useAppStore } from '../stores/app.js'
import {
  channelCredentialFields,
  channelCredentialPreviews,
  channelSettingsPayload,
  mergeRevealedChannelValues,
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
  whatsappPermissionCommandFromSettings,
} from '../services/whatsapp.js'
import {
  MAX_USEFUL_LINKS,
  USEFUL_LINK_ICON_OPTIONS,
  createUsefulLink,
  normalizeUsefulLinks,
  usefulLinksPayload,
  validateUsefulLinks,
} from '../services/useful-links.js'

const DEFAULT_WHATSAPP_CONSENT_REQUEST_TEXT = 'Para ativar suas notificações, responda com {command}.'
const DEFAULT_TELEGRAM_MESSAGES = Object.freeze({
  onboarding: 'Olá, {name}! Suas notificações pelo Telegram estão ativadas.\n\n{status}\n\nUse as opções abaixo para vincular seu telefone, consultar o Meu perfil ou abrir a ajuda.\n\n{invites}\n\nComando utilizado: {command}',
  phoneShare: 'Para unir Telegram e WhatsApp no mesmo cadastro, compartilhe seu próprio telefone pelo botão oficial abaixo. O número só será aceito se pertencer a você.',
  profile: 'Seu acesso seguro ao Meu perfil está pronto. O botão abaixo é pessoal, funciona uma única vez e expira em até 7 dias.',
  help: 'Ajuda do Notify Flow\n\nVincular meu telefone: confirma que este Telegram e o WhatsApp pertencem a você e evita cadastros duplicados.\n\nMeu perfil: mostra seus dados, permissões e histórico de notificações em uma página segura.\n\nVocê pode revisar ou revogar cada permissão quando quiser.',
})

const $q = useQuasar()
const router = useRouter()
const app = useAppStore()
const loading = ref(true)
const savingChannel = reactive({ telegram: false, whatsappCloud: false, email: false })
const savingWhatsappPermission = ref(false)
const savingTelegramPermission = ref(false)
const savingUsefulLinks = ref(false)
const revealingCredentials = reactive({ telegram: false, whatsappCloud: false, email: false })
const channelCredentialsVisible = reactive({ telegram: false, whatsappCloud: false, email: false })
const savedCredentialPreviews = reactive({ telegram: {}, whatsappCloud: {}, email: {} })
const revealedCredentialBaselines = reactive({ telegram: {}, whatsappCloud: {}, email: {} })
const logItems = ref([])
const logLoading = ref(false)
const logPage = ref(1)
const logPages = ref(1)
const stats = reactive({ contacts: 0, deliveries: 0, failed: 0 })
const settings = reactive({
  telegram: {
    botToken: '',
    webhookSecret: '',
    webhookUrl: '',
    bot: null,
    messages: { ...DEFAULT_TELEGRAM_MESSAGES },
  },
  whatsappCloud: { accessToken: '', phoneNumberId: '', displayPhoneNumber: '', businessAccountId: '', verifyToken: '', appSecret: '', apiVersion: 'v25.0' },
  whatsappPermission: {
    command: DEFAULT_WHATSAPP_PERMISSION_COMMAND,
    requestText: DEFAULT_WHATSAPP_CONSENT_REQUEST_TEXT,
  },
  telegramPermission: { command: DEFAULT_TELEGRAM_PERMISSION_COMMAND },
  email: { user: '', appPassword: '', from: '', fromName: '' },
  usefulLinks: [],
})

const channels = computed(() => [
  { key: 'whatsappCloud', name: 'WhatsApp Cloud', icon: 'mdi-whatsapp', description: 'API oficial da Meta', to: '/whatsapp-cloud', tone: 'whatsapp' },
  { key: 'telegram', name: 'Telegram', icon: 'bi-telegram', description: 'Bot e conversas autorizadas', to: '/telegram', tone: 'telegram' },
  { key: 'email', name: 'Gmail', icon: 'mdi-gmail', description: 'SMTP ou senha de app', to: '/email', tone: 'gmail' },
])

const channelNames = {
  telegram: 'Telegram',
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

const visibleLogItems = computed(() => logItems.value)

const whatsappCloudCallbackUrl = computed(() => {
  const origin = typeof window !== 'undefined' ? window.location.origin.replace(/\/$/, '') : ''
  const publicOrigin = origin.startsWith('https://') ? origin : 'https://seudominio.com'
  return `${publicOrigin}/api/webhooks/whatsapp-cloud`
})

const telegramCallbackUrl = computed(() => {
  const origin = typeof window !== 'undefined' ? window.location.origin.replace(/\/$/, '') : ''
  const publicOrigin = origin.startsWith('https://') ? origin : 'https://seudominio.com'
  return `${publicOrigin}/api/webhooks/telegram`
})

async function copyTelegramCallbackUrl() {
  try {
    await copyToClipboard(telegramCallbackUrl.value)
    $q.notify({ type: 'positive', message: 'URL de callback do Telegram copiada.' })
  } catch {
    $q.notify({ type: 'warning', message: 'Não foi possível copiar. Selecione a URL manualmente.' })
  }
}

async function copyWhatsappCloudCallbackUrl() {
  try {
    await copyToClipboard(whatsappCloudCallbackUrl.value)
    $q.notify({ type: 'positive', message: 'URL de callback copiada.' })
  } catch {
    $q.notify({ type: 'warning', message: 'Não foi possível copiar. Selecione a URL manualmente.' })
  }
}

function applySettings(value = {}) {
  const source = value.configuration || value.settings || value
  settings.telegram.webhookSecretConfigured = false
  settings.telegram.bot = null
  const telegramSource = { ...(source.telegram || {}) }
  const telegramMessages = { ...(telegramSource.messages || {}) }
  delete telegramSource.botToken
  delete telegramSource.webhookSecret
  delete telegramSource.messages
  Object.assign(settings.telegram, telegramSource)
  Object.assign(settings.telegram.messages, DEFAULT_TELEGRAM_MESSAGES, telegramMessages)
  Object.assign(settings.whatsappCloud, source.whatsappCloud || source.whatsapp_cloud || source.meta || {})
  Object.assign(settings.email, source.email || source.gmail || {})
  settings.usefulLinks.splice(0, settings.usefulLinks.length, ...normalizeUsefulLinks(source.usefulLinks))
  for (const channel of ['telegram', 'whatsappCloud', 'email']) {
    const channelSource = channel === 'whatsappCloud'
      ? (source.whatsappCloud || source.whatsapp_cloud || source.meta || {})
      : (source[channel] || {})
    const previews = channelCredentialPreviews(channel, channelSource)
    Object.assign(savedCredentialPreviews[channel], previews)
    // Disable input masks before replacing revealed values with protected
    // previews. Otherwise Quasar can strip the bullets from a masked phone
    // number and write the remaining visible digits back into the model.
    channelCredentialsVisible[channel] = false
    for (const key of Object.keys(revealedCredentialBaselines[channel])) {
      delete revealedCredentialBaselines[channel][key]
    }
    for (const field of channelCredentialFields[channel]) settings[channel][field] = previews[field] || ''
  }
  settings.whatsappPermission.command = whatsappPermissionCommandFromSettings(value)
  settings.whatsappPermission.requestText = source.whatsappPermission?.requestText
    || value.whatsappPermission?.requestText
    || DEFAULT_WHATSAPP_CONSENT_REQUEST_TEXT
  settings.telegramPermission.command = telegramPermissionCommandFromSettings(value)
}

function addUsefulLink() {
  if (settings.usefulLinks.length >= MAX_USEFUL_LINKS) {
    $q.notify({ type: 'info', message: `Você já cadastrou o limite de ${MAX_USEFUL_LINKS} links úteis.` })
    return
  }
  settings.usefulLinks.push(createUsefulLink())
}

function removeUsefulLink(index) {
  settings.usefulLinks.splice(index, 1)
}

function moveUsefulLink(index, direction) {
  const destination = index + direction
  if (destination < 0 || destination >= settings.usefulLinks.length) return
  const [link] = settings.usefulLinks.splice(index, 1)
  settings.usefulLinks.splice(destination, 0, link)
}

async function saveUsefulLinks() {
  const validationError = validateUsefulLinks(settings.usefulLinks)
  if (validationError) {
    $q.notify({ type: 'warning', message: validationError })
    return
  }

  savingUsefulLinks.value = true
  try {
    const usefulLinks = usefulLinksPayload(settings.usefulLinks)
    const result = await app.saveSettings({ usefulLinks })
    const source = result.configuration || result.settings || result
    settings.usefulLinks.splice(
      0,
      settings.usefulLinks.length,
      ...normalizeUsefulLinks(source.usefulLinks ?? usefulLinks),
    )
    $q.notify({
      type: 'positive',
      message: usefulLinks.length ? 'Links úteis atualizados no menu.' : 'Links úteis removidos do menu.',
    })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível salvar os links úteis.') })
  } finally {
    savingUsefulLinks.value = false
  }
}

function openChannel(channel) {
  if (app.isChannelEnabled(channel.key) || channel.key === 'whatsappCloud') {
    router.push(channel.to)
    return
  }
  $q.notify({
    type: 'info',
    message: `${channel.name} ainda não está configurado.`,
    caption: 'Preencha as credenciais logo abaixo para liberar o canal.',
  })
}

function credentialFieldIsMasked(channel, field) {
  return !channelCredentialsVisible[channel] && Boolean(savedCredentialPreviews[channel]?.[field])
}

function channelHasSavedCredentials(channel) {
  return Object.values(savedCredentialPreviews[channel] || {}).some(Boolean)
}

function channelConfigHeaderClass(channel) {
  const tone = channel === 'whatsappCloud' ? 'whatsapp' : channel
  const configured = app.isChannelEnabled(channel) ? ' channel-config-header--configured' : ''
  return `channel-config-header channel-config-header--${tone} text-weight-bold${configured}`
}

function hideChannelCredentials(channel) {
  channelCredentialsVisible[channel] = false
  for (const field of channelCredentialFields[channel] || []) {
    settings[channel][field] = savedCredentialPreviews[channel]?.[field] || ''
  }
  for (const key of Object.keys(revealedCredentialBaselines[channel])) {
    delete revealedCredentialBaselines[channel][key]
  }
}

async function toggleChannelCredentials(channel) {
  if (channelCredentialsVisible[channel]) {
    hideChannelCredentials(channel)
    return
  }
  revealingCredentials[channel] = true
  try {
    const result = unwrap(await http.get(`/settings/reveal/${channel}`)) || {}
    const values = result.values || {}
    const merged = mergeRevealedChannelValues(channel, values, settings[channel])
    Object.assign(revealedCredentialBaselines[channel], values)
    Object.assign(settings[channel], merged)
    channelCredentialsVisible[channel] = true
  } catch (error) {
    $q.notify({
      type: 'negative',
      message: errorMessage(error, `Não foi possível exibir as credenciais de ${channelNames[channel]}.`),
    })
  } finally {
    revealingCredentials[channel] = false
  }
}

async function saveWhatsappPermission() {
  const command = String(settings.whatsappPermission.command || '').trim()
  const requestText = String(settings.whatsappPermission.requestText || '').trim()
  if (!command) {
    $q.notify({ type: 'warning', message: 'Informe o texto que o contato deverá enviar para autorizar as notificações.' })
    return
  }
  if (!requestText) {
    $q.notify({ type: 'warning', message: 'Informe a mensagem que o atendimento enviará para solicitar a autorização.' })
    return
  }
  if (!requestText.includes('{command}')) {
    $q.notify({ type: 'warning', message: 'Inclua {command} na mensagem para acompanhar automaticamente o comando configurado.' })
    return
  }
  savingWhatsappPermission.value = true
  try {
    const result = await app.saveSettings({ whatsappPermission: { command, requestText } })
    settings.whatsappPermission.command = whatsappPermissionCommandFromSettings(result)
    const source = result.configuration || result.settings || result
    settings.whatsappPermission.requestText = source.whatsappPermission?.requestText || requestText
    $q.notify({ type: 'positive', message: 'Comando e mensagem de solicitação do WhatsApp salvos.' })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível salvar a autorização do WhatsApp.') })
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
  const messages = Object.fromEntries(
    Object.entries(settings.telegram.messages || {}).map(([key, value]) => [key, String(value || '').trim()]),
  )
  if (Object.values(messages).some((message) => !message)) {
    $q.notify({ type: 'warning', message: 'Preencha as quatro mensagens amigáveis do Telegram.' })
    return
  }
  savingTelegramPermission.value = true
  try {
    const result = await app.saveSettings({
      telegramPermission: { command },
      telegram: { messages },
    })
    settings.telegramPermission.command = telegramPermissionCommandFromSettings(result)
    const source = result.configuration || result.settings || result
    Object.assign(settings.telegram.messages, source.telegram?.messages || messages)
    $q.notify({ type: 'positive', message: 'Comando e mensagens do Telegram salvos.' })
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
  const payload = channelSettingsPayload(
    channel,
    settings[channel],
    channelCredentialsVisible[channel] ? revealedCredentialBaselines[channel] : {},
  )
  if (!payload) {
    if (!quiet) $q.notify({ type: 'info', message: `Nenhum novo valor de ${channelNames[channel]} para salvar.` })
    return false
  }
  savingChannel[channel] = true
  try {
    const result = await app.saveSettings(payload)
    applySettings(result)
    if (channel === 'telegram' && !telegramBot.value) await refreshTelegramIdentity()
    if (!quiet) {
      const telegramWebhook = channel === 'telegram'
        ? (result.configuration || result.settings || result)?.telegram?.webhook
        : null
      $q.notify({
        type: telegramWebhook && telegramWebhook.refreshed === false ? 'warning' : 'positive',
        message: `${channelNames[channel]} salvo sem alterar os outros canais.`,
        caption: channel === 'telegram'
          ? (telegramWebhook?.refreshed
              ? 'Webhook configurado automaticamente.'
              : 'Para registrar o webhook, configure PUBLIC_APP_URL com o domínio HTTPS público da aplicação.')
          : undefined,
      })
    }
    return true
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, `Não foi possível salvar ${channelNames[channel]}.`) })
    return false
  } finally {
    savingChannel[channel] = false
  }
}

function addRealtimeLog(log) {
  if (!log || logPage.value !== 1) return
  logItems.value = [log, ...logItems.value].slice(0, 12)
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
})

onBeforeUnmount(() => {
  const socket = getSocket()
  socket.off('log', addRealtimeLog)
  socket.off('log:new', addRealtimeLog)
  socket.off('logs:new', addRealtimeLog)
  socket.off('log:created', addRealtimeLog)
  socket.off('channels:status')
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
      <div v-if="$route.query.unavailable === 'invites'">
        <strong>Convites protegidos</strong>
        <span>Configure o WhatsApp Cloud e o Gmail antes de acessar os convites.</span>
      </div>
      <div v-else><strong>Canal protegido</strong><span>Configure e conecte o canal antes de acessar suas funções.</span></div>
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

    <section class="page-grid channel-grid q-mb-lg" aria-label="Atalhos dos canais">
      <button
        v-for="channel in channels"
        :key="channel.key"
        type="button"
        class="channel-card glass-card"
        :class="[
          `channel-card--${channel.tone}`,
          { 'channel-card--configured': app.isChannelEnabled(channel.key) },
        ]"
        :aria-label="`Abrir ${channel.name}`"
        @click="openChannel(channel)"
      >
        <div class="channel-icon"><q-icon :name="channel.icon" size="24px" /></div>
        <div class="channel-copy">
          <strong>{{ channel.name }}</strong>
          <span>{{ channel.description }}</span>
        </div>
        <StatusBadge :value="app.isChannelEnabled(channel.key)" />
        <q-icon class="channel-arrow" name="arrow_forward" />
      </button>
    </section>

    <div class="settings-priority-stack">
      <q-card flat class="glass-card section-card settings-collapse-card useful-links-card q-mb-lg" data-testid="useful-links-panel">
        <q-expansion-item
          icon="mdi-link-variant"
          label="Links úteis"
          :caption="`Cadastre até ${MAX_USEFUL_LINKS} atalhos para aparecerem abaixo de Ajuda no menu lateral.`"
          header-class="settings-collapse-header text-weight-bold"
        >
          <div class="settings-collapse-body settings-collapse-body--links">
            <div class="toolbar-row useful-links-card__header">
              <div class="text-overline useful-links-eyebrow">Navegação personalizada</div>
              <q-btn
                outline
                color="primary"
                no-caps
                icon="add_link"
                label="Adicionar link"
                :disable="settings.usefulLinks.length >= MAX_USEFUL_LINKS"
                @click="addUsefulLink"
              >
                <q-tooltip v-if="settings.usefulLinks.length >= MAX_USEFUL_LINKS">
                  Limite de {{ MAX_USEFUL_LINKS }} links atingido
                </q-tooltip>
              </q-btn>
            </div>

            <div v-if="settings.usefulLinks.length" class="useful-link-list">
              <article
                v-for="(link, index) in settings.usefulLinks"
                :key="`useful-link-${index}`"
                class="useful-link-editor"
              >
                <div class="useful-link-editor__order" aria-hidden="true">{{ index + 1 }}</div>
                <div class="useful-link-editor__fields">
                  <q-input
                    v-model="link.title"
                    outlined
                    label="Título"
                    maxlength="80"
                    counter
                    :aria-label="`Título do link útil ${index + 1}`"
                  />
                  <q-input
                    v-model="link.caption"
                    outlined
                    label="Descrição (opcional)"
                    maxlength="240"
                    counter
                    :aria-label="`Descrição do link útil ${index + 1}`"
                  />
                  <q-select
                    v-model="link.iconName"
                    outlined
                    emit-value
                    map-options
                    use-input
                    fill-input
                    hide-selected
                    input-debounce="0"
                    new-value-mode="add-unique"
                    :options="USEFUL_LINK_ICON_OPTIONS"
                    label="Nome do ícone MDI"
                    hint="Escolha uma opção ou informe, por exemplo, mdi-web."
                    :aria-label="`Ícone do link útil ${index + 1}`"
                  >
                    <template #prepend><q-icon :name="link.iconName || 'mdi-link-variant'" /></template>
                    <template #option="scope">
                      <q-item v-bind="scope.itemProps">
                        <q-item-section avatar><q-icon :name="scope.opt.value" /></q-item-section>
                        <q-item-section>
                          <q-item-label>{{ scope.opt.label }}</q-item-label>
                          <q-item-label caption>{{ scope.opt.value }}</q-item-label>
                        </q-item-section>
                      </q-item>
                    </template>
                  </q-select>
                  <q-input
                    v-model="link.url"
                    outlined
                    type="url"
                    label="URL"
                    placeholder="https://exemplo.com/guia"
                    hint="Somente endereços HTTP ou HTTPS são aceitos."
                    :aria-label="`URL do link útil ${index + 1}`"
                  >
                    <template #prepend><q-icon name="mdi-open-in-new" /></template>
                  </q-input>
                </div>
                <div class="useful-link-editor__actions">
                  <q-btn
                    flat
                    round
                    dense
                    icon="keyboard_arrow_up"
                    :disable="index === 0"
                    :aria-label="`Mover ${link.title || `link ${index + 1}`} para cima`"
                    @click="moveUsefulLink(index, -1)"
                  >
                    <q-tooltip>Mover para cima</q-tooltip>
                  </q-btn>
                  <q-btn
                    flat
                    round
                    dense
                    icon="keyboard_arrow_down"
                    :disable="index === settings.usefulLinks.length - 1"
                    :aria-label="`Mover ${link.title || `link ${index + 1}`} para baixo`"
                    @click="moveUsefulLink(index, 1)"
                  >
                    <q-tooltip>Mover para baixo</q-tooltip>
                  </q-btn>
                  <q-btn
                    flat
                    round
                    dense
                    color="negative"
                    icon="delete_outline"
                    :aria-label="`Remover ${link.title || `link ${index + 1}`}`"
                    @click="removeUsefulLink(index)"
                  >
                    <q-tooltip>Remover link</q-tooltip>
                  </q-btn>
                </div>
              </article>
            </div>
            <div v-else class="useful-links-empty">
              <q-icon name="mdi-link-plus" />
              <div>
                <strong>Nenhum atalho personalizado</strong>
                <span>Ajuda continuará disponível; seus links aparecerão logo abaixo dela.</span>
              </div>
            </div>

            <div class="useful-links-card__footer">
              <span>{{ settings.usefulLinks.length }}/{{ MAX_USEFUL_LINKS }} links cadastrados</span>
              <q-btn
                unelevated
                color="primary"
                no-caps
                icon="save"
                label="Salvar links úteis"
                :loading="savingUsefulLinks"
                @click="saveUsefulLinks"
              />
            </div>
          </div>
        </q-expansion-item>
      </q-card>

    <section class="credentials-panel q-mb-lg" data-testid="credentials-panel">
      <q-card flat class="glass-card section-card">
        <div class="toolbar-row credentials-panel__header">
          <div class="settings-panel-title">
            <div class="settings-panel-title__icon"><q-icon name="settings_suggest" /></div>
            <div class="row items-center q-gutter-xs">
              <h2 class="section-title">Credenciais e canais</h2>
              <ContextHelp
                title="Configurações independentes por canal"
                tooltip="Entenda como as credenciais são salvas"
                text="Salve cada provedor separadamente. Campos vazios mantêm os valores existentes e um canal incompleto não bloqueia os demais."
              />
            </div>
          </div>
        </div>

        <q-expansion-item
          icon="bi-telegram"
          label="Telegram"
          :caption="app.isChannelEnabled('telegram') ? 'Configurado e disponível' : undefined"
          :header-class="channelConfigHeaderClass('telegram')"
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
            <div class="full-span credential-visibility" aria-live="polite">
              <div>
                <q-icon :name="channelCredentialsVisible.telegram ? 'visibility' : 'visibility_off'" />
                <span>{{ channelCredentialsVisible.telegram ? 'Credenciais visíveis nesta sessão' : 'Valores salvos protegidos por máscara' }}</span>
              </div>
              <q-btn
                flat
                round
                color="primary"
                :icon="channelCredentialsVisible.telegram ? 'edit_off' : 'edit'"
                :loading="revealingCredentials.telegram"
                :disable="!channelHasSavedCredentials('telegram')"
                :aria-label="channelCredentialsVisible.telegram ? 'Ocultar todas as credenciais do Telegram' : 'Exibir todas as credenciais do Telegram'"
                @click="toggleChannelCredentials('telegram')"
              >
                <q-tooltip>{{ channelCredentialsVisible.telegram ? 'Ocultar todas as credenciais' : 'Exibir todas as credenciais' }}</q-tooltip>
              </q-btn>
            </div>
            <q-input
              v-model="settings.telegram.botToken"
              outlined
              :type="channelCredentialsVisible.telegram ? 'text' : 'password'"
              :readonly="credentialFieldIsMasked('telegram', 'botToken')"
              label="Token do Bot API"
              autocomplete="off"
              hint="O token sozinho já permite testar envios manuais"
            />
            <q-input
              :model-value="telegramCallbackUrl"
              class="full-span"
              outlined
              readonly
              label="URL de callback do webhook"
            >
              <template #append>
                <ContextHelp
                  title="Callback automático do Telegram"
                  tooltip="Entenda a configuração automática"
                  :text="[
                    'Ao salvar um token de bot válido, a API gera um segredo interno e registra este callback automaticamente no Telegram.',
                    'Em produção, PUBLIC_APP_URL deve apontar para o domínio HTTPS público exibido aqui. O segredo nunca é mostrado ou copiado pelo painel.',
                  ]"
                />
                <q-btn flat round dense color="primary" icon="content_copy" aria-label="Copiar URL de callback do Telegram" @click="copyTelegramCallbackUrl" />
              </template>
            </q-input>
            <div class="full-span channel-actions">
              <q-btn outline color="primary" no-caps icon="save" label="Salvar Telegram" :loading="savingChannel.telegram" @click="saveChannel('telegram')" />
              <q-btn flat color="primary" no-caps icon="send" label="Teste manual" to="/telegram" :disable="!app.isChannelEnabled('telegram')" />
            </div>
            <div class="full-span channel-hint"><q-icon name="verified_user" /> O webhook é registrado automaticamente; o segredo permanece protegido no servidor.</div>
          </div>
        </q-expansion-item>
        <q-separator />
        <q-expansion-item
          icon="mdi-whatsapp"
          label="WhatsApp Cloud API"
          :caption="app.isChannelEnabled('whatsappCloud') ? 'Configurado e disponível' : undefined"
          :header-class="channelConfigHeaderClass('whatsappCloud')"
        >
          <div class="form-grid q-pa-md">
            <div class="full-span credential-visibility" aria-live="polite">
              <div>
                <q-icon :name="channelCredentialsVisible.whatsappCloud ? 'visibility' : 'visibility_off'" />
                <span>{{ channelCredentialsVisible.whatsappCloud ? 'Credenciais visíveis nesta sessão' : 'Valores salvos protegidos por máscara' }}</span>
              </div>
              <q-btn
                flat
                round
                color="primary"
                :icon="channelCredentialsVisible.whatsappCloud ? 'edit_off' : 'edit'"
                :loading="revealingCredentials.whatsappCloud"
                :disable="!channelHasSavedCredentials('whatsappCloud')"
                :aria-label="channelCredentialsVisible.whatsappCloud ? 'Ocultar todas as credenciais do WhatsApp Cloud' : 'Exibir todas as credenciais do WhatsApp Cloud'"
                @click="toggleChannelCredentials('whatsappCloud')"
              >
                <q-tooltip>{{ channelCredentialsVisible.whatsappCloud ? 'Ocultar todas as credenciais' : 'Exibir todas as credenciais' }}</q-tooltip>
              </q-btn>
            </div>
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
              :readonly="credentialFieldIsMasked('whatsappCloud', 'phoneNumberId')"
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
              :readonly="credentialFieldIsMasked('whatsappCloud', 'displayPhoneNumber')"
              label="Número público do WhatsApp (com DDI)"
              :mask="credentialFieldIsMasked('whatsappCloud', 'displayPhoneNumber') ? undefined : '+###############'"
              unmasked-value
              placeholder="+55 (11) 93123-4567"
            >
              <template #append>
                <ContextHelp
                  title="Número público do WhatsApp"
                  tooltip="Entenda onde este número é usado"
                  text="Usado nos links wa.me dos convites. Salvo separado do Phone Number ID."
                />
              </template>
            </q-input>
            <q-input v-model="settings.whatsappCloud.businessAccountId" outlined :readonly="credentialFieldIsMasked('whatsappCloud', 'businessAccountId')" label="Business Account ID" />
            <q-input v-model.trim="settings.whatsappCloud.apiVersion" outlined :readonly="credentialFieldIsMasked('whatsappCloud', 'apiVersion')" label="Versão da Graph API">
              <template #append>
                <ContextHelp
                  title="Versão da Graph API"
                  tooltip="Entenda a versão usada nos exemplos"
                  text="Use v25.0 para reproduzir os exemplos deste ambiente de testes."
                />
              </template>
            </q-input>
            <q-input v-model="settings.whatsappCloud.accessToken" outlined :type="channelCredentialsVisible.whatsappCloud ? 'text' : 'password'" :readonly="credentialFieldIsMasked('whatsappCloud', 'accessToken')" label="Access token" autocomplete="off" />
            <q-input v-model="settings.whatsappCloud.verifyToken" outlined :type="channelCredentialsVisible.whatsappCloud ? 'text' : 'password'" :readonly="credentialFieldIsMasked('whatsappCloud', 'verifyToken')" label="Webhook verify token" autocomplete="off" />
            <q-input v-model="settings.whatsappCloud.appSecret" class="full-span" outlined :type="channelCredentialsVisible.whatsappCloud ? 'text' : 'password'" :readonly="credentialFieldIsMasked('whatsappCloud', 'appSecret')" label="App secret (validação X-Hub-Signature-256)" autocomplete="off" />
            <div class="full-span channel-actions">
              <q-btn outline color="primary" no-caps icon="save" label="Salvar WhatsApp Cloud" :loading="savingChannel.whatsappCloud" @click="saveChannel('whatsappCloud')" />
              <q-btn flat color="primary" no-caps icon="send" label="Teste manual" to="/whatsapp-cloud" :disable="!app.isChannelEnabled('whatsappCloud')" />
            </div>
          </div>
        </q-expansion-item>
        <q-separator />
        <q-expansion-item
          icon="mdi-gmail"
          label="Gmail"
          :caption="app.isChannelEnabled('email') ? 'Configurado e disponível' : undefined"
          :header-class="channelConfigHeaderClass('email')"
        >
          <div class="form-grid q-pa-md">
            <div class="full-span credential-visibility" aria-live="polite">
              <div>
                <q-icon :name="channelCredentialsVisible.email ? 'visibility' : 'visibility_off'" />
                <span>{{ channelCredentialsVisible.email ? 'Credenciais visíveis nesta sessão' : 'Valores salvos protegidos por máscara' }}</span>
              </div>
              <q-btn
                flat
                round
                color="primary"
                :icon="channelCredentialsVisible.email ? 'edit_off' : 'edit'"
                :loading="revealingCredentials.email"
                :disable="!channelHasSavedCredentials('email')"
                :aria-label="channelCredentialsVisible.email ? 'Ocultar todas as credenciais do Gmail' : 'Exibir todas as credenciais do Gmail'"
                @click="toggleChannelCredentials('email')"
              >
                <q-tooltip>{{ channelCredentialsVisible.email ? 'Ocultar todas as credenciais' : 'Exibir todas as credenciais' }}</q-tooltip>
              </q-btn>
            </div>
            <q-input v-model="settings.email.user" outlined type="email" :readonly="credentialFieldIsMasked('email', 'user')" label="Conta Gmail" />
            <q-input v-model="settings.email.from" outlined type="email" :readonly="credentialFieldIsMasked('email', 'from')" label="Email do remetente (GMAIL_FROM)" />
            <q-input v-model="settings.email.fromName" outlined :readonly="credentialFieldIsMasked('email', 'fromName')" label="Nome do remetente (opcional)" />
            <q-input v-model="settings.email.appPassword" class="full-span" outlined :type="channelCredentialsVisible.email ? 'text' : 'password'" :readonly="credentialFieldIsMasked('email', 'appPassword')" label="Senha de app" autocomplete="off" />
            <div class="full-span channel-actions">
              <q-btn outline color="primary" no-caps icon="save" label="Salvar Gmail" :loading="savingChannel.email" @click="saveChannel('email')" />
              <q-btn flat color="primary" no-caps icon="send" label="Teste manual" to="/email" :disable="!app.isChannelEnabled('email')" />
            </div>
          </div>
        </q-expansion-item>
      </q-card>

    </section>
    </div>

    <q-card flat class="glass-card section-card settings-collapse-card q-mb-lg" data-testid="telegram-onboarding-panel">
      <q-expansion-item
        icon="bi-telegram"
        label="Onboarding automático do Telegram"
        caption="Configure o comando seguro que autoriza o contato e abre o menu do bot"
        header-class="settings-collapse-header text-weight-bold"
      >
        <div class="settings-collapse-body whatsapp-permission-card whatsapp-permission-card--body">
          <div class="whatsapp-permission-card__copy">
            <div class="row items-center q-gutter-xs">
              <strong>Configuração do comando</strong>
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
        </div>
      </q-expansion-item>
    </q-card>

    <q-card flat class="glass-card section-card settings-collapse-card telegram-messages-card q-mb-lg" data-testid="telegram-messages-panel">
      <q-expansion-item
        icon="bi-telegram"
        label="Mensagens amigáveis do Telegram"
        caption="Personalize o onboarding sem alterar a lógica segura do bot"
        header-class="settings-collapse-header text-weight-bold"
      >
        <div class="settings-collapse-body telegram-messages-card__body">
          <div class="telegram-messages-card__intro">
            <span>Marcadores disponíveis:</span>
            <q-chip dense outline color="info">{name}</q-chip>
            <q-chip dense outline color="info">{command}</q-chip>
            <q-chip dense outline color="info">{status}</q-chip>
            <q-chip dense outline color="info">{invites}</q-chip>
            <ContextHelp
              title="Textos dinâmicos do Telegram"
              tooltip="Entenda os marcadores"
              :text="[
                '{name} mostra o nome reconhecido pelo Telegram.',
                '{command} acompanha o comando configurado.',
                '{status} informa se o cadastro foi encontrado ou criado.',
                '{invites} lista os convites associados ao contato.',
              ]"
            />
          </div>
          <div class="telegram-messages-card__grid">
            <q-input
              v-model="settings.telegram.messages.onboarding"
              outlined
              type="textarea"
              autogrow
              label="Boas-vindas e menu"
              maxlength="3000"
              counter
              hint="Aceita {name}, {command}, {status} e {invites}."
            />
            <q-input
              v-model="settings.telegram.messages.phoneShare"
              outlined
              type="textarea"
              autogrow
              label="Solicitação de telefone"
              maxlength="3000"
              counter
              hint="Explica a vinculação segura entre Telegram e WhatsApp."
            />
            <q-input
              v-model="settings.telegram.messages.profile"
              outlined
              type="textarea"
              autogrow
              label="Acesso ao Meu perfil"
              maxlength="3000"
              counter
              hint="Acompanha o botão pessoal, temporário e de uso único."
            />
            <q-input
              v-model="settings.telegram.messages.help"
              outlined
              type="textarea"
              autogrow
              label="Ajuda do bot"
              maxlength="3000"
              counter
              hint="Explique telefone, perfil e permissões em linguagem simples."
            />
          </div>
          <div class="telegram-messages-card__actions">
            <q-btn
              color="info"
              unelevated
              no-caps
              icon="save"
              label="Salvar mensagens do Telegram"
              :loading="savingTelegramPermission"
              @click="saveTelegramPermission"
            />
          </div>
        </div>
      </q-expansion-item>
    </q-card>

    <q-card flat class="glass-card section-card settings-collapse-card q-mb-lg" data-testid="whatsapp-auth-panel">
      <q-expansion-item
        icon="mdi-whatsapp"
        label="Autorização automática de contatos do WhatsApp"
        caption="Defina o comando e a mensagem usados para solicitar consentimento"
        header-class="settings-collapse-header text-weight-bold"
      >
        <div class="settings-collapse-body whatsapp-permission-card whatsapp-permission-card--body whatsapp-permission-card--cloud">
          <div class="whatsapp-permission-card__copy">
            <div class="row items-center q-gutter-xs">
              <strong>Configuração da autorização</strong>
              <ContextHelp
                title="Quando um contato do WhatsApp é cadastrado"
                tooltip="Entenda a autorização automática"
                :text="[
                  'Mensagens recebidas pelo webhook oficial cadastram ou atualizam o contato e abrem a janela móvel de atendimento por 24 horas.',
                  'Quando o contato envia este comando exato, a permissão de notificações pela API oficial é concedida e auditada.',
                  'O botão Solicitar autorização, na aba Conversas do WhatsApp Cloud, usa o texto configurado abaixo e só funciona enquanto a janela de atendimento estiver aberta.',
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
            class="whatsapp-permission-card__input whatsapp-permission-card__input--command"
            @keydown.enter.prevent="saveWhatsappPermission"
          />
          <q-btn
            color="primary"
            unelevated
            no-caps
            icon="save"
            label="Salvar autorização"
            :loading="savingWhatsappPermission"
            @click="saveWhatsappPermission"
          />
          <q-input
            v-model="settings.whatsappPermission.requestText"
            outlined
            type="textarea"
            autogrow
            label="Mensagem para solicitar autorização no chat"
            hint="Use {command}; o sistema substituirá pelo comando configurado acima."
            maxlength="1000"
            counter
            class="whatsapp-permission-card__input whatsapp-permission-card__input--message"
          />
        </div>
      </q-expansion-item>
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.channel-card {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
  border: 1px solid transparent;
  padding: 16px;
  color: #173d37;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
}

.channel-card:hover {
  transform: translateY(-2px);
}

.channel-card:focus-visible {
  outline: 3px solid rgba(53, 188, 164, 0.3);
  outline-offset: 2px;
}

.channel-card--whatsapp {
  background: linear-gradient(135deg, rgba(214, 250, 237, 0.95), rgba(245, 255, 251, 0.78));
  box-shadow: 0 12px 30px rgba(18, 140, 106, 0.08);
}

.channel-card--telegram {
  background: linear-gradient(135deg, rgba(220, 243, 255, 0.95), rgba(247, 252, 255, 0.82));
  box-shadow: 0 12px 30px rgba(36, 139, 214, 0.08);
}

.channel-card--gmail {
  background: linear-gradient(135deg, rgba(255, 231, 230, 0.92), rgba(255, 250, 249, 0.82));
  box-shadow: 0 12px 30px rgba(217, 81, 78, 0.07);
}

.channel-card--configured {
  border-color: rgba(21, 157, 130, 0.28);
}

.channel-card--whatsapp.channel-card--configured {
  box-shadow: inset 4px 0 0 #128c6a, 0 12px 30px rgba(18, 140, 106, 0.1);
}

.channel-card--telegram.channel-card--configured {
  border-color: rgba(36, 139, 214, 0.25);
  box-shadow: inset 4px 0 0 #248bd6, 0 12px 30px rgba(36, 139, 214, 0.1);
}

.channel-card--gmail.channel-card--configured {
  border-color: rgba(217, 81, 78, 0.22);
  box-shadow: inset 4px 0 0 #d9514e, 0 12px 30px rgba(217, 81, 78, 0.09);
}

:deep(.channel-config-header) {
  border-left: 4px solid transparent;
  transition: background-color 160ms ease, color 160ms ease, box-shadow 160ms ease;
}

:deep(.channel-config-header .q-item__section--avatar) {
  min-width: 58px;
}

:deep(.channel-config-header .q-item__section--avatar > .q-icon) {
  display: grid;
  width: 40px;
  height: 40px;
  border-radius: 13px;
  font-size: 22px;
  place-items: center;
}

:deep(.channel-config-header--telegram) {
  background: linear-gradient(105deg, rgba(91, 184, 245, 0.15), rgba(36, 139, 214, 0.045));
  color: #245b7d;
}

:deep(.channel-config-header--telegram .q-item__section--avatar > .q-icon) {
  background: rgba(36, 139, 214, 0.13);
  color: #248bd6;
}

:deep(.channel-config-header--whatsapp) {
  background: linear-gradient(105deg, rgba(71, 211, 162, 0.15), rgba(18, 140, 106, 0.045));
  color: #116b59;
}

:deep(.channel-config-header--whatsapp .q-item__section--avatar > .q-icon) {
  background: rgba(18, 140, 106, 0.13);
  color: #128c6a;
}

:deep(.channel-config-header--gmail) {
  background: linear-gradient(105deg, rgba(242, 130, 126, 0.14), rgba(217, 81, 78, 0.04));
  color: #91403e;
}

:deep(.channel-config-header--gmail .q-item__section--avatar > .q-icon) {
  background: rgba(217, 81, 78, 0.12);
  color: #d9514e;
}

:deep(.channel-config-header--telegram.channel-config-header--configured) {
  box-shadow: inset 4px 0 0 #248bd6;
}

:deep(.channel-config-header--whatsapp.channel-config-header--configured) {
  box-shadow: inset 4px 0 0 #128c6a;
}

:deep(.channel-config-header--gmail.channel-config-header--configured) {
  box-shadow: inset 4px 0 0 #d9514e;
}

:deep(.channel-config-header .q-item__label--caption) {
  color: currentColor;
  opacity: 0.76;
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

.channel-card--whatsapp .channel-icon {
  background: rgba(18, 140, 106, 0.13);
  color: #128c6a;
}

.channel-card--telegram .channel-icon {
  background: rgba(36, 139, 214, 0.13);
  color: #248bd6;
}

.channel-card--gmail .channel-icon {
  background: rgba(217, 81, 78, 0.12);
  color: #d9514e;
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

.channel-arrow {
  flex: none;
  color: currentColor;
  opacity: 0.58;
}

.useful-links-card {
  overflow: hidden;
}

.settings-priority-stack {
  display: flex;
  flex-direction: column;
}

.credentials-panel {
  order: -1;
}

.credentials-panel__header {
  padding-bottom: 18px;
}

.settings-panel-title {
  display: flex;
  align-items: center;
  gap: 14px;
}

.settings-panel-title__icon,
:deep(.settings-collapse-header .q-item__section--avatar > .q-icon) {
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

.settings-collapse-card {
  overflow: hidden;
  padding: 0;
}

:deep(.settings-collapse-header) {
  min-height: 84px;
  padding: 16px 20px;
}

:deep(.settings-collapse-header .q-item__section--avatar) {
  min-width: 66px;
}

:deep(.settings-collapse-header .q-item__label) {
  color: #183e37;
  font-size: 1rem;
}

:deep(.settings-collapse-header .q-item__label--caption) {
  margin-top: 3px;
  color: #607773;
  font-size: 0.76rem;
  font-weight: 500;
}

.settings-collapse-body {
  padding: 8px 20px 20px;
  border-top: 1px solid rgba(3, 21, 21, 0.06);
}

.settings-collapse-body--links {
  padding-inline: 0;
  padding-bottom: 0;
}

.useful-links-card__header {
  align-items: flex-start;
  padding: 12px 20px 18px;
}

.useful-links-eyebrow {
  margin-bottom: 4px;
  color: #16866f;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.useful-link-list {
  display: grid;
  gap: 12px;
  padding: 0 20px 18px;
}

.useful-link-editor {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 14px;
  padding: 16px;
  border: 1px solid rgba(19, 125, 108, 0.13);
  border-radius: 18px;
  background: rgba(247, 255, 252, 0.7);
}

.useful-link-editor__order {
  display: grid;
  width: 34px;
  height: 34px;
  border-radius: 11px;
  background: rgba(53, 188, 164, 0.14);
  color: #137d6c;
  font-size: 0.78rem;
  font-weight: 800;
  place-items: center;
}

.useful-link-editor__fields {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.useful-link-editor__actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.useful-links-empty {
  display: flex;
  align-items: center;
  gap: 13px;
  margin: 0 20px 18px;
  padding: 20px;
  border: 1px dashed rgba(19, 125, 108, 0.2);
  border-radius: 17px;
  background: rgba(247, 255, 252, 0.46);
  color: #607773;
}

.useful-links-empty > .q-icon {
  color: #35bca4;
  font-size: 30px;
}

.useful-links-empty strong,
.useful-links-empty span {
  display: block;
}

.useful-links-empty strong {
  color: #294641;
}

.useful-links-empty span {
  margin-top: 2px;
  font-size: 0.76rem;
}

.useful-links-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px;
  border-top: 1px solid rgba(3, 21, 21, 0.07);
  color: #637875;
  font-size: 0.76rem;
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

.credential-visibility {
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 8px 6px 13px;
  border: 1px solid rgba(19, 125, 108, 0.15);
  border-radius: 13px;
  background: rgba(235, 250, 247, 0.62);
  color: #426b64;
  font-size: 0.78rem;
}

.credential-visibility > div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.credential-visibility > div > .q-icon {
  color: #16866f;
  font-size: 18px;
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

.whatsapp-permission-card {
  display: grid;
  grid-template-columns: minmax(240px, 0.85fr) minmax(260px, 1fr) auto;
  align-items: center;
  gap: 18px;
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

.whatsapp-permission-card--cloud {
  align-items: start;
}

.whatsapp-permission-card--cloud .whatsapp-permission-card__input--message {
  grid-column: 1 / 4;
}

.telegram-messages-card {
  overflow: hidden;
}

.telegram-messages-card__body {
  padding: 8px 16px 16px;
}

.telegram-messages-card__intro {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 16px;
  color: #52706b;
  font-size: 0.78rem;
}

.telegram-messages-card__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.telegram-messages-card__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
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

  .useful-link-editor__fields {
    grid-template-columns: 1fr;
  }

  .whatsapp-permission-card {
    grid-template-columns: minmax(0, 1fr) minmax(260px, 0.9fr);
  }

  .whatsapp-permission-card > .q-btn {
    grid-column: 2;
    justify-self: end;
  }

  .whatsapp-permission-card--cloud .whatsapp-permission-card__input--message {
    grid-column: 1 / 3;
  }
}

@media (max-width: 650px) {
  .channel-grid {
    grid-template-columns: 1fr;
  }

  :deep(.settings-collapse-header) {
    min-height: 74px;
    padding: 12px;
  }

  :deep(.settings-collapse-header .q-item__section--avatar) {
    min-width: 58px;
  }

  .settings-panel-title__icon,
  :deep(.settings-collapse-header .q-item__section--avatar > .q-icon) {
    width: 46px;
    height: 46px;
    flex-basis: 46px;
    border-radius: 15px;
    font-size: 24px;
  }

  .settings-collapse-body {
    padding: 8px 12px 16px;
  }

  .settings-collapse-body--links {
    padding-inline: 0;
    padding-bottom: 0;
  }

  .credentials-panel__header {
    padding: 12px 12px 16px;
  }

  .useful-links-card__header,
  .useful-links-card__footer {
    align-items: stretch;
    flex-direction: column;
  }

  .useful-links-card__header > .q-btn,
  .useful-links-card__footer > .q-btn {
    width: 100%;
  }

  .useful-link-list {
    padding-inline: 12px;
  }

  .useful-link-editor {
    grid-template-columns: 1fr;
    padding: 13px;
  }

  .useful-link-editor__actions {
    flex-direction: row;
    justify-content: flex-end;
  }

  .useful-links-empty {
    align-items: flex-start;
    margin-inline: 12px;
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

  .whatsapp-permission-card {
    grid-template-columns: 1fr;
  }

  .whatsapp-permission-card > .q-btn {
    grid-column: auto;
    justify-self: stretch;
  }

  .whatsapp-permission-card--cloud .whatsapp-permission-card__input--message {
    grid-row: auto;
    grid-column: auto;
  }

  .telegram-messages-card__grid {
    grid-template-columns: 1fr;
  }

  .telegram-messages-card__actions > .q-btn {
    width: 100%;
  }
}
</style>
