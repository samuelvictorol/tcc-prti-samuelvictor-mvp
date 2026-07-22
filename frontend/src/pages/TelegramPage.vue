<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useQuasar } from 'quasar'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import ContactDialog from '../components/ContactDialog.vue'
import { errorMessage, fetchAll, http, unwrap } from '../services/http.js'
import { connectSocket, getSocket } from '../services/socket.js'
import { telegramBotIdentity } from '../services/telegram.js'
import {
  contactIdentity,
  identityIdentifiers,
  identityRegistrationSource,
} from '../services/contact-identities.js'

const $q = useQuasar()
const tab = ref('chats')
const loading = ref(false)
const loadingMessages = ref(false)
const sending = ref(false)
const syncing = ref(false)
const liveConnected = ref(false)
const groupDialog = ref(false)
const groupSendDialog = ref(false)
const savingGroup = ref(false)
const editingGroupId = ref(null)
const chats = ref([])
const groups = ref([])
const templates = ref([])
const bot = ref(null)
const realtimeMessages = ref([])
const selected = ref(null)
const selectedGroup = ref(null)
const contactDialog = ref(false)
const contactForDialog = ref(null)
const selectedContactRecord = ref(null)
const search = ref('')
const sendMode = ref('quick')
const message = ref('')
const templateId = ref(null)
const messagesPanel = ref(null)
const groupForm = reactive({ name: '', externalId: '', inviteLink: '', description: '' })
let chatRefreshTimer

const groupColumns = [
  { name: 'name', label: 'Grupo', field: 'name', align: 'left' },
  { name: 'chatId', label: 'Chat ID', field: 'externalId', align: 'left' },
  { name: 'inviteLink', label: 'Link', field: 'inviteLink', align: 'left' },
  { name: 'actions', label: '', field: 'actions', align: 'right' },
]

const filteredChats = computed(() => {
  const needle = search.value.toLowerCase().trim()
  return chats.value.filter((chat) => !needle || [chat.displayName, chat.externalId, chat.name, chat.firstName, chat.username, chat.chatId, chat.id]
    .some((value) => String(value || '').toLowerCase().includes(needle)))
})

const templateOptions = computed(() => templates.value.map((item) => ({
  label: item.name || item.title,
  value: item.id || item._id,
})))

const selectedRealtimeMessages = computed(() => realtimeMessages.value
  .filter((item) => String(item.conversationId) === String(recordId(selected.value)))
  .slice(-50))

const botUsername = computed(() => bot.value?.username ? `@${bot.value.username}` : '')
const selectedTelegramIdentity = computed(() => contactIdentity(selectedContactRecord.value || {}, 'telegram') || {
  channel: 'telegram',
  address: chatAddress(selected.value),
  source: 'conversation',
})
const selectedTelegramIdentifiers = computed(() => identityIdentifiers(selectedTelegramIdentity.value))
const selectedTelegramRegistration = computed(() => identityRegistrationSource(selectedTelegramIdentity.value))

function recordId(record) {
  return record?.id || record?._id || record?.chatId || record?.chat_id
}

function chatTitle(chat) {
  return chat.displayName || chat.name || [chat.firstName, chat.lastName].filter(Boolean).join(' ') || chat.title || chat.telegramUsername || 'Contato do Telegram'
}

function telegramIdentity(chat) {
  return chat?.channels?.find((item) => String(item.channel).replaceAll('-', '_') === 'telegram')
}

function chatAddress(chat) {
  return chat?.externalId || telegramIdentity(chat)?.address || chat?.chatId || chat?.chat_id
}

function chatSubtitle(chat) {
  const rawUsername = chat.telegramUsername || chat.username
  const username = rawUsername ? `@${String(rawUsername).replace(/^@/, '')}` : ''
  return username || chat.type || (chat.contactId || telegramIdentity(chat)?.authorized ? 'Conversa autorizada' : 'Aguardando autorização')
}

