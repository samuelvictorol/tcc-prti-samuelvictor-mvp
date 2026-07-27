<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useQuasar } from 'quasar'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { useAuthStore } from '../stores/auth.js'
import { connectSocket, disconnectSocket, getSocket } from '../services/socket.js'
import { asList, http, unwrap } from '../services/http.js'
import { normalizeWhatsappWebStatus } from '../services/whatsapp-web.js'

const $q = useQuasar()
const router = useRouter()
const app = useAppStore()
const auth = useAuthStore()
const drawer = ref($q.screen.gt.sm)
const adminNotifications = ref([])
const unreadAdminNotifications = ref(0)
const notificationsLoading = ref(false)

const navigation = computed(() => [
  { label: 'Início', caption: 'Saúde e configurações', icon: 'space_dashboard', to: '/', available: true },
  { label: 'Contatos', caption: 'Pessoas e grupos', icon: 'group', to: '/contacts', available: true },
  { label: 'Templates', caption: 'Conteúdo por canal', icon: 'dashboard_customize', to: '/templates', available: true },
  { label: 'Notificações', caption: 'Envios e histórico', icon: 'send', to: '/notifications', available: true },
  { separator: true, label: 'Canais' },
  { label: 'Telegram', icon: 'send_to_mobile', to: '/telegram', available: app.isChannelEnabled('telegram') },
  {
    label: 'WhatsApp Web',
    caption: app.isChannelEnabled('whatsappWeb') ? 'Monitor conectado' : 'Conecte o QR Code no Início',
    icon: 'forum',
    to: '/whatsapp-web',
    available: app.isChannelEnabled('whatsappWeb'),
  },
  { label: 'WhatsApp Cloud', icon: 'cloud_sync', to: '/whatsapp-cloud', available: true },
  { label: 'Gmail', icon: 'mail', to: '/email', available: app.isChannelEnabled('email') },
  { separator: true, label: 'Governança' },
  { label: 'Convites', icon: 'link', to: '/invites', available: true },
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
    message: `${item.label} ainda não está configurado ou conectado.`,
    caption: 'Configure o canal na página Início.',
  })
}

function notificationChannelMeta(channel) {
  return {
    telegram: { label: 'Telegram', icon: 'send_to_mobile', color: 'info' },
    whatsapp_cloud: { label: 'WhatsApp oficial', icon: 'cloud_sync', color: 'positive' },
    whatsapp_web: { label: 'WhatsApp Web', icon: 'forum', color: 'primary' },
  }[channel] || { label: 'Sistema', icon: 'notifications', color: 'grey-7' }
}

function formatNotificationDate(value) {
  if (!value) return 'agora'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

async function loadAdminNotifications() {
  notificationsLoading.value = true
  try {
    const payload = unwrap(await http.get('/admin-notifications', { params: { page: 1, limit: 20 } })) || {}
    adminNotifications.value = asList(payload, 'items')
    unreadAdminNotifications.value = Number(payload.unread || adminNotifications.value.filter((item) => !item.read).length)
  } catch {
    adminNotifications.value = []
    unreadAdminNotifications.value = 0
  } finally {
    notificationsLoading.value = false
  }
}

function onAdminNotification(notification) {
  if (!notification?.id) return
  const alreadyListed = adminNotifications.value.some((item) => item.id === notification.id)
  adminNotifications.value = [notification, ...adminNotifications.value.filter((item) => item.id !== notification.id)].slice(0, 20)
  if (!alreadyListed && !notification.read) unreadAdminNotifications.value += 1
}

function onSocketReady() {
  loadAdminNotifications()
  app.fetchStatus(true)
}

function onWhatsappWebStatus(payload = {}) {
  const status = normalizeWhatsappWebStatus(payload, app.channelStatus('whatsappWeb'))
  app.updateChannelStatus('whatsappWeb', status)
}

function onWhatsappWebReady(payload = {}) {
  onWhatsappWebStatus({ ...payload, state: 'ready', ready: true, attemptActive: false, qrCode: '' })
}

function onWhatsappWebDisconnected(payload = {}) {
  onWhatsappWebStatus({ ...payload, state: 'disconnected', ready: false, attemptActive: false, qrCode: '' })
}

async function markNotificationRead(notification) {
  if (!notification?.id || notification.read) return
  try {
    await http.post(`/admin-notifications/${notification.id}/read`)
    notification.read = true
    unreadAdminNotifications.value = Math.max(0, unreadAdminNotifications.value - 1)
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
  else if (notification.channel === 'whatsapp_web') await router.push('/whatsapp-web')
  else if (notification.channel === 'whatsapp_cloud') await router.push('/whatsapp-cloud')
}

async function markAllAdminNotificationsRead() {
  try {
    await http.post('/admin-notifications/read-all')
    adminNotifications.value = adminNotifications.value.map((item) => ({ ...item, read: true }))
    unreadAdminNotifications.value = 0
  } catch {
    $q.notify({ type: 'warning', message: 'Não foi possível marcar todas as notificações como lidas.' })
  }
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
  socket.on('whatsapp_web:status', onWhatsappWebStatus)
  socket.on('whatsapp_web:qr', onWhatsappWebStatus)
  socket.on('whatsapp_web:ready', onWhatsappWebReady)
  socket.on('whatsapp_web:disconnected', onWhatsappWebDisconnected)
})

onBeforeUnmount(() => {
  const socket = getSocket()
  socket.off('admin_notification:created', onAdminNotification)
  socket.off('connect', onSocketReady)
  socket.off('system:ready', onSocketReady)
  socket.off('whatsapp_web:status', onWhatsappWebStatus)
  socket.off('whatsapp_web:qr', onWhatsappWebStatus)
  socket.off('whatsapp_web:ready', onWhatsappWebReady)
  socket.off('whatsapp_web:disconnected', onWhatsappWebDisconnected)
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
              :class="['nav-item', { 'nav-item--disabled': !item.available }]"
              :aria-disabled="String(!item.available)"
              @click="goTo(item)"
            >
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

@media (max-width: 1023px) {
  .brand--compact {
    display: flex;
  }
}

@media (max-width: 460px) {
  .brand__mark {
    width: 34px;
    height: 34px;
  }
}
</style>
