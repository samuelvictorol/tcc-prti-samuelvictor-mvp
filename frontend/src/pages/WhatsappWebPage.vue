<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useQuasar } from 'quasar'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import ContactDialog from '../components/ContactDialog.vue'
import { asList, errorMessage, fetchAll, http, unwrap } from '../services/http.js'
import { connectSocket, getSocket } from '../services/socket.js'

const $q = useQuasar()
const loading = ref(false)
const loadingMessages = ref(false)
const syncing = ref(false)
const historyNote = ref('')
const sending = ref(false)
const chats = ref([])
const messages = ref([])
const templates = ref([])
const selected = ref(null)
const search = ref('')
const message = ref('')
const templateId = ref(null)
const sendMode = ref('quick')
const groupDialog = ref(false)
const contactDialog = ref(false)
const savingGroup = ref(false)
const messagesPanel = ref(null)
const groupForm = reactive({ name: '', description: '', chatIds: [] })

const contactInitial = computed(() => selected.value ? {
  displayName: chatName(selected.value),
  phone: selected.value.phone || '',
  channels: [{
    channel: 'whatsapp_web',
    address: selected.value.phone || chatId(selected.value),
    authorized: false,
    consentStatus: 'unknown',
    source: 'whatsapp_web',
  }],
} : {})

const filteredChats = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return chats.value.filter((chat) => !needle || [chat.name, chat.pushName, chat.phone, chat.id, chat.chatId]
    .some((value) => String(value || '').toLowerCase().includes(needle)))
})

const templateOptions = computed(() => templates.value.map((item) => ({ label: item.name || item.title, value: item.id || item._id })))
const chatOptions = computed(() => chats.value.map((item) => ({ label: chatName(item), value: chatId(item) })))

function chatId(chat) {
  return chat?.chatId || chat?.id || chat?._id || chat?.wid
}

function chatName(chat) {
  return chat?.name || chat?.pushName || chat?.contact?.name || chat?.phone || 'Conversa sem nome'
}

function initials(value) {
  return String(value || '?').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function formatTime(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

async function loadData() {
  loading.value = true
  try {
    const [chatItems, templateItems] = await Promise.all([
      fetchAll('/whatsapp-web/chats', { preferredKey: 'chats' }),
      fetchAll('/templates', { params: { channel: 'whatsapp_web' }, preferredKey: 'templates' }),
    ])
    chats.value = chatItems
    templates.value = templateItems
    if (!selected.value && chats.value.length) await selectChat(chats.value[0])
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível carregar os chats do WhatsApp Web.') })
  } finally {
    loading.value = false
  }
}

async function selectChat(chat) {
  selected.value = chat
  loadingMessages.value = true
  historyNote.value = ''
  try {
    messages.value = asList(unwrap(await http.get(`/whatsapp-web/chats/${encodeURIComponent(chatId(chat))}/messages`, { params: { limit: 100 } })), 'messages')
    if (!messages.value.length) historyNote.value = 'Ainda não há histórico armazenado para esta conversa.'
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
    loadingMessages.value = false
  }
}

async function syncChats() {
  syncing.value = true
  try {
    await http.post('/whatsapp-web/sync')
    await loadData()
    $q.notify({ type: 'positive', message: 'Chats sincronizados com a sessão ativa.' })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível sincronizar os chats.') })
  } finally {
    syncing.value = false
  }
}

async function scrollToBottom() {
  await nextTick()
  const element = messagesPanel.value?.$el || messagesPanel.value
  if (element) element.scrollTop = element.scrollHeight
}

async function send() {
  if (!selected.value) return
  if (sendMode.value === 'quick' && !message.value.trim()) return
  if (sendMode.value === 'template' && !templateId.value) return
  sending.value = true
  try {
    const selectedTemplate = templates.value.find((item) => (item.id || item._id) === templateId.value)
    const text = sendMode.value === 'quick'
      ? message.value
      : (selectedTemplate?.body || selectedTemplate?.content || selectedTemplate?.html || '')
    if (!text) throw new Error('O template selecionado não possui conteúdo compatível com o WhatsApp Web.')
    const result = unwrap(await http.post('/whatsapp-web/send', { destination: chatId(selected.value), text })) || {}
    messages.value.push(result.message || {
      id: result.id || `optimistic-${Date.now()}`,
      body: sendMode.value === 'quick' ? message.value : 'Template enviado',
      fromMe: true,
      createdAt: new Date().toISOString(),
      status: 'queued',
    })
    message.value = ''
    await scrollToBottom()
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível enviar pelo WhatsApp Web.') })
  } finally {
    sending.value = false
  }
}

function onRealtimeMessage(event) {
  const incomingChatId = event.chatId || event.chat_id || event.message?.chatId
  if (String(incomingChatId) === String(chatId(selected.value))) {
    messages.value.push(event.message || event)
    scrollToBottom()
  }
  const chat = chats.value.find((item) => String(chatId(item)) === String(incomingChatId))
  if (chat) {
    chat.lastMessage = event.message?.body || event.body || event.message
    chat.updatedAt = new Date().toISOString()
  }
}

function openGroupDialog() {
  Object.assign(groupForm, { name: '', description: '', chatIds: selected.value ? [chatId(selected.value)] : [] })
  groupDialog.value = true
}

async function saveGroup() {
  savingGroup.value = true
  try {
    await http.post('/whatsapp-web/groups', groupForm)
    groupDialog.value = false
    $q.notify({ type: 'positive', message: 'Grupo de contatos criado a partir dos chats.' })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error) })
  } finally {
    savingGroup.value = false
  }
}