function replaceChats(items) {
  const selectedId = recordId(selected.value)
  const selectedAddress = chatAddress(selected.value)
  const currentItems = chats.value
  chats.value = items.map((chat) => {
    const current = currentItems.find((item) => (
      recordId(item) && String(recordId(item)) === String(recordId(chat))
    ) || (
      chatAddress(item) && String(chatAddress(item)) === String(chatAddress(chat))
    ))
    return current?.lastMessage ? {
      ...chat,
      lastMessage: chat.lastMessage || current.lastMessage,
      updatedAt: chat.updatedAt || current.updatedAt,
    } : chat
  }).sort((left, right) => new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0))
  selected.value = chats.value.find((chat) => (
    selectedId && String(recordId(chat)) === String(selectedId)
  ) || (
    selectedAddress && String(chatAddress(chat)) === String(selectedAddress)
  )) || chats.value[0] || null
}

async function loadChats({ background = false } = {}) {
  try {
    const items = await fetchAll('/conversations', { params: { channel: 'telegram', isGroup: false, limit: 100 }, preferredKey: 'items' })
    replaceChats(items)
  } catch (error) {
    if (!background) throw error
  }
}

async function loadBotIdentity() {
  try {
    const status = unwrap(await http.get('/telegram/status', { params: { probe: true } })) || {}
    bot.value = telegramBotIdentity(status)
  } catch {
    bot.value = null
  }
}

async function loadData() {
  loading.value = true
  try {
    const [chatItems, groupItems, templateItems, status] = await Promise.all([
      fetchAll('/conversations', { params: { channel: 'telegram', isGroup: false, limit: 100 }, preferredKey: 'items' }),
      fetchAll('/telegram/groups', { preferredKey: 'groups' }),
      fetchAll('/templates', { params: { channel: 'telegram' }, preferredKey: 'templates' }),
      http.get('/telegram/status', { params: { probe: true } }).then(unwrap),
    ])
    replaceChats(chatItems)
    groups.value = groupItems
    templates.value = templateItems
    bot.value = telegramBotIdentity(status)
    if (selected.value) {
      loadSelectedContact(selected.value)
      await loadConversationMessages(selected.value)
    }
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível carregar o Telegram.') })
  } finally {
    loading.value = false
  }
}

async function loadConversationMessages(chat) {
  if (!recordId(chat)) return
  loadingMessages.value = true
  try {
    const items = await fetchAll(`/conversations/${recordId(chat)}/messages`, { params: { limit: 100 }, preferredKey: 'items' })
    realtimeMessages.value = items.reverse().map((item) => ({
      ...item,
      text: item.body || '',
      sentAt: item.sentAt || item.createdAt,
    }))
    await http.patch(`/conversations/${recordId(chat)}/read`).catch(() => undefined)
    scrollMessagesToBottom()
  } catch (error) {
    realtimeMessages.value = []
    $q.notify({ type: 'warning', message: errorMessage(error, 'Não foi possível carregar o histórico da conversa.') })
  } finally {
    loadingMessages.value = false
  }
}

async function selectChat(chat) {
  selected.value = chat
  loadSelectedContact(chat)
  await loadConversationMessages(chat)
}

async function loadSelectedContact(chat) {
  const selectedId = String(recordId(chat) || '')
  selectedContactRecord.value = null
  if (!chat?.contactId) return null
  try {
    const contact = unwrap(await http.get(`/contacts/${chat.contactId}`)) || null
    if (String(recordId(selected.value) || '') === selectedId) selectedContactRecord.value = contact
    return contact
  } catch {
    return null
  }
}

async function sync() {
  syncing.value = true
  try {
    await http.post('/telegram/sync')
    await loadData()
    $q.notify({ type: 'positive', message: 'Interações do bot sincronizadas.' })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error) })
  } finally {
    syncing.value = false
  }
}

function realtimeMessageKey(item) {
  return `${item.chatId}:${item.id}`
}

function scrollMessagesToBottom() {
  nextTick(() => {
    if (messagesPanel.value) messagesPanel.value.scrollTop = messagesPanel.value.scrollHeight
  })
}

function addRealtimeMessage(item) {
  if (!item) return
  const key = realtimeMessageKey(item)
  if (realtimeMessages.value.some((current) => realtimeMessageKey(current) === key)) return
  realtimeMessages.value = [...realtimeMessages.value, item].slice(-200)
  scrollMessagesToBottom()
}

function scheduleChatRefresh() {
  clearTimeout(chatRefreshTimer)
  chatRefreshTimer = setTimeout(() => loadChats({ background: true }), 250)
}

