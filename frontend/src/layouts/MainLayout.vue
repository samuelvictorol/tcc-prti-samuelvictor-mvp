<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useQuasar } from 'quasar'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { useAuthStore } from '../stores/auth.js'
import { connectSocket, disconnectSocket, getSocket } from '../services/socket.js'
import { asList, errorMessage, http, paginationOf, unwrap } from '../services/http.js'
import { playAppSound } from '../services/sounds.js'
import {
  ADMIN_NOTIFICATION_READ_OPTIONS,
  ADMIN_NOTIFICATION_RETENTION_DAYS,
  DEFAULT_ADMIN_NOTIFICATION_CHANNELS,
  adminNotificationKindLabel,
  buildAdminNotificationQuery,
  matchesAdminNotificationFilters,
  paginationAfterAdminNotificationRemoval,
  prependRealtimeAdminNotification,
} from '../services/admin-notifications.js'

const $q = useQuasar()
const router = useRouter()
const app = useAppStore()
const auth = useAuthStore()
const drawer = ref($q.screen.gt.sm)
const adminNotifications = ref([])
const unreadAdminNotifications = ref(0)
const notificationsLoading = ref(false)
const notificationHistoryDialog = ref(false)
const notificationHistoryItems = ref([])
const notificationHistoryLoading = ref(false)
const notificationHistoryError = ref('')
const notificationHistoryFilters = ref({
  search: '',
  read: 'all',
  channel: 'all',
  kind: 'all',
})
const notificationHistoryPagination = ref({
  page: 1,
  rowsPerPage: 15,
  rowsNumber: 0,
  pages: 1,
})
const notificationFilterChannels = ref([])
const notificationFilterKinds = ref([])
const notificationDetailsDialog = ref(false)
const notificationDetails = ref(null)
const notificationDetailsLoading = ref(false)
let notificationHistoryRequest = 0
let notificationSearchTimer
const inviteAccessExplanation = 'Para liberar Convites, configure o WhatsApp Cloud e o Gmail na página Início.'

const notificationChannelOptions = computed(() => {
  const known = new Map(DEFAULT_ADMIN_NOTIFICATION_CHANNELS.map((item) => [item.value, item]))
  for (const channel of notificationFilterChannels.value) {
    const value = typeof channel === 'string' ? channel : channel?.value
    if (!value || known.has(value)) continue
    known.set(value, {
      value,
      label: typeof channel === 'object' && channel.label
        ? channel.label
        : notificationChannelMeta(value).label,
    })
  }
  return [...known.values()]
})

const notificationKindOptions = computed(() => {
  const options = [{ label: 'Todos os tipos', value: 'all' }]
  const values = new Set()
  for (const kind of notificationFilterKinds.value) {
    const value = typeof kind === 'string' ? kind : kind?.value
    if (!value || values.has(value)) continue
    values.add(value)
    options.push({
      value,
      label: typeof kind === 'object' && kind.label
        ? kind.label
        : adminNotificationKindLabel(value),
    })
  }
  return options
})

const notificationHistoryPages = computed(() => Math.max(
  1,
  Number(notificationHistoryPagination.value.pages)
    || Math.ceil(notificationHistoryPagination.value.rowsNumber / notificationHistoryPagination.value.rowsPerPage),
))

const notificationDetailsContext = computed(() => JSON.stringify(notificationDetails.value?.context || {}, null, 2))

const navigation = computed(() => [
  { label: 'Início', caption: 'Saúde e configurações', icon: 'space_dashboard', to: '/', available: true },
  { label: 'Contatos', caption: 'Pessoas e grupos', icon: 'group', to: '/contacts', available: true },
  { label: 'Templates', caption: 'Conteúdo por canal', icon: 'dashboard_customize', to: '/templates', available: true },
  { label: 'Notificações', caption: 'Envios e histórico', icon: 'send', to: '/notifications', available: true },
  { separator: true, label: 'Canais' },
  { label: 'WhatsApp Cloud', icon: 'cloud_sync', to: '/whatsapp-cloud', available: true, channelColor: 'whatsapp' },
  { label: 'Telegram', icon: 'send_to_mobile', to: '/telegram', available: app.isChannelEnabled('telegram'), channelColor: 'telegram' },
  { label: 'Gmail', icon: 'mail', to: '/email', available: app.isChannelEnabled('email'), channelColor: 'gmail' },
  { separator: true, label: 'Governança' },
  {
    label: 'Convites',
    icon: 'link',
    to: '/invites',
    available: app.canAccessInvites,
    unavailableMessage: inviteAccessExplanation,
    tooltip: app.canAccessInvites ? '' : inviteAccessExplanation,
  },
  { label: 'Termos e LGPD', icon: 'verified_user', to: '/terms', available: true },
  { label: 'Logins', caption: 'Acesso seguro dos contatos', icon: 'login', to: '/logins', available: true },
  { separator: true, label: 'Suporte' },
  { label: 'Ajuda', caption: 'Guias e primeiros passos', icon: 'help_center', to: '/help', available: true },
])