onMounted(() => {
  loadData()
  const socket = connectSocket()
  socket.on('whatsapp-web:message', onRealtimeMessage)
  socket.on('whatsapp:message', onRealtimeMessage)
  socket.on('whatsapp_web:message', onRealtimeMessage)
  socket.on('whatsapp-web:chats', loadData)
})

onBeforeUnmount(() => {
  const socket = getSocket()
  socket.off('whatsapp-web:message', onRealtimeMessage)
  socket.off('whatsapp:message', onRealtimeMessage)
  socket.off('whatsapp_web:message', onRealtimeMessage)
  socket.off('whatsapp-web:chats', loadData)
})
</script>

<template>
  <q-page class="page-container">
    <PageHeader
      eyebrow="Sessão autenticada"
      title="WhatsApp Web"
      description="Visualize chats sincronizados, acompanhe mensagens em tempo real e dispare conteúdo autorizado."
      icon="forum"
    >
      <template #actions>
        <q-btn outline color="primary" no-caps icon="group_add" label="Criar grupo" @click="openGroupDialog" />
        <q-btn color="primary" unelevated no-caps icon="refresh" label="Sincronizar chats" :loading="syncing" @click="syncChats" />
      </template>
    </PageHeader>

    <q-card flat class="glass-card whatsapp-shell">
      <aside class="chat-sidebar">
        <div class="sidebar-title"><div><span class="status-dot status-dot--online" /><strong> Conectado</strong></div><span>{{ chats.length }} chats</span></div>
        <q-input v-model="search" dense outlined clearable placeholder="Buscar conversa" class="q-ma-md">
          <template #prepend><q-icon name="search" /></template>
        </q-input>
        <div v-if="loading" class="q-px-md"><q-skeleton v-for="n in 6" :key="n" type="QItem" /></div>
        <EmptyState v-else-if="!filteredChats.length" icon="chat_bubble_outline" title="Sem conversas" description="Chats sincronizados aparecerão aqui." />
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
              <q-item-label caption class="truncate">{{ chat.lastMessage?.body || chat.lastMessage || chat.phone || 'Sem prévia' }}</q-item-label>
            </q-item-section>
            <q-item-section side top><span class="chat-time">{{ formatTime(chat.updatedAt || chat.timestamp) }}</span><q-badge v-if="chat.unreadCount" rounded color="primary" :label="chat.unreadCount" /></q-item-section>
          </q-item>
        </q-list>
      </aside>

      <section class="conversation-panel">
        <EmptyState v-if="!selected" icon="forum" title="Escolha uma conversa" description="Selecione um chat à esquerda para visualizar o histórico." />
        <template v-else>
          <header class="conversation-header">
            <q-avatar size="42px" class="avatar-fallback">{{ initials(chatName(selected)) }}</q-avatar>
            <div><strong>{{ chatName(selected) }}</strong><span>{{ selected.phone || selected.id || 'WhatsApp Web' }}</span></div>
            <q-space />
            <q-btn flat round icon="person_add" aria-label="Cadastrar contato" @click="contactDialog = true"><q-tooltip>Cadastrar como contato</q-tooltip></q-btn>
            <q-btn flat round icon="more_vert" aria-label="Opções da conversa" />
          </header>

          <div ref="messagesPanel" class="message-stream">
            <div v-if="loadingMessages" class="q-pa-lg"><q-skeleton v-for="n in 5" :key="n" type="text" /></div>
            <div v-else-if="!messages.length" class="day-note">{{ historyNote || 'Nenhuma mensagem recente disponível' }}</div>
            <div v-for="item in messages" :key="item.id || item._id || item.timestamp" :class="['message-row', { 'message-row--mine': item.fromMe || item.direction === 'outbound' }]">
              <div class="message-bubble">
                <div>{{ item.body || item.text || item.message }}</div>
                <span>{{ formatTime(item.createdAt || item.timestamp) }} <q-icon v-if="item.fromMe || item.direction === 'outbound'" name="done_all" size="15px" /></span>
              </div>
            </div>
          </div>

          <footer class="message-composer">
            <q-btn-toggle v-model="sendMode" dense no-caps unelevated toggle-color="primary" color="white" text-color="dark" :options="[{ label: 'Rápida', value: 'quick' }, { label: 'Template', value: 'template' }]" />
            <div class="composer-row">
              <q-input v-if="sendMode === 'quick'" v-model="message" dense outlined autogrow placeholder="Escreva uma notificação" class="composer-input" @keydown.ctrl.enter="send" />
              <q-select v-else v-model="templateId" dense outlined emit-value map-options :options="templateOptions" label="Template" class="composer-input" />
              <q-btn round unelevated color="primary" icon="send" aria-label="Enviar" :loading="sending" @click="send" />
            </div>
          </footer>
        </template>
      </section>
    </q-card>

    <q-dialog v-model="groupDialog" persistent>
      <q-card class="dialog-card">
        <q-card-section class="row items-center"><div><div class="text-h6 text-weight-bold">Grupo de contatos</div><div class="text-caption text-muted">A origem será identificada como WhatsApp Web.</div></div><q-space /><q-btn v-close-popup flat round dense icon="close" /></q-card-section>
        <q-separator />
        <q-form @submit.prevent="saveGroup">
          <q-card-section class="form-grid q-pa-lg">
            <q-input v-model.trim="groupForm.name" outlined label="Nome *" :rules="[(v) => Boolean(v) || 'Informe o nome']" />
            <q-input v-model="groupForm.description" outlined label="Descrição" />
            <q-select v-model="groupForm.chatIds" outlined multiple use-chips emit-value map-options :options="chatOptions" label="Chats" class="full-span" />
          </q-card-section>
          <q-separator />
          <q-card-actions align="right" class="q-pa-md"><q-btn v-close-popup flat no-caps label="Cancelar" /><q-btn type="submit" color="primary" unelevated no-caps label="Criar grupo" :loading="savingGroup" /></q-card-actions>
        </q-form>
      </q-card>
    </q-dialog>
    <ContactDialog v-model="contactDialog" :initial="contactInitial" @saved="loadData" />
  </q-page>
</template>

<style scoped>
.whatsapp-shell {
  display: grid;
  min-height: 680px;
  grid-template-columns: minmax(300px, 0.72fr) minmax(0, 1.5fr);
  overflow: hidden;
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
}
</style>