function onConversationMessage(payload) {
  const conversation = payload?.conversation
  const messageItem = payload?.message
  if (!conversation || conversation.channel !== 'telegram') return
  const index = chats.value.findIndex((chat) => String(recordId(chat)) === String(conversation.id))
  chats.value = [conversation, ...chats.value.filter((_chat, itemIndex) => itemIndex !== index)]
  if (messageItem && String(recordId(selected.value)) === String(conversation.id)) {
    addRealtimeMessage({ ...messageItem, text: messageItem.body || '', sentAt: messageItem.sentAt || messageItem.createdAt })
    http.patch(`/conversations/${conversation.id}/read`).catch(() => undefined)
  }
}

async function openContact() {
  if (!selected.value) return
  try {
    contactForDialog.value = selectedContactRecord.value || (selected.value.contactId
      ? unwrap(await http.get(`/contacts/${selected.value.contactId}`))
      : {
          displayName: chatTitle(selected.value),
          telegramUsername: selected.value.telegramUsername || selected.value.username,
          avatarUrl: selected.value.avatarUrl,
        })
    contactDialog.value = true
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível abrir o contato.') })
  }
}

function removeConversation(chat) {
  $q.dialog({
    title: 'Remover conversa?',
    message: 'O histórico deste chat será removido. O contato e a autorização do Telegram serão preservados.',
    cancel: { flat: true, label: 'Cancelar' },
    ok: { color: 'negative', label: 'Remover conversa' },
    persistent: true,
  }).onOk(async () => {
    try {
      await http.delete(`/conversations/${recordId(chat)}`)
      realtimeMessages.value = []
      selected.value = null
      selectedContactRecord.value = null
      await loadChats()
      if (selected.value) {
        loadSelectedContact(selected.value)
        await loadConversationMessages(selected.value)
      }
      $q.notify({ type: 'positive', message: 'Conversa removida; contato preservado.' })
    } catch (error) {
      $q.notify({ type: 'negative', message: errorMessage(error) })
    }
  })
}

function onChatsChanged() {
  scheduleChatRefresh()
}

async function onConversationRemoved(payload = {}) {
  const removedId = String(payload.conversationId || '')
  if (!removedId || !chats.value.some((chat) => String(recordId(chat)) === removedId)) return
  const selectedWasRemoved = String(recordId(selected.value)) === removedId
  if (selectedWasRemoved) {
    selected.value = null
    realtimeMessages.value = []
  }
  await loadChats({ background: true })
  if (selectedWasRemoved && selected.value) await loadConversationMessages(selected.value)
}

function onSocketConnected() {
  liveConnected.value = true
  scheduleChatRefresh()
  loadBotIdentity()
}

function onSocketDisconnected() {
  liveConnected.value = false
}

function formatMessageTime(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

async function send() {
  if (!selected.value) return
  if (sendMode.value === 'quick' && !message.value.trim()) {
    $q.notify({ type: 'warning', message: 'Escreva uma mensagem.' })
    return
  }
  if (sendMode.value === 'template' && !templateId.value) {
    $q.notify({ type: 'warning', message: 'Selecione um template.' })
    return
  }
  sending.value = true
  try {
    await http.post('/telegram/send', {
      contactId: selected.value.contactId || recordId(selected.value),
      mode: sendMode.value,
      message: sendMode.value === 'quick' ? message.value : undefined,
      templateId: sendMode.value === 'template' ? templateId.value : undefined,
    })
    message.value = ''
    await loadConversationMessages(selected.value)
    $q.notify({ type: 'positive', message: 'Mensagem enviada pelo Telegram.' })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error) })
  } finally {
    sending.value = false
  }
}

function openGroup(group) {
  editingGroupId.value = group ? recordId(group) : null
  Object.assign(groupForm, {
    name: group?.name || group?.title || '',
    externalId: group?.externalId || group?.chatId || group?.chat_id || '',
    inviteLink: group?.inviteLink || group?.invite_link || '',
    description: group?.description || '',
  })
  groupDialog.value = true
}

async function saveGroup() {
  savingGroup.value = true
  try {
    const payload = {
      ...groupForm,
      chatId: groupForm.externalId,
      inviteLink: groupForm.inviteLink?.trim() || null,
    }
    delete payload.externalId
    if (editingGroupId.value) await http.put(`/telegram/groups/${editingGroupId.value}`, payload)
    else await http.post('/telegram/groups', payload)
    groupDialog.value = false
    $q.notify({ type: 'positive', message: 'Grupo do Telegram salvo.' })
    await loadData()
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error) })
  } finally {
    savingGroup.value = false
  }
}