function goTo(item) {
  if (item.available) {
    router.push(item.to)
    if ($q.screen.lt.md) drawer.value = false
    return
  }
  $q.notify({
    type: 'warning',
    message: item.unavailableMessage || `${item.label} ainda não está configurado ou conectado.`,
    caption: item.unavailableMessage
      ? 'Os dois canais são necessários para criar e publicar convites.'
      : 'Configure o canal na página Início.',
  })
}

function notificationChannelMeta(channel) {
  return {
    telegram: { label: 'Telegram', icon: 'send_to_mobile', color: 'info' },
    whatsapp_cloud: { label: 'WhatsApp oficial', icon: 'cloud_sync', color: 'positive' },
    email: { label: 'Email', icon: 'mail', color: 'negative' },
  }[channel] || { label: 'Sistema', icon: 'notifications', color: 'grey-7' }
}

function formatNotificationDate(value) {
  if (!value) return 'agora'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

async function loadAdminNotifications() {
  notificationsLoading.value = !adminNotifications.value.length
  try {
    const payload = unwrap(await http.get('/admin-notifications', { params: { page: 1, limit: 20 } })) || {}
    adminNotifications.value = asList(payload, 'items')
    unreadAdminNotifications.value = Number.isFinite(Number(payload.unread))
      ? Number(payload.unread)
      : adminNotifications.value.filter((item) => !item.read).length
  } catch {
    // Mantém a última fotografia estável durante uma reconexão.
  } finally {
    notificationsLoading.value = false
  }
}

function updateNotificationFilterOptions(payload, items = []) {
  const filters = payload?.filters || payload?.availableFilters || {}
  const channels = filters.channels || filters.channel || []
  const kinds = filters.kinds || filters.types || filters.kind || []
  notificationFilterChannels.value = [...new Set([
    ...notificationFilterChannels.value.map((item) => typeof item === 'string' ? item : item?.value),
    ...channels.map((item) => typeof item === 'string' ? item : item?.value),
    ...items.map((item) => item.channel),
  ].filter(Boolean))]
  notificationFilterKinds.value = [...new Set([
    ...notificationFilterKinds.value.map((item) => typeof item === 'string' ? item : item?.value),
    ...kinds.map((item) => typeof item === 'string' ? item : item?.value),
    ...items.map((item) => item.kind),
  ].filter(Boolean))]
}

async function loadNotificationHistory({ preservePage = true } = {}) {
  const request = ++notificationHistoryRequest
  notificationHistoryLoading.value = true
  notificationHistoryError.value = ''
  if (!preservePage) notificationHistoryPagination.value.page = 1

  try {
    const params = buildAdminNotificationQuery(
      notificationHistoryFilters.value,
      notificationHistoryPagination.value,
    )
    const payload = unwrap(await http.get('/admin-notifications', { params })) || {}
    if (request !== notificationHistoryRequest) return

    const items = asList(payload, 'items')
    const pagination = paginationOf(payload, {
      page: params.page,
      rowsPerPage: params.limit,
      rowsNumber: items.length,
    })
    notificationHistoryItems.value = items
    notificationHistoryPagination.value = {
      page: pagination.page,
      rowsPerPage: pagination.rowsPerPage,
      rowsNumber: pagination.rowsNumber,
      pages: Number(payload.pages || Math.ceil(pagination.rowsNumber / pagination.rowsPerPage) || 1),
    }
    if (Number.isFinite(Number(payload.unread))) unreadAdminNotifications.value = Number(payload.unread)
    updateNotificationFilterOptions(payload, items)
  } catch (error) {
    if (request !== notificationHistoryRequest) return
    notificationHistoryError.value = errorMessage(error, 'Não foi possível carregar as atualizações da central.')
  } finally {
    if (request === notificationHistoryRequest) notificationHistoryLoading.value = false
  }
}

function openNotificationHistory() {
  notificationHistoryDialog.value = true
  void loadNotificationHistory({ preservePage: false })
}

function reloadNotificationHistory() {
  void loadNotificationHistory({ preservePage: false })
}

function scheduleNotificationHistorySearch() {
  clearTimeout(notificationSearchTimer)
  notificationSearchTimer = setTimeout(reloadNotificationHistory, 350)
}

function clearNotificationHistoryFilters() {
  notificationHistoryFilters.value = {
    search: '',
    read: 'all',
    channel: 'all',
    kind: 'all',
  }
  reloadNotificationHistory()
}

function onAdminNotification(notification) {
  if (!notification?.id) return
  const alreadyListed = adminNotifications.value.some((item) => item.id === notification.id)
  adminNotifications.value = prependRealtimeAdminNotification(adminNotifications.value, notification, 20)
  updateNotificationFilterOptions({}, [notification])

  if (
    notificationHistoryDialog.value
    && matchesAdminNotificationFilters(notification, notificationHistoryFilters.value)
  ) {
    notificationHistoryPagination.value.rowsNumber += alreadyListed ? 0 : 1
    notificationHistoryPagination.value.pages = Math.max(
      1,
      Math.ceil(notificationHistoryPagination.value.rowsNumber / notificationHistoryPagination.value.rowsPerPage),
    )
    if (notificationHistoryPagination.value.page === 1) {
      notificationHistoryItems.value = prependRealtimeAdminNotification(
        notificationHistoryItems.value,
        notification,
        notificationHistoryPagination.value.rowsPerPage,
      )
    }
  }

  if (!alreadyListed && !notification.read) {
    unreadAdminNotifications.value += 1
    void playAppSound('notify')
  }
}

function onSocketReady() {
  void loadAdminNotifications()
  if (notificationHistoryDialog.value) void loadNotificationHistory()
  void app.fetchStatus(true)
}

function setNotificationReadLocally(id, read = true) {
  const update = (item) => item.id === id ? { ...item, read } : item
  adminNotifications.value = adminNotifications.value.map(update)
  notificationHistoryItems.value = notificationHistoryItems.value.map(update)
  if (notificationDetails.value?.id === id) {
    notificationDetails.value = { ...notificationDetails.value, read }
  }
}

async function markNotificationRead(notification) {
  if (!notification?.id || notification.read) return
  try {
    await http.post(`/admin-notifications/${notification.id}/read`)
    setNotificationReadLocally(notification.id)
    unreadAdminNotifications.value = Math.max(0, unreadAdminNotifications.value - 1)
    if (
      notificationHistoryDialog.value
      && notificationHistoryFilters.value.read === 'unread'
    ) {
      notificationHistoryItems.value = notificationHistoryItems.value.filter((item) => item.id !== notification.id)
      const next = paginationAfterAdminNotificationRemoval(notificationHistoryPagination.value)
      notificationHistoryPagination.value = next.pagination
      if (next.shouldReload) void loadNotificationHistory()
    }
  } catch {
    // O atalho continua disponível mesmo se a atualização do contador falhar.
  }
}

async function openAdminNotification(notification) {
  await markNotificationRead(notification)
  if (notification.contactId) {
    await router.push({ path: '/contacts', query: { editContact: notification.contactId } })
    return
  }
  if (notification.channel === 'telegram') await router.push('/telegram')
  else if (notification.channel === 'whatsapp_cloud') await router.push({ path: '/whatsapp-cloud', query: { tab: 'conversations' } })
}

async function markAllAdminNotificationsRead() {
  try {
    await http.post('/admin-notifications/read-all')
    adminNotifications.value = adminNotifications.value.map((item) => ({ ...item, read: true }))
    notificationHistoryItems.value = notificationHistoryFilters.value.read === 'unread'
      ? []
      : notificationHistoryItems.value.map((item) => ({ ...item, read: true }))
    if (notificationHistoryFilters.value.read === 'unread') {
      notificationHistoryPagination.value.rowsNumber = 0
      notificationHistoryPagination.value.pages = 1
    }
    unreadAdminNotifications.value = 0
  } catch {
    $q.notify({ type: 'warning', message: 'Não foi possível marcar todas as notificações como lidas.' })
  }
}

async function showNotificationDetails(notification) {
  notificationDetails.value = notification
  notificationDetailsDialog.value = true
  notificationDetailsLoading.value = true
  try {
    notificationDetails.value = unwrap(await http.get(`/admin-notifications/${notification.id}`)) || notification
    await markNotificationRead(notificationDetails.value)
  } catch (error) {
    $q.notify({
      type: 'warning',
      message: errorMessage(error, 'Não foi possível abrir os detalhes desta atualização.'),
    })
  } finally {
    notificationDetailsLoading.value = false
  }
}

async function openNotificationContact(notification = notificationDetails.value) {
  if (!notification?.contactId) return
  notificationDetailsDialog.value = false
  notificationHistoryDialog.value = false
  await router.push({ path: '/contacts', query: { editContact: notification.contactId } })
}

async function logout() {
  disconnectSocket()
  await auth.logout()
  router.replace({ name: 'login' })
}

onMounted(() => {
  app.fetchStatus()
  loadAdminNotifications()
  const socket = connectSocket()
  socket.on('admin_notification:created', onAdminNotification)
  socket.on('connect', onSocketReady)
  socket.on('system:ready', onSocketReady)
})

onBeforeUnmount(() => {
  clearTimeout(notificationSearchTimer)
  notificationHistoryRequest += 1
  const socket = getSocket()
  socket.off('admin_notification:created', onAdminNotification)
  socket.off('connect', onSocketReady)
  socket.off('system:ready', onSocketReady)
})
</script>

<template>
  <q-layout view="lHh Lpr lFf" class="app-shell">
    <q-header class="app-header glass">
      <q-toolbar class="app-toolbar">
        <q-btn flat round dense icon="menu" aria-label="Abrir menu" @click="drawer = !drawer" />
        <div class="brand brand--compact">
          <span class="brand__mark"><q-icon name="notifications_active" /></span>
          <span class="brand__name">Notify <strong>Flow</strong></span>
        </div>
        <q-space />
        <div class="connection-indicator gt-xs">
          <span :class="['status-dot', app.statusLoaded && 'status-dot--online']" />
          {{ app.statusLoaded ? 'Central sincronizada' : 'Sincronizando' }}
        </div>
        <q-btn flat round icon="notifications" aria-label="Notificações do administrador" class="admin-bell">
          <q-badge v-if="unreadAdminNotifications" floating rounded color="negative" :label="unreadAdminNotifications > 99 ? '99+' : unreadAdminNotifications" />
          <q-menu anchor="bottom right" self="top right" :offset="[0, 10]" class="admin-notification-menu">
            <div class="admin-notification-header">
              <div>
                <strong>Atualizações da central</strong>
                <span>{{ unreadAdminNotifications }} não lida(s)</span>
              </div>
              <q-btn v-if="unreadAdminNotifications" flat dense no-caps color="primary" label="Marcar todas" @click.stop="markAllAdminNotificationsRead" />
            </div>
            <q-separator />
            <div v-if="notificationsLoading" class="q-pa-md"><q-skeleton v-for="n in 3" :key="n" type="QItem" /></div>
            <q-list v-else-if="adminNotifications.length" separator class="admin-notification-list">
              <q-item
                v-for="notification in adminNotifications"
                :key="notification.id"
                v-close-popup
                clickable
                :class="{ 'admin-notification--unread': !notification.read }"
                @click="openAdminNotification(notification)"
              >
                <q-item-section avatar>
                  <q-avatar :color="notificationChannelMeta(notification.channel).color" text-color="white" :icon="notificationChannelMeta(notification.channel).icon" />
                </q-item-section>
                <q-item-section>
                  <q-item-label class="text-weight-bold">{{ notification.title }}</q-item-label>
                  <q-item-label caption lines="2">{{ notification.message }}</q-item-label>
                  <div class="admin-notification-meta">
                    <q-badge outline :color="notificationChannelMeta(notification.channel).color" :label="notificationChannelMeta(notification.channel).label" />
                    <time>{{ formatNotificationDate(notification.createdAt) }}</time>
                  </div>
                </q-item-section>
                <q-item-section v-if="!notification.read" side top><span class="unread-dot" /></q-item-section>
              </q-item>
            </q-list>
            <div v-else class="admin-notification-empty">
              <q-icon name="notifications_none" />
              <strong>Nenhuma novidade</strong>
              <span>Contatos cadastrados automaticamente aparecerão aqui.</span>
            </div>
            <q-separator />
            <div class="admin-notification-footer">
              <q-btn
                v-close-popup
                flat
                no-caps
                color="primary"
                icon-right="arrow_forward"
                label="Ver todas"
                @click="openNotificationHistory"
              />
            </div>
          </q-menu>
        </q-btn>
        <q-btn flat round icon="account_circle" aria-label="Menu da conta">
          <q-menu anchor="bottom right" self="top right" :offset="[0, 10]">
            <q-list style="min-width: 220px">
              <q-item>
                <q-item-section>
                  <q-item-label class="text-weight-bold">{{ auth.displayName }}</q-item-label>
                  <q-item-label caption>{{ auth.user?.role || 'Administrador' }}</q-item-label>
                </q-item-section>
              </q-item>
              <q-separator />
              <q-item v-close-popup clickable @click="logout">
                <q-item-section avatar><q-icon name="logout" /></q-item-section>
                <q-item-section>Sair</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
      </q-toolbar>
    </q-header>

    <q-dialog
      v-model="notificationHistoryDialog"
      :maximized="$q.screen.lt.sm"
      transition-show="slide-up"
      transition-hide="slide-down"
    >
      <q-card class="admin-history-dialog">
        <q-card-section class="admin-history-dialog__header">
          <div class="admin-history-title">
            <q-avatar color="primary" text-color="white" icon="notifications_active" />
            <div>
              <h2>Atualizações da central</h2>
              <p>Eventos dos últimos {{ ADMIN_NOTIFICATION_RETENTION_DAYS }} dias · {{ unreadAdminNotifications }} não lida(s)</p>
            </div>
          </div>
          <div class="admin-history-header-actions">
            <q-btn
              v-if="unreadAdminNotifications"
              flat
              dense
              no-caps
              color="primary"
              label="Marcar todas como lidas"
              @click="markAllAdminNotificationsRead"
            />
            <q-btn v-close-popup flat round dense icon="close" aria-label="Fechar atualizações" />
          </div>
        </q-card-section>

        <q-linear-progress v-if="notificationHistoryLoading" indeterminate color="primary" />

        <q-card-section class="admin-history-filters">
          <q-input
            v-model="notificationHistoryFilters.search"
            outlined
            dense
            clearable
            debounce="0"
            label="Buscar por título ou mensagem"
            class="admin-history-filters__search"
            @update:model-value="scheduleNotificationHistorySearch"
          >
            <template #prepend><q-icon name="search" /></template>
          </q-input>
          <q-select
            v-model="notificationHistoryFilters.read"
            :options="ADMIN_NOTIFICATION_READ_OPTIONS"
            emit-value
            map-options
            outlined
            dense
            label="Leitura"
            @update:model-value="reloadNotificationHistory"
          />
          <q-select
            v-model="notificationHistoryFilters.channel"
            :options="notificationChannelOptions"
            emit-value
            map-options
            outlined
            dense
            label="Canal"
            @update:model-value="reloadNotificationHistory"
          />
          <q-select
            v-model="notificationHistoryFilters.kind"
            :options="notificationKindOptions"
            emit-value
            map-options
            outlined
            dense
            label="Tipo"
            @update:model-value="reloadNotificationHistory"
          />
          <q-btn
            flat
            round
            icon="filter_alt_off"
            aria-label="Limpar filtros"
            @click="clearNotificationHistoryFilters"
          >
            <q-tooltip>Limpar filtros</q-tooltip>
          </q-btn>
        </q-card-section>

        <q-banner
          v-if="notificationHistoryError"
          rounded
          class="admin-history-error"
          inline-actions
        >
          <template #avatar><q-icon name="cloud_off" color="negative" /></template>
          {{ notificationHistoryError }}
          <template #action>
            <q-btn flat no-caps color="primary" label="Tentar novamente" @click="loadNotificationHistory()" />
          </template>
        </q-banner>

        <q-card-section class="admin-history-dialog__body">
          <div
            v-if="notificationHistoryLoading && !notificationHistoryItems.length"
            class="admin-history-skeletons"
            aria-label="Carregando atualizações"
          >
            <q-skeleton v-for="n in 5" :key="n" type="QItem" />
          </div>
          <q-list v-else-if="notificationHistoryItems.length" separator class="admin-history-list">
            <q-item
              v-for="notification in notificationHistoryItems"
              :key="notification.id"
              clickable
              :class="{ 'admin-notification--unread': !notification.read }"
              @click="showNotificationDetails(notification)"
            >
              <q-item-section avatar>
                <q-avatar
                  :color="notificationChannelMeta(notification.channel).color"
                  text-color="white"
                  :icon="notificationChannelMeta(notification.channel).icon"
                />
              </q-item-section>
              <q-item-section>
                <q-item-label class="text-weight-bold">{{ notification.title }}</q-item-label>
                <q-item-label caption lines="2">{{ notification.message }}</q-item-label>
                <div class="admin-notification-meta">
                  <q-badge
                    outline
                    :color="notificationChannelMeta(notification.channel).color"
                    :label="notificationChannelMeta(notification.channel).label"
                  />
                  <q-badge outline color="grey-7" :label="adminNotificationKindLabel(notification.kind)" />
                  <time>{{ formatNotificationDate(notification.createdAt) }}</time>
                </div>
              </q-item-section>
              <q-item-section side>
                <span v-if="!notification.read" class="unread-dot" aria-label="Não lida" />
                <q-icon v-else name="chevron_right" color="grey-6" />
              </q-item-section>
            </q-item>
          </q-list>
          <div v-else-if="!notificationHistoryLoading" class="admin-notification-empty admin-history-empty">
            <q-icon name="notifications_none" />
            <strong>Nenhuma atualização encontrada</strong>
            <span>Ajuste os filtros para consultar outros eventos dentro dos últimos 30 dias.</span>
          </div>
        </q-card-section>

        <q-card-actions class="admin-history-dialog__footer">
          <span>{{ notificationHistoryPagination.rowsNumber }} atualização(ões)</span>
          <q-pagination
            v-if="notificationHistoryPages > 1"
            v-model="notificationHistoryPagination.page"
            :max="notificationHistoryPages"
            :max-pages="$q.screen.lt.sm ? 4 : 7"
            boundary-numbers
            direction-links
            color="primary"
            @update:model-value="loadNotificationHistory()"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="notificationDetailsDialog" :maximized="$q.screen.lt.sm">
      <q-card class="admin-notification-details">
        <q-card-section class="admin-notification-details__header">
          <div>
            <div class="text-overline">Detalhes da atualização</div>
            <h3>{{ notificationDetails?.title || 'Atualização' }}</h3>
          </div>
          <q-btn v-close-popup flat round dense icon="close" aria-label="Fechar detalhes" />
        </q-card-section>
        <q-linear-progress v-if="notificationDetailsLoading" indeterminate color="primary" />
        <q-card-section v-if="notificationDetails" class="admin-notification-details__body">
          <div class="admin-notification-meta admin-notification-details__meta">
            <q-badge
              outline
              :color="notificationChannelMeta(notificationDetails.channel).color"
              :label="notificationChannelMeta(notificationDetails.channel).label"
            />
            <q-badge outline color="grey-7" :label="adminNotificationKindLabel(notificationDetails.kind)" />
            <time>{{ formatNotificationDate(notificationDetails.createdAt) }}</time>
          </div>
          <p>{{ notificationDetails.message }}</p>
          <q-expansion-item
            v-if="notificationDetailsContext !== '{}'"
            dense
            expand-separator
            icon="data_object"
            label="Contexto seguro"
            caption="Dados técnicos já protegidos pelo servidor"
          >
            <pre class="admin-notification-context">{{ notificationDetailsContext }}</pre>
          </q-expansion-item>
        </q-card-section>
        <q-card-actions align="right" class="admin-notification-details__actions">
          <q-btn v-close-popup flat no-caps label="Fechar" />
          <q-btn
            v-if="notificationDetails?.contactId"
            unelevated
            no-caps
            color="primary"
            icon="person"
            label="Abrir contato"
            @click="openNotificationContact()"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-drawer
      v-model="drawer"
      show-if-above
      :width="276"
      :breakpoint="1024"
      class="app-drawer"
    >
      <div class="drawer-content">
        <div class="brand drawer-brand">
          <span class="brand__mark"><q-icon name="notifications_active" /></span>
          <span class="brand__name">Notify <strong>Flow</strong></span>
        </div>

        <q-list class="nav-list">
          <template v-for="(item, index) in navigation" :key="item.label || index">
            <div v-if="item.separator" class="nav-section-label">{{ item.label }}</div>
            <q-item
              v-else
              clickable
              :active="$route.path === item.to"
              active-class="nav-item--active"
              :class="[
                'nav-item',
                item.channelColor && `nav-item--${item.channelColor}`,
                { 'nav-item--disabled': !item.available },
              ]"
              :aria-disabled="String(!item.available)"
              @click="goTo(item)"
            >
              <q-tooltip v-if="item.tooltip" :delay="300" anchor="center right" self="center left">
                {{ item.tooltip }}
              </q-tooltip>
              <q-item-section avatar>
                <q-icon :name="item.icon" />
              </q-item-section>
              <q-item-section>
                <q-item-label>{{ item.label }}</q-item-label>
                <q-item-label v-if="item.caption" caption>{{ item.caption }}</q-item-label>
              </q-item-section>
              <q-item-section v-if="!item.available" side>
                <q-icon name="lock" size="16px" />
              </q-item-section>
            </q-item>
          </template>
        </q-list>

        <div class="drawer-footer">
          <q-icon name="security" color="primary" />
          <div>
            <strong>Privacidade ativa</strong>
            <span>Consentimentos validados antes de cada envio.</span>
          </div>
        </div>
      </div>
    </q-drawer>

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<style scoped>
.app-header {
  border-bottom: 1px solid rgba(3, 21, 21, 0.08);
  color: #031515;
}

