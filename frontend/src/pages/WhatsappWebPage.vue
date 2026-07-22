<script>
function messageTime(value = {}) {
  const raw = value.sentAt || value.createdAt || value.timestamp
  if (typeof raw === 'number' || /^\d+$/.test(String(raw || ''))) {
    const numeric = Number(raw)
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric
  }
  const parsed = new Date(raw || 0).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function historyKey(value = {}) {
  const providerId = value.providerMessageId || value.provider_message_id || value.id?._serialized
    || (typeof value.id === 'string' && !/^[a-f0-9]{24}$/i.test(value.id) ? value.id : null)
  if (providerId) return `provider:${providerId}`
  const direction = value.direction || (value.fromMe ? 'outbound' : 'inbound')
  return `fallback:${direction}:${messageTime(value)}:${String(value.body || value.text || value.message || '')}`
}

function normalizeWhatsappWebMessage(value = {}) {
  const timestamp = messageTime(value)
  return {
    ...value,
    providerMessageId: value.providerMessageId || value.id || null,
    direction: value.direction || (value.fromMe ? 'outbound' : 'inbound'),
    sentAt: value.sentAt || (timestamp ? new Date(timestamp).toISOString() : null),
  }
}

export function mergeWhatsappWebHistory(localMessages = []) {
  const merged = new Map()
  for (const raw of localMessages) {
    const message = normalizeWhatsappWebMessage(raw)
    const key = historyKey(message)
    const previous = merged.get(key)
    merged.set(key, previous ? { ...message, ...previous } : message)
  }
  return [...merged.values()].sort((left, right) => messageTime(left) - messageTime(right))
}

export function canReplyToWhatsappWebConversation(conversation, identityOrContact) {
  if (!conversation || conversation.isGroup) return false
  const identity = identityOrContact?.channel
    ? identityOrContact
    : (Array.isArray(identityOrContact?.channels) ? identityOrContact.channels : [])
        .find((item) => String(item?.channel || '').replaceAll('-', '_') === 'whatsapp_web')
  return Boolean(identity?.authorized && identity?.consentStatus === 'granted')
}

export function whatsappWebConversationId(conversation) {
  if (!conversation) return ''
  return String(conversation.chatId || conversation.id || conversation._id || conversation.wid || '')
}

export function upsertWhatsappWebConversation(current = [], conversation = {}) {
  const channel = String(conversation.channel || '').replaceAll('-', '_')
  const id = whatsappWebConversationId(conversation)
  if (channel !== 'whatsapp_web' || !id) return current
  return [conversation, ...current.filter((item) => whatsappWebConversationId(item) !== id)]
}
</script>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useQuasar } from 'quasar'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import ContactDialog from '../components/ContactDialog.vue'
import { asList, errorMessage, fetchAll, http, unwrap } from '../services/http.js'
import { connectSocket, getSocket } from '../services/socket.js'
import { useAppStore } from '../stores/app.js'
import {
  DEFAULT_WHATSAPP_PERMISSION_COMMAND,
  normalizeWhatsappWebStatus,
  whatsappPermissionCommandFromSettings,
} from '../services/whatsapp-web.js'
import {
  contactIdentity,
  identityIdentifiers,
  identityRegistrationSource,
} from '../services/contact-identities.js'

const $q = useQuasar()
const app = useAppStore()
const loading = ref(false)
const loadingMessages = ref(false)
const liveConnected = ref(false)
const historyNote = ref('')
const sending = ref(false)
const chats = ref([])
const messages = ref([])
const selected = ref(null)
const search = ref('')
const message = ref('')
const contactDialog = ref(false)
const contactForDialog = ref(null)
const selectedContactRecord = ref(null)
const messagesPanel = ref(null)
const sessionStatus = ref(normalizeWhatsappWebStatus(app.channelStatus('whatsappWeb')))
const permissionCommand = ref(whatsappPermissionCommandFromSettings(app.settings) || DEFAULT_WHATSAPP_PERMISSION_COMMAND)
let realtimeRefreshTimer = null
let realtimeRefreshSelected = false
let dataRequestSequence = 0

const monitorReady = computed(() => Boolean(sessionStatus.value.ready))
const selectedWebIdentity = computed(() => contactIdentity(selectedContactRecord.value || {}, 'whatsapp_web') || {
  channel: 'whatsapp_web',
  address: selected.value?.externalId || selected.value?.chatId || '',
  source: 'conversation',
})
const selectedIdentifiers = computed(() => identityIdentifiers(selectedWebIdentity.value))
const selectedRegistration = computed(() => identityRegistrationSource(selectedWebIdentity.value))
const selectedReplyAllowed = computed(() => canReplyToWhatsappWebConversation(selected.value, selectedWebIdentity.value))