function removeGroup(group) {
  $q.dialog({ title: 'Remover vínculo?', message: 'O grupo deixará de aparecer como destino no sistema.', cancel: true, ok: { color: 'negative', label: 'Remover' } })
    .onOk(async () => {
      try {
        await http.delete(`/telegram/groups/${recordId(group)}`)
        await loadData()
      } catch (error) {
        $q.notify({ type: 'negative', message: errorMessage(error) })
      }
    })
}

function openGroupSend(group) {
  selectedGroup.value = group
  sendMode.value = 'quick'
  message.value = ''
  templateId.value = null
  groupSendDialog.value = true
}

async function sendGroup() {
  if (sendMode.value === 'quick' && !message.value.trim()) return
  if (sendMode.value === 'template' && !templateId.value) return
  sending.value = true
  try {
    await http.post('/telegram/send', {
      groupId: recordId(selectedGroup.value),
      mode: sendMode.value,
      message: sendMode.value === 'quick' ? message.value : undefined,
      templateId: sendMode.value === 'template' ? templateId.value : undefined,
    })
    groupSendDialog.value = false
    $q.notify({ type: 'positive', message: 'Mensagem enviada para o grupo.' })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error) })
  } finally {
    sending.value = false
  }
}

onMounted(() => {
  const socket = getSocket()
  socket.on('connect', onSocketConnected)
  socket.on('disconnect', onSocketDisconnected)
  socket.on('system:ready', onSocketConnected)
  socket.on('telegram:chats', onChatsChanged)
  socket.on('telegram:webhook', onChatsChanged)
  socket.on('conversation:message', onConversationMessage)
  socket.on('conversation:removed', onConversationRemoved)
  connectSocket()
  liveConnected.value = socket.connected
  loadData()
})

onBeforeUnmount(() => {
  clearTimeout(chatRefreshTimer)
  const socket = getSocket()
  socket.off('connect', onSocketConnected)
  socket.off('disconnect', onSocketDisconnected)
  socket.off('system:ready', onSocketConnected)
  socket.off('telegram:chats', onChatsChanged)
  socket.off('telegram:webhook', onChatsChanged)
  socket.off('conversation:message', onConversationMessage)
  socket.off('conversation:removed', onConversationRemoved)
})
</script>