.app-toolbar {
  min-height: 68px;
  padding-inline: 14px 20px;
}

.app-drawer {
  border-right: 1px solid rgba(3, 21, 21, 0.08);
  background: rgba(249, 255, 253, 0.88);
  backdrop-filter: blur(28px);
}

.drawer-content {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  padding: 22px 16px 16px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand__mark {
  display: grid;
  width: 38px;
  height: 38px;
  border-radius: 13px;
  background: linear-gradient(135deg, #82f8e6, #35bca4);
  box-shadow: 0 9px 24px rgba(53, 188, 164, 0.27);
  color: #031515;
  place-items: center;
}

.brand__name {
  font-size: 1.18rem;
  font-weight: 650;
  letter-spacing: -0.04em;
}

.brand__name strong {
  color: #137d6c;
}

.drawer-brand {
  margin: 0 9px 25px;
}

.brand--compact {
  display: none;
  margin-left: 8px;
}

.nav-list {
  flex: 1;
}

.nav-item {
  min-height: 52px;
  margin: 3px 0;
  border-radius: 14px;
  color: #3a514e;
}

.nav-item .q-icon {
  color: #59706d;
}

.nav-item--active {
  background: linear-gradient(105deg, rgba(130, 248, 230, 0.4), rgba(53, 188, 164, 0.14));
  color: #073b35;
  font-weight: 750;
}

.nav-item--active .q-icon {
  color: #137d6c;
}

.nav-item--whatsapp .q-icon {
  color: #128c6a;
}

.nav-item--telegram .q-icon {
  color: #248bd6;
}

.nav-item--gmail .q-icon {
  color: #d9514e;
}

.nav-item--whatsapp.nav-item--active {
  background: linear-gradient(105deg, rgba(71, 211, 162, 0.26), rgba(18, 140, 106, 0.1));
  color: #086146;
}

.nav-item--telegram.nav-item--active {
  background: linear-gradient(105deg, rgba(91, 184, 245, 0.24), rgba(36, 139, 214, 0.09));
  color: #11669d;
}

.nav-item--gmail.nav-item--active {
  background: linear-gradient(105deg, rgba(242, 130, 126, 0.23), rgba(217, 81, 78, 0.08));
  color: #a93431;
}

.nav-item--whatsapp.nav-item--active .q-icon {
  color: #128c6a;
}

.nav-item--telegram.nav-item--active .q-icon {
  color: #248bd6;
}

.nav-item--gmail.nav-item--active .q-icon {
  color: #d9514e;
}

.nav-item--disabled {
  opacity: 0.55;
}

.nav-section-label {
  margin: 21px 14px 8px;
  color: #78908c;
  font-size: 0.67rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.drawer-footer {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  margin-top: 20px;
  padding: 14px;
  border: 1px solid rgba(53, 188, 164, 0.17);
  border-radius: 16px;
  background: rgba(130, 248, 230, 0.13);
  color: #35524e;
  font-size: 0.78rem;
}

.drawer-footer strong,
.drawer-footer span {
  display: block;
}

.drawer-footer span {
  margin-top: 2px;
  line-height: 1.4;
}

.connection-indicator {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-right: 10px;
  color: #506865;
  font-size: 0.78rem;
}

.admin-bell {
  margin-right: 4px;
}

:global(.admin-notification-menu) {
  width: min(430px, calc(100vw - 20px));
  max-width: calc(100vw - 20px) !important;
  border-radius: 18px;
  overflow: hidden;
}

:global(.admin-notification-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 15px 16px;
}

:global(.admin-notification-header strong),
:global(.admin-notification-header span) {
  display: block;
}

:global(.admin-notification-header span) {
  margin-top: 2px;
  color: #667a77;
  font-size: 0.75rem;
}

:global(.admin-notification-list) {
  max-height: min(520px, 66vh);
  overflow-y: auto;
}

:global(.admin-notification-footer) {
  display: flex;
  justify-content: flex-end;
  padding: 5px 8px;
}

:global(.admin-notification--unread) {
  background: rgba(130, 248, 230, 0.13);
}

:global(.admin-notification-meta) {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 7px;
  color: #6a7d79;
  font-size: 0.68rem;
}

:global(.unread-dot) {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #e0445e;
}

:global(.admin-notification-empty) {
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 34px 24px;
  color: #6b807c;
  text-align: center;
}

:global(.admin-notification-empty .q-icon) {
  color: #35bca4;
  font-size: 38px;
}

:global(.admin-notification-empty strong) {
  color: #294641;
}

:global(.admin-notification-empty span) {
  max-width: 280px;
  font-size: 0.78rem;
}

.admin-history-dialog {
  display: flex;
  width: min(980px, calc(100vw - 32px));
  max-width: min(980px, calc(100vw - 32px)) !important;
  max-height: min(88vh, 860px);
  flex-direction: column;
  border-radius: 24px;
  overflow: hidden;
}

.admin-history-dialog__header,
.admin-history-dialog__footer {
  z-index: 2;
  flex: none;
  background: #fbfffe;
}

.admin-history-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  border-bottom: 1px solid rgba(3, 21, 21, 0.08);
  padding: 18px 20px;
}

.admin-history-title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 13px;
}

.admin-history-title h2,
.admin-history-title p,
.admin-notification-details h3 {
  margin: 0;
}

.admin-history-title h2 {
  font-size: 1.22rem;
  line-height: 1.25;
}

.admin-history-title p {
  margin-top: 3px;
  color: #667a77;
  font-size: 0.76rem;
}

.admin-history-header-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
}