const filteredChats = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return chats.value.filter((chat) => !needle || [chat.displayName, chat.externalId, chat.name, chat.pushName, chat.phone, chat.id, chat.chatId]
    .some((value) => String(value || '').toLowerCase().includes(needle)))
})

function chatId(chat) {
  return whatsappWebConversationId(chat)
}

function chatName(chat) {
  return chat?.displayName || chat?.name || chat?.pushName || chat?.contact?.name || chat?.phone || 'Conversa sem nome'
}

function initials(value) {
  return String(value || '?').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function formatTime(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

async function loadData({ background = false, refreshSelected = false } = {}) {
  if (!monitorReady.value) {
    dataRequestSequence += 1
    chats.value = []
    messages.value = []
    selected.value = null
    selectedContactRecord.value = null
    return
  }
  const requestSequence = ++dataRequestSequence
  if (!background) loading.value = true
  try {
    const chatItems = await fetchAll('/conversations', { params: { channel: 'whatsapp_web', isGroup: false, limit: 100 }, preferredKey: 'items' })
    if (requestSequence !== dataRequestSequence) return
    chats.value = chatItems
    const selectedId = chatId(selected.value)
    const refreshedSelection = selectedId
      ? chats.value.find((chat) => chatId(chat) === selectedId)
      : null
    if (refreshedSelection) {
      selected.value = refreshedSelection
      void loadSelectedContact(refreshedSelection)
      if (refreshSelected) await selectChat(refreshedSelection)
    } else if (selectedId) {
      selected.value = null
      selectedContactRecord.value = null
      messages.value = []
    } else if (chats.value.length) {
      await selectChat(chats.value[0])
    }
  } catch (error) {
    if (!background) $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível carregar os chats do WhatsApp Web.') })
  } finally {
    if (requestSequence === dataRequestSequence) loading.value = false
  }
}

async function loadSessionStatus() {
  try {
    return applySessionStatus(unwrap(await http.get('/whatsapp-web/status')) || {})
  } catch {
    if (monitorReady.value) return sessionStatus.value
    return applySessionStatus({ state: 'disconnected', ready: false, attemptActive: false })
  }
}

function applySessionStatus(payload = {}) {
  const previousReady = monitorReady.value
  const status = normalizeWhatsappWebStatus(payload, sessionStatus.value)
  sessionStatus.value = status
  app.updateChannelStatus('whatsappWeb', status)
  if (previousReady && !status.ready) {
    dataRequestSequence += 1
    chats.value = []
    messages.value = []
    selected.value = null
    selectedContactRecord.value = null
  }
  return status
}

async function loadSelectedContact(chat) {
  const selectedId = String(chatId(chat) || '')
  selectedContactRecord.value = null
  if (!chat?.contactId) return null
  try {
    const contact = unwrap(await http.get(`/contacts/${chat.contactId}`)) || null
    if (String(chatId(selected.value) || '') === selectedId) selectedContactRecord.value = contact
    return contact
  } catch {
    return null
  }
}

async function selectChat(chat) {
  selected.value = chat
  loadSelectedContact(chat)
  const selectedId = String(chatId(chat))
  loadingMessages.value = true
  historyNote.value = ''
  try {
    const localResult = await http.get(`/conversations/${selectedId}/messages`, { params: { limit: 100 } })
    if (String(chatId(selected.value)) !== selectedId) return
    const localItems = asList(unwrap(localResult), 'items').reverse()
    messages.value = mergeWhatsappWebHistory(localItems)
    if (!messages.value.length) historyNote.value = 'Ainda não há histórico armazenado para esta conversa.'
    await http.patch(`/conversations/${selectedId}/read`).catch(() => undefined)
    await scrollToBottom()
  } catch (error) {
    messages.value = []
    historyNote.value = error.response?.status === 404
      ? 'O histórico começará a ser armazenado a partir das próximas mensagens.'
      : 'O histórico não está disponível no momento.'
    if (error.response?.status && error.response.status !== 404) {
      $q.notify({ type: 'warning', message: errorMessage(error, historyNote.value) })
    }
  } finally {
    if (String(chatId(selected.value)) === selectedId) loadingMessages.value = false
  }
}

async function scrollToBottom() {
  await nextTick()
  const element = messagesPanel.value?.$el || messagesPanel.value
  if (element) element.scrollTop = element.scrollHeight
}

async function send() {
  if (!selected.value) return
  if (!selectedReplyAllowed.value) {
    $q.notify({
      type: 'warning',
      message: selected.value.isGroup
        ? 'Grupos ficam disponíveis somente para monitoramento.'
        : `Este contato ainda não autorizou respostas. Ele pode enviar ${permissionCommand.value} ou o administrador pode revisar a permissão.`,
    })
    return
  }
  if (!message.value.trim()) return
  sending.value = true
  try {
    await http.post('/whatsapp-web/send', { destination: selected.value.externalId, text: message.value })
    message.value = ''
    await selectChat(selected.value)
    await scrollToBottom()
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível enviar pelo WhatsApp Web.') })
  } finally {
    sending.value = false
  }
}

function scheduleRealtimeRefresh({ refreshSelected = false } = {}) {
  realtimeRefreshSelected ||= refreshSelected
  if (realtimeRefreshTimer) window.clearTimeout(realtimeRefreshTimer)
  realtimeRefreshTimer = window.setTimeout(() => {
    realtimeRefreshTimer = null
    const shouldRefreshSelected = realtimeRefreshSelected
    realtimeRefreshSelected = false
    void loadData({ background: true, refreshSelected: shouldRefreshSelected })
  }, 180)
}

function onConversationMessage(payload = {}) {
  const conversation = payload?.conversation
  const messageItem = payload?.message
  if (!conversation || String(conversation.channel || '').replaceAll('-', '_') !== 'whatsapp_web') return
  chats.value = upsertWhatsappWebConversation(chats.value, conversation)
  if (messageItem && chatId(selected.value) === chatId(conversation)) {
    selected.value = conversation
    void loadSelectedContact(conversation)
    messages.value = mergeWhatsappWebHistory([...messages.value, messageItem])
    http.patch(`/conversations/${conversation.id}/read`).catch(() => undefined)
    void scrollToBottom()
  }
}

function onConversationsUpdated(payload = {}) {
  const conversation = payload.conversation || payload
  if (String(conversation?.channel || '').replaceAll('-', '_') !== 'whatsapp_web') return
  chats.value = upsertWhatsappWebConversation(chats.value, conversation)
  if (chatId(selected.value) === chatId(conversation)) selected.value = conversation
}

function onWhatsappProviderMessage(payload = {}) {
  const activeId = chatId(selected.value)
  const eventId = String(payload.conversationId || payload.chatId || '')
  scheduleRealtimeRefresh({ refreshSelected: Boolean(activeId && (!eventId || activeId === eventId)) })
}

async function onSocketConnected() {
  liveConnected.value = true
  const status = await loadSessionStatus()
  if (status.ready) await loadData({ background: true, refreshSelected: true })
}

function onSocketDisconnected() {
  liveConnected.value = false
}

async function onConversationRemoved(payload = {}) {
  const removedId = String(payload.conversationId || '')
  if (!removedId || !chats.value.some((chat) => String(chatId(chat)) === removedId)) return
  const selectedWasRemoved = String(chatId(selected.value)) === removedId
  if (selectedWasRemoved) {
    selected.value = null
    messages.value = []
  }
  await loadData()
}

function onConversationHistoryRemoved(payload = {}) {
  if (String(payload.conversationId || '') !== chatId(selected.value)) return
  messages.value = []
  historyNote.value = 'O histórico armazenado desta conversa foi removido.'
}

function onWhatsappContactChanged(payload = {}) {
  if (String(payload.channel || '').replaceAll('-', '_') !== 'whatsapp_web') return
  scheduleRealtimeRefresh({ refreshSelected: true })
}

function onWhatsappStatus(payload = {}) {
  const wasReady = monitorReady.value
  const status = applySessionStatus(payload)
  if (!wasReady && status.ready) {
    void loadData({ background: true, refreshSelected: true })
  }
}

function onWhatsappReady(payload = {}) {
  onWhatsappStatus({ ...payload, state: 'ready', ready: true, attemptActive: false, qrCode: '' })
}

function onWhatsappDisconnected(payload = {}) {
  onWhatsappStatus({ ...payload, state: 'disconnected', ready: false, attemptActive: false, qrCode: '' })
}

async function openContact() {
  if (!selected.value?.contactId) {
    $q.notify({
      type: 'info',
      message: `O contato será criado automaticamente somente quando o remetente enviar ${permissionCommand.value}.`,
    })
    return
  }
  try {
    contactForDialog.value = selectedContactRecord.value
      || unwrap(await http.get(`/contacts/${selected.value.contactId}`))
    contactDialog.value = true
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível abrir o contato.') })
  }
}

function removeConversation(chat) {
  const hasContact = Boolean(chat?.contactId)
  $q.dialog({
    title: 'Remover conversa?',
    message: hasContact
      ? 'As mensagens armazenadas serão removidas. O contato cadastrado será preservado.'
      : 'As mensagens temporárias serão removidas. Nenhum contato foi criado para esta interação.',
    cancel: { flat: true, label: 'Cancelar' },
    ok: { color: 'negative', label: 'Remover conversa' },
    persistent: true,
  }).onOk(async () => {
    try {
      await http.delete(`/conversations/${chatId(chat)}`)
      messages.value = []
      selected.value = null
      await loadData()
      $q.notify({
        type: 'positive',
        message: hasContact ? 'Conversa removida; contato preservado.' : 'Interação temporária removida.',
      })
    } catch (error) {
      $q.notify({ type: 'negative', message: errorMessage(error) })
    }
  })
}

function clearConversation(chat) {
  const hasContact = Boolean(chat?.contactId)
  $q.dialog({
    title: 'Limpar mensagens armazenadas?',
    message: hasContact
      ? 'O histórico temporário será removido. O contato e suas permissões serão preservados.'
      : 'As mensagens temporárias serão removidas. Nenhum contato ou consentimento foi criado para esta interação.',
    cancel: { flat: true, label: 'Cancelar' },
    ok: { color: 'negative', label: 'Limpar mensagens' },
    persistent: true,
  }).onOk(async () => {
    try {
      await http.delete(`/conversations/${chatId(chat)}/messages`)
      if (chatId(selected.value) === chatId(chat)) {
        messages.value = []
        historyNote.value = 'O histórico temporário desta conversa foi removido.'
      }
      await loadData({ background: true })
      $q.notify({ type: 'positive', message: 'Mensagens armazenadas removidas.' })
    } catch (error) {
      $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível limpar as mensagens.') })
    }
  })
}

onMounted(() => {
  const socket = getSocket()
  socket.on('connect', onSocketConnected)
  socket.on('disconnect', onSocketDisconnected)
  socket.on('system:ready', onSocketConnected)
  socket.on('conversation:message', onConversationMessage)
  socket.on('conversations:updated', onConversationsUpdated)
  socket.on('conversation:removed', onConversationRemoved)
  socket.on('conversation:history-removed', onConversationHistoryRemoved)
  socket.on('whatsapp_web:message', onWhatsappProviderMessage)
  socket.on('contact:auto_upserted', onWhatsappContactChanged)
  socket.on('admin_notification:created', onWhatsappContactChanged)
  socket.on('whatsapp_web:status', onWhatsappStatus)
  socket.on('whatsapp_web:qr', onWhatsappStatus)
  socket.on('whatsapp_web:ready', onWhatsappReady)
  socket.on('whatsapp_web:disconnected', onWhatsappDisconnected)
  connectSocket()
  liveConnected.value = socket.connected
  app.fetchSettings()
    .then((settings) => { permissionCommand.value = whatsappPermissionCommandFromSettings(settings) })
    .catch(() => undefined)
  loadSessionStatus().then((status) => status.ready && loadData())
})

onBeforeUnmount(() => {
  const socket = getSocket()
  socket.off('connect', onSocketConnected)
  socket.off('disconnect', onSocketDisconnected)
  socket.off('system:ready', onSocketConnected)
  socket.off('conversation:message', onConversationMessage)
  socket.off('conversations:updated', onConversationsUpdated)
  socket.off('conversation:removed', onConversationRemoved)
  socket.off('conversation:history-removed', onConversationHistoryRemoved)
  socket.off('whatsapp_web:message', onWhatsappProviderMessage)
  socket.off('contact:auto_upserted', onWhatsappContactChanged)
  socket.off('admin_notification:created', onWhatsappContactChanged)
  socket.off('whatsapp_web:status', onWhatsappStatus)
  socket.off('whatsapp_web:qr', onWhatsappStatus)
  socket.off('whatsapp_web:ready', onWhatsappReady)
  socket.off('whatsapp_web:disconnected', onWhatsappDisconnected)
  if (realtimeRefreshTimer) window.clearTimeout(realtimeRefreshTimer)
  realtimeRefreshTimer = null
  realtimeRefreshSelected = false
})
</script>

<template>
  <q-page class="page-container">
    <PageHeader
      eyebrow="Monitor de conversas"
      title="WhatsApp Web"
      description="Acompanhe somente mensagens novas recebidas após a conexão. Interações sem opt-in ficam temporariamente visíveis e somente para leitura."
      icon="forum"
    >
      <template #actions>
        <q-badge
          v-if="monitorReady"
          outline
          :color="liveConnected ? 'positive' : 'warning'"
          :icon="liveConnected ? 'sensors' : 'sync_problem'"
          :label="liveConnected ? 'Tempo real ativo' : 'Reconectando tempo real'"
        />
      </template>
    </PageHeader>

    <q-card v-if="!monitorReady" flat class="glass-card monitor-unavailable">
      <EmptyState
        icon="phonelink_off"
        title="WhatsApp Web desconectado"
        description="A autenticação e o QR Code ficam centralizados na tela Início. Depois de conectar, este monitor será liberado automaticamente."
      >
        <q-btn color="primary" unelevated no-caps icon="space_dashboard" label="Conectar na tela Início" to="/" />
      </EmptyState>
    </q-card>

    <q-card v-else flat class="glass-card whatsapp-shell">
      <aside class="chat-sidebar">
        <div class="sidebar-title"><div><span class="status-dot" :class="monitorReady ? 'status-dot--online' : 'status-dot--warning'" /><strong> {{ monitorReady ? 'Conectado' : 'Desconectado' }}</strong></div><span>{{ chats.length }} chats</span></div>
        <q-input v-model="search" dense outlined clearable placeholder="Buscar conversa" class="q-ma-md">
          <template #prepend><q-icon name="search" /></template>
        </q-input>
        <div v-if="loading" class="q-px-md"><q-skeleton v-for="n in 6" :key="n" type="QItem" /></div>
        <EmptyState v-else-if="!filteredChats.length" icon="chat_bubble_outline" title="Sem conversas" :description="`Novas mensagens aparecerão aqui em tempo real. O contato só será cadastrado e poderá receber resposta após enviar ${permissionCommand}.`" />
        <q-list v-else separator class="whatsapp-chat-list">
          <q-item v-for="chat in filteredChats" :key="chatId(chat)" clickable :active="chatId(chat) === chatId(selected)" active-class="selected-chat" @click="selectChat(chat)">
            <q-item-section avatar>
              <q-avatar size="46px">
                <img v-if="chat.profilePicture || chat.avatar || chat.avatarUrl || chat.imageUrl" :src="chat.profilePicture || chat.avatar || chat.avatarUrl || chat.imageUrl" :alt="`Foto de ${chatName(chat)}`" />
                <span v-else class="avatar-fallback full-width full-height row items-center justify-center">{{ initials(chatName(chat)) }}</span>
              </q-avatar>
            </q-item-section>
            <q-item-section>
              <q-item-label class="text-weight-bold truncate">{{ chatName(chat) }}</q-item-label>
              <q-item-label caption class="truncate">{{ chat.lastMessage?.preview || chat.lastMessage?.body || chat.lastMessage || chat.phone || 'Sem prévia' }}</q-item-label>
            </q-item-section>
            <q-item-section side top>
              <span class="chat-time">{{ formatTime(chat.updatedAt || chat.timestamp) }}</span>
              <q-badge v-if="!chat.contactId" outline color="warning" label="Aguardando opt-in" />
              <q-badge v-if="chat.unreadCount" rounded color="primary" :label="chat.unreadCount" />
            </q-item-section>
          </q-item>
        </q-list>
      </aside>

      <section class="conversation-panel">
        <EmptyState v-if="!selected" icon="forum" title="Escolha uma conversa" description="Selecione um chat à esquerda para visualizar o histórico." />
        <template v-else>
          <header class="conversation-header">
            <q-avatar size="42px" class="avatar-fallback">
              <img
                v-if="selected.avatarUrl || selected.imageUrl || selected.profilePicture || selected.avatar"
                :src="selected.avatarUrl || selected.imageUrl || selected.profilePicture || selected.avatar"
                :alt="`Foto de ${chatName(selected)}`"
              />
              <span v-else>{{ initials(chatName(selected)) }}</span>
            </q-avatar>
            <div class="conversation-identity">
              <strong>{{ chatName(selected) }}</strong>
              <div class="conversation-identifiers">
                <code v-for="identifier in selectedIdentifiers" :key="identifier.key">{{ identifier.label }}: {{ identifier.value }}</code>
              </div>
              <q-badge
                v-if="selectedRegistration.automatic"
                outline
                color="positive"
                icon="auto_awesome"
                :label="`Cadastro automático: ${selectedRegistration.label}`"
              />
              <q-badge
                v-if="!selected.contactId"
                outline
                color="warning"
                icon="person_off"
                :label="`Aguardando ${permissionCommand}`"
              />
              <q-badge
                outline
                :color="selectedReplyAllowed ? 'positive' : 'warning'"
                :icon="selectedReplyAllowed ? 'verified_user' : 'visibility'"
                :label="selectedReplyAllowed ? 'Resposta autorizada' : 'Somente leitura'"
              />
            </div>
            <q-space />
            <q-btn v-if="selected.contactId && !selected.isGroup" flat round icon="manage_accounts" aria-label="Editar contato" @click="openContact"><q-tooltip>Editar contato</q-tooltip></q-btn>
            <q-btn flat round color="warning" icon="cleaning_services" aria-label="Limpar mensagens" @click="clearConversation(selected)"><q-tooltip>Limpar somente as mensagens armazenadas</q-tooltip></q-btn>
            <q-btn flat round color="negative" icon="delete_sweep" aria-label="Remover conversa" @click="removeConversation(selected)"><q-tooltip>{{ selected.contactId ? 'Remover conversa mantendo o contato' : 'Remover interação temporária' }}</q-tooltip></q-btn>
          </header>

          <div ref="messagesPanel" class="message-stream">
            <div v-if="loadingMessages" class="q-pa-lg"><q-skeleton v-for="n in 5" :key="n" type="text" /></div>
            <div v-else-if="!messages.length" class="day-note">{{ historyNote || 'Nenhuma mensagem recente disponível' }}</div>
            <div v-for="item in messages" :key="item.id || item._id || item.timestamp" :class="['message-row', { 'message-row--mine': item.fromMe || item.direction === 'outbound' }]">
              <div class="message-bubble">
                <div>{{ item.body || item.text || item.message }}</div>
                <span>{{ formatTime(item.sentAt || item.createdAt || item.timestamp) }} <q-icon v-if="item.fromMe || item.direction === 'outbound'" name="done_all" size="15px" /></span>
              </div>
            </div>
          </div>

          <footer v-if="selectedReplyAllowed" class="message-composer">
            <div class="composer-row">
              <q-input v-model="message" dense outlined autogrow placeholder="Responder diretamente nesta conversa" class="composer-input" :disable="!monitorReady" @keydown.ctrl.enter="send" />
              <q-btn round unelevated color="primary" icon="send" aria-label="Enviar" :loading="sending" :disable="!monitorReady" @click="send" />
            </div>
          </footer>
          <q-banner v-else-if="selected.isGroup" rounded class="group-monitor-banner">
            <template #avatar><q-icon name="visibility" color="primary" /></template>
            Este grupo está disponível somente para monitoramento. O envio direto pelo WhatsApp Web é restrito a conversas individuais.
          </q-banner>
          <q-banner v-else rounded class="permission-monitor-banner">
            <template #avatar><q-icon name="lock_person" color="warning" /></template>
            <div>
              <strong>Conversa disponível somente para leitura</strong>
              <span v-if="!selected.contactId">Esta interação está armazenada temporariamente, mas ainda não criou um contato. Somente o envio de <code>{{ permissionCommand }}</code> pelo remetente fará o cadastro e autorizará as integrações WhatsApp.</span>
              <span v-else>Ao enviar <code>{{ permissionCommand }}</code> pelo WhatsApp Web ou Cloud, o contato autoriza as duas integrações WhatsApp. A permissão de uma integração ainda não identificada fica pendente até a primeira interação real. O administrador também pode conceder apenas esta permissão manualmente.</span>
            </div>
            <template v-if="selected.contactId" #action>
              <q-btn flat color="primary" no-caps icon="manage_accounts" label="Editar permissão" @click="openContact" />
            </template>
          </q-banner>
        </template>
      </section>
    </q-card>

    <ContactDialog v-model="contactDialog" :contact="contactForDialog" @saved="loadData({ background: true, refreshSelected: true })" />
  </q-page>
</template>

<style scoped>
.whatsapp-shell {
  display: grid;
  min-height: 680px;
  grid-template-columns: minmax(300px, 0.72fr) minmax(0, 1.5fr);
  overflow: hidden;
}

.monitor-unavailable {
  display: grid;
  min-height: 420px;
  place-items: center;
}

.chat-sidebar {
  min-width: 0;
  border-right: 1px solid rgba(3, 21, 21, 0.09);
  background: rgba(247, 254, 252, 0.63);
}

.sidebar-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 0;
  color: #617572;
  font-size: 0.76rem;
}

.sidebar-title strong {
  color: #28504a;
}

.whatsapp-chat-list {
  max-height: 590px;
  overflow: auto;
}

.selected-chat {
  border-left: 3px solid #35bca4;
  background: rgba(130, 248, 230, 0.18);
}

.chat-time {
  color: #70827f;
  font-size: 0.66rem;
}

.conversation-panel {
  display: grid;
  min-width: 0;
  grid-template-rows: auto minmax(0, 1fr) auto;
  background:
    radial-gradient(circle at 50% 40%, rgba(130, 248, 230, 0.1), transparent 28rem),
    rgba(241, 249, 247, 0.46);
}

.conversation-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(3, 21, 21, 0.08);
  background: rgba(255, 255, 255, 0.62);
}