<template>
  <q-page class="page-container">
    <PageHeader
      eyebrow="Canal conectado"
      title="Telegram"
      description="Atenda quem iniciou o bot, gerencie grupos vinculados e envie mensagens para chat IDs autorizados."
      icon="send_to_mobile"
    >
      <template #actions>
        <q-btn outline color="primary" no-caps icon="sync" label="Sincronizar" :loading="syncing" @click="sync" />
        <q-btn color="primary" unelevated no-caps icon="add_link" label="Vincular grupo" @click="openGroup()" />
      </template>
    </PageHeader>

    <div class="bot-identity q-mb-lg">
      <q-avatar color="primary" text-color="white" icon="smart_toy" size="46px" />
      <div class="bot-identity__copy">
        <span>Bot conectado</span>
        <strong>{{ bot?.displayName || 'Telegram Bot' }}</strong>
        <small v-if="botUsername">{{ botUsername }}</small>
      </div>
      <q-space />
      <q-badge
        rounded
        :color="liveConnected ? 'positive' : 'grey-6'"
        :label="liveConnected ? 'Atualização automática ativa' : 'Reconectando atualização automática'"
      />
    </div>

    <div class="policy-note q-mb-lg">
      <q-icon name="info" size="22px" />
      <span>O bot só envia mensagens privadas depois que a pessoa inicia ou autoriza a conversa. Participar do mesmo grupo não autoriza uma mensagem privada.</span>
    </div>

    <q-card flat class="glass-card section-card">
      <q-tabs v-model="tab" no-caps inline-label active-color="primary" indicator-color="transparent" class="q-mb-lg">
        <q-tab name="chats" icon="forum" label="Conversas autorizadas" />
        <q-tab name="groups" icon="groups" label="Grupos vinculados" />
      </q-tabs>

      <q-tab-panels v-model="tab" animated class="transparent">
        <q-tab-panel name="chats" class="q-pa-none">
          <div class="telegram-workspace">
            <section class="chat-list-panel">
              <q-input v-model="search" dense outlined clearable placeholder="Buscar conversa" class="q-mb-md">
                <template #prepend><q-icon name="search" /></template>
              </q-input>
              <div v-if="loading" class="q-pa-md"><q-skeleton v-for="n in 5" :key="n" type="QItem" /></div>
              <EmptyState v-else-if="!filteredChats.length" icon="mark_chat_unread" title="Nenhuma conversa autorizada" description="Compartilhe o link do bot para receber novos /start." />
              <q-list v-else separator class="chat-list">
                <q-item v-for="chat in filteredChats" :key="recordId(chat)" clickable :active="recordId(selected) === recordId(chat)" active-class="chat-active" @click="selectChat(chat)">
                  <q-item-section avatar><q-avatar class="avatar-fallback"><img v-if="chat.avatarUrl || chat.imageUrl" :src="chat.avatarUrl || chat.imageUrl" :alt="`Foto de ${chatTitle(chat)}`" /><span v-else>{{ chatTitle(chat).slice(0, 1).toUpperCase() }}</span></q-avatar></q-item-section>
                  <q-item-section>
                    <q-item-label class="text-weight-bold">{{ chatTitle(chat) }}</q-item-label>
                    <q-item-label caption>{{ chat.lastMessage?.preview || chat.lastMessage || chatSubtitle(chat) }}</q-item-label>
                    <q-item-label v-if="chat.lastMessage" caption class="chat-identity">{{ chatSubtitle(chat) }}</q-item-label>
                  </q-item-section>
                  <q-item-section side><span class="status-dot status-dot--online" title="Autorizado" /></q-item-section>
                </q-item>
              </q-list>
            </section>

            <section class="send-panel">
              <EmptyState v-if="!selected" icon="chat_bubble_outline" title="Selecione uma conversa" description="Escolha um chat autorizado para preparar a mensagem." />
              <template v-else>
                <div class="recipient-header">
                  <q-avatar size="48px" class="avatar-fallback"><img v-if="selected.avatarUrl || selected.imageUrl" :src="selected.avatarUrl || selected.imageUrl" :alt="`Foto de ${chatTitle(selected)}`" /><span v-else>{{ chatTitle(selected).slice(0, 1).toUpperCase() }}</span></q-avatar>
                  <div class="recipient-identity">
                    <strong>{{ chatTitle(selected) }}</strong>
                    <span>{{ chatSubtitle(selected) }}</span>
                    <div class="recipient-identifiers">
                      <code v-for="identifier in selectedTelegramIdentifiers" :key="identifier.key">{{ identifier.label }}: {{ identifier.value }}</code>
                    </div>
                    <q-badge
                      v-if="selectedTelegramRegistration.automatic"
                      outline
                      color="positive"
                      icon="auto_awesome"
                      :label="`Cadastro automático: ${selectedTelegramRegistration.label}`"
                    />
                  </div>
                </div>
                <div class="row justify-end q-gutter-sm q-mt-sm">
                  <q-btn flat color="primary" no-caps icon="manage_accounts" :label="selected.contactId ? 'Editar contato' : 'Salvar como contato'" @click="openContact" />
                  <q-btn flat color="negative" no-caps icon="delete_sweep" label="Remover conversa" @click="removeConversation(selected)" />
                </div>
                <div ref="messagesPanel" class="telegram-message-stream" aria-live="polite">
                  <div v-if="loadingMessages" class="message-session-note">Carregando histórico…</div>
                  <div v-else-if="!selectedRealtimeMessages.length" class="message-session-note">
                    Nenhuma mensagem armazenada nesta conversa.
                  </div>
                  <div
                    v-for="item in selectedRealtimeMessages"
                    :key="realtimeMessageKey(item)"
                    :class="['telegram-message-row', { 'telegram-message-row--mine': item.direction === 'outbound' }]"
                  >
                    <div class="telegram-message-bubble">
                      <div>{{ item.text }}</div>
                      <span>{{ formatMessageTime(item.sentAt) }}</span>
                    </div>
                  </div>
                </div>
                <q-btn-toggle v-model="sendMode" spread no-caps unelevated toggle-color="primary" color="white" text-color="dark" :options="[{ label: 'Mensagem rápida', value: 'quick' }, { label: 'Usar template', value: 'template' }]" class="q-my-lg" />
                <q-input v-if="sendMode === 'quick'" v-model="message" outlined type="textarea" autogrow label="Mensagem" />
                <q-select v-else v-model="templateId" outlined emit-value map-options :options="templateOptions" label="Template do Telegram" />
                <div class="row justify-end q-mt-lg"><q-btn color="dark" unelevated no-caps icon-right="send" label="Enviar ao Telegram" :loading="sending" @click="send" /></div>
              </template>
            </section>
          </div>
        </q-tab-panel>

        <q-tab-panel name="groups" class="q-pa-none">
          <EmptyState v-if="!loading && !groups.length" icon="group_add" title="Nenhum grupo vinculado" description="Adicione o bot ao grupo e salve o chat_id para habilitar disparos.">
            <q-btn color="primary" unelevated no-caps label="Vincular grupo" @click="openGroup()" />
          </EmptyState>
          <q-table v-else flat :rows="groups" :columns="groupColumns" row-key="id" :loading="loading">
            <template #body-cell-name="props"><q-td :props="props"><strong>{{ props.row.name || props.row.title }}</strong><div class="text-caption text-muted">{{ props.row.description || 'Grupo do Telegram' }}</div></q-td></template>
            <template #body-cell-chatId="props"><q-td :props="props"><code>{{ props.row.externalId || props.row.chatId || props.row.chat_id }}</code></q-td></template>
            <template #body-cell-inviteLink="props"><q-td :props="props"><a v-if="props.row.inviteLink || props.row.invite_link" :href="props.row.inviteLink || props.row.invite_link" target="_blank" rel="noopener">Abrir convite</a><span v-else>—</span></q-td></template>
            <template #body-cell-actions="props"><q-td :props="props"><q-btn flat round dense color="primary" icon="send" aria-label="Enviar ao grupo" @click="openGroupSend(props.row)" /><q-btn flat round dense icon="edit" aria-label="Editar grupo" @click="openGroup(props.row)" /><q-btn flat round dense color="negative" icon="delete" aria-label="Remover grupo" @click="removeGroup(props.row)" /></q-td></template>
          </q-table>
        </q-tab-panel>
      </q-tab-panels>
    </q-card>

    <q-dialog v-model="groupDialog" persistent :maximized="$q.screen.lt.sm">
      <q-card class="dialog-card dialog-card--medium">
        <q-card-section class="row items-center"><div class="text-h6 text-weight-bold">{{ editingGroupId ? 'Editar' : 'Vincular' }} grupo</div><q-space /><q-btn v-close-popup flat round dense icon="close" /></q-card-section>
        <q-separator />
        <q-form @submit.prevent="saveGroup">
          <q-card-section class="form-grid q-pa-lg">
            <q-input v-model.trim="groupForm.name" outlined label="Nome *" :rules="[(v) => Boolean(v) || 'Informe o nome']" />
            <q-input v-model.trim="groupForm.externalId" outlined label="Chat ID *" hint="Normalmente um número negativo" :rules="[(v) => Boolean(v) || 'Informe o chat_id']" />
            <q-input v-model.trim="groupForm.inviteLink" outlined type="url" label="Link de convite" class="full-span" />
            <q-input v-model="groupForm.description" outlined type="textarea" label="Descrição" class="full-span" />
          </q-card-section>
          <q-separator />
          <q-card-actions align="right" class="q-pa-md"><q-btn v-close-popup flat no-caps label="Cancelar" /><q-btn type="submit" color="primary" unelevated no-caps label="Salvar" :loading="savingGroup" /></q-card-actions>
        </q-form>
      </q-card>
    </q-dialog>
    <q-dialog v-model="groupSendDialog" persistent>
      <q-card class="dialog-card dialog-card--compact">
        <q-card-section class="row items-center"><div><div class="text-h6 text-weight-bold">Enviar ao grupo</div><div class="text-caption text-muted">{{ selectedGroup?.name || selectedGroup?.title }}</div></div><q-space /><q-btn v-close-popup flat round dense icon="close" /></q-card-section>
        <q-separator />
        <q-card-section class="q-pa-lg dialog-scroll-body">
          <q-btn-toggle v-model="sendMode" spread no-caps unelevated toggle-color="primary" color="white" text-color="dark" :options="[{label:'Mensagem rápida',value:'quick'},{label:'Template',value:'template'}]" class="q-mb-lg" />
          <q-input v-if="sendMode === 'quick'" v-model="message" outlined type="textarea" autogrow label="Mensagem" />
          <q-select v-else v-model="templateId" outlined emit-value map-options :options="templateOptions" label="Template do Telegram" />
        </q-card-section>
        <q-separator />
        <q-card-actions align="right" class="q-pa-md"><q-btn v-close-popup flat no-caps label="Cancelar" /><q-btn color="primary" unelevated no-caps icon="send" label="Enviar" :loading="sending" @click="sendGroup" /></q-card-actions>
      </q-card>
    </q-dialog>
    <ContactDialog v-model="contactDialog" :contact="contactForDialog" @saved="loadData" />
  </q-page>