.admin-history-filters {
  display: grid;
  flex: none;
  align-items: center;
  grid-template-columns: minmax(220px, 2fr) repeat(3, minmax(130px, 1fr)) auto;
  gap: 10px;
  border-bottom: 1px solid rgba(3, 21, 21, 0.07);
  padding: 14px 20px;
}

.admin-history-error {
  flex: none;
  margin: 12px 20px 0;
  background: rgba(224, 68, 94, 0.08);
  color: #6f2532;
}

.admin-history-dialog__body {
  min-height: 220px;
  flex: 1 1 auto;
  padding: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.admin-history-list .q-item {
  min-height: 86px;
  padding: 13px 20px;
}

.admin-history-skeletons {
  display: grid;
  gap: 4px;
  padding: 12px 20px;
}

.admin-history-empty {
  min-height: 270px;
  align-content: center;
}

.admin-history-dialog__footer {
  display: flex;
  min-height: 58px;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border-top: 1px solid rgba(3, 21, 21, 0.08);
  padding: 8px 18px;
  color: #667a77;
  font-size: 0.76rem;
}

.admin-notification-details {
  width: min(650px, calc(100vw - 32px));
  max-width: min(650px, calc(100vw - 32px)) !important;
  border-radius: 22px;
  overflow: hidden;
}

.admin-notification-details__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  border-bottom: 1px solid rgba(3, 21, 21, 0.08);
}