.conversation-header strong,
.conversation-header span {
  display: block;
}

.conversation-header span {
  color: #657976;
  font-size: 0.72rem;
}

.conversation-identity {
  display: grid;
  min-width: 0;
  gap: 5px;
}

.conversation-identifiers {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
}

.conversation-identifiers code {
  max-width: min(430px, 56vw);
  overflow: hidden;
  color: #5d7470;
  font-size: 0.66rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-stream {
  max-height: 500px;
  padding: 26px;
  overflow: auto;
}

.day-note {
  width: fit-content;
  margin: 0 auto 18px;
  padding: 6px 11px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.82);
  color: #6b7f7c;
  font-size: 0.68rem;
}

.message-row {
  display: flex;
  justify-content: flex-start;
  margin: 7px 0;
}

.message-row--mine {
  justify-content: flex-end;
}

.message-bubble {
  max-width: min(72%, 620px);
  padding: 10px 12px 7px;
  border-radius: 5px 15px 15px;
  background: #fff;
  box-shadow: 0 4px 14px rgba(3, 62, 55, 0.07);
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.message-row--mine .message-bubble {
  border-radius: 15px 5px 15px 15px;
  background: #d8fff7;
}

.message-bubble span {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 3px;
  margin-top: 3px;
  color: #72837f;
  font-size: 0.62rem;
}

.message-composer {
  padding: 12px 16px;
  border-top: 1px solid rgba(3, 21, 21, 0.08);
  background: rgba(255, 255, 255, 0.68);
}

.group-monitor-banner {
  margin: 12px 16px;
  border: 1px solid rgba(39, 183, 159, 0.2);
  background: rgba(39, 183, 159, 0.08);
  color: #365d56;
}

.permission-monitor-banner {
  margin: 12px 16px;
  border: 1px solid rgba(199, 125, 23, 0.24);
  background: rgba(255, 246, 224, 0.9);
  color: #694a1b;
}

.permission-monitor-banner strong,
.permission-monitor-banner span {
  display: block;
}

.permission-monitor-banner span {
  margin-top: 3px;
  font-size: 0.78rem;
}

.permission-monitor-banner code {
  padding: 2px 5px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.72);
  color: #295e56;
}

.composer-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  margin-top: 10px;
}

.composer-input {
  min-width: 0;
  flex: 1;
}

@media (max-width: 850px) {
  .whatsapp-shell {
    min-height: auto;
    grid-template-columns: 1fr;
  }

  .chat-sidebar {
    border-right: 0;
    border-bottom: 1px solid rgba(3, 21, 21, 0.09);
  }

  .whatsapp-chat-list {
    max-height: 320px;
  }

  .conversation-panel {
    min-height: 600px;
  }

  .message-bubble {
    max-width: 88%;
  }

  .conversation-header {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .conversation-identity {
    max-width: calc(100% - 60px);
  }

  .conversation-identifiers code {
    max-width: 78vw;
  }
}
</style>