</template>

<style scoped>
.bot-identity {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 16px;
  border: 1px solid rgba(36, 123, 160, 0.16);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.62);
}

.bot-identity__copy {
  display: grid;
}

.bot-identity__copy span,
.bot-identity__copy small {
  color: #657976;
  font-size: 0.72rem;
}

.bot-identity__copy strong {
  color: #203f3b;
  line-height: 1.25;
}

.policy-note {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 14px 16px;
  border: 1px solid rgba(36, 123, 160, 0.2);
  border-radius: 16px;
  background: rgba(224, 246, 255, 0.64);
  color: #315e70;
  font-size: 0.83rem;
  line-height: 1.5;
}

.telegram-workspace {
  display: grid;
  min-height: 520px;
  grid-template-columns: minmax(270px, 0.72fr) minmax(0, 1.28fr);
  border: 1px solid rgba(3, 21, 21, 0.08);
  border-radius: 18px;
  overflow: hidden;
}

.chat-list-panel,
.send-panel {
  padding: 18px;
}

.chat-list-panel {
  border-right: 1px solid rgba(3, 21, 21, 0.08);
  background: rgba(239, 250, 247, 0.56);
}

.chat-list {
  max-height: 440px;
  overflow: auto;
}

.chat-active {
  border-radius: 13px;
  background: rgba(130, 248, 230, 0.24);
}