.admin-notification-details__header h3 {
  font-size: 1.18rem;
}

.admin-notification-details__body {
  display: grid;
  gap: 18px;
  max-height: min(62vh, 580px);
  overflow-y: auto;
}

.admin-notification-details__body > p {
  margin: 0;
  color: #35524e;
  line-height: 1.6;
  white-space: pre-wrap;
}

.admin-notification-details__meta {
  flex-wrap: wrap;
  margin-top: 0;
}

.admin-notification-context {
  max-height: 320px;
  margin: 0;
  padding: 14px;
  overflow: auto;
  border-radius: 12px;
  background: #062f2b;
  color: #dffaf5;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.admin-notification-details__actions {
  border-top: 1px solid rgba(3, 21, 21, 0.08);
  padding: 12px 16px;
}

@media (max-width: 1023px) {
  .brand--compact {
    display: flex;
  }

  .admin-history-filters {
    grid-template-columns: repeat(2, minmax(0, 1fr)) auto;
  }

  .admin-history-filters__search {
    grid-column: 1 / -2;
  }
}

@media (max-width: 460px) {
  .brand__mark {
    width: 34px;
    height: 34px;
  }

  .admin-history-dialog,
  .admin-notification-details {
    width: 100%;
    max-width: 100% !important;
    max-height: 100%;
    border-radius: 0;
  }

  .admin-history-dialog__header {
    align-items: flex-start;
    padding: 14px 12px;
  }

  .admin-history-title .q-avatar {
    display: none;
  }

  .admin-history-header-actions {
    align-items: flex-start;
  }

  .admin-history-header-actions .q-btn:first-child {
    max-width: 92px;
    font-size: 0.69rem;
  }

  .admin-history-filters {
    grid-template-columns: 1fr 1fr;
    padding: 12px;
  }

  .admin-history-filters__search {
    grid-column: 1 / -1;
  }

  .admin-history-filters > .q-btn {
    justify-self: end;
  }

  .admin-history-list .q-item {
    padding-inline: 12px;
  }

  .admin-history-list .q-item__section--avatar {
    min-width: 48px;
  }

  .admin-history-dialog__footer {
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    padding: 8px;
  }

  .admin-history-dialog__footer > span {
    display: none;
  }
}
</style>