.chat-identity {
  margin-top: 2px;
  opacity: 0.76;
}

.send-panel {
  display: flex;
  flex-direction: column;
  justify-content: center;
  background: rgba(255, 255, 255, 0.4);
}

.telegram-message-stream {
  min-height: 126px;
  max-height: 250px;
  margin-top: 10px;
  padding: 14px;
  overflow-y: auto;
  border: 1px solid rgba(3, 21, 21, 0.07);
  border-radius: 15px;
  background: rgba(241, 249, 247, 0.66);
}

.message-session-note {
  max-width: 360px;
  margin: 22px auto;
  color: #6b7f7c;
  font-size: 0.75rem;
  line-height: 1.5;
  text-align: center;
}

.telegram-message-row {
  display: flex;
  justify-content: flex-start;
  margin: 6px 0;
}

.telegram-message-row--mine {
  justify-content: flex-end;
}

.telegram-message-bubble {
  max-width: 78%;
  padding: 9px 11px 6px;
  border-radius: 5px 14px 14px;
  background: #fff;
  box-shadow: 0 3px 12px rgba(3, 62, 55, 0.06);
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.telegram-message-row--mine .telegram-message-bubble {
  border-radius: 14px 5px 14px 14px;
  background: #d8fff7;
}

.telegram-message-bubble span {
  display: block;
  margin-top: 3px;
  color: #72837f;
  font-size: 0.62rem;
  text-align: right;
}

.recipient-header {
  display: flex;
  align-items: center;
  gap: 13px;
}

.recipient-header strong,
.recipient-header span {
  display: block;
}

.recipient-header span {
  margin-top: 3px;
  color: #667a77;
  font-size: 0.76rem;
}

.recipient-identity {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.recipient-identifiers {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 3px 9px;
}

.recipient-identifiers code {
  max-width: min(360px, 62vw);
  overflow: hidden;
  color: #58716d;
  font-size: 0.68rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 780px) {
  .telegram-workspace {
    grid-template-columns: 1fr;
  }

  .chat-list-panel {
    border-right: 0;
    border-bottom: 1px solid rgba(3, 21, 21, 0.08);
  }

  .chat-list {
    max-height: 290px;
  }
}
</style>
