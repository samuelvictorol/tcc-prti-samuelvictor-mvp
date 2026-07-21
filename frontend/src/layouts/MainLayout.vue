<script setup>
import { computed, onMounted, ref } from 'vue'
import { useQuasar } from 'quasar'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app.js'
import { useAuthStore } from '../stores/auth.js'
import { disconnectSocket } from '../services/socket.js'

const $q = useQuasar()
const router = useRouter()
const app = useAppStore()
const auth = useAuthStore()
const drawer = ref($q.screen.gt.sm)

const navigation = computed(() => [
  { label: 'Início', caption: 'Saúde e configurações', icon: 'space_dashboard', to: '/', available: true },
  { label: 'Contatos', caption: 'Pessoas e grupos', icon: 'group', to: '/contacts', available: true },
  { label: 'Templates', caption: 'Conteúdo por canal', icon: 'dashboard_customize', to: '/templates', available: true },
  { label: 'Notificações', caption: 'Envios e histórico', icon: 'send', to: '/notifications', available: true },
  { separator: true, label: 'Canais' },
  { label: 'Telegram', icon: 'send_to_mobile', to: '/telegram', available: app.isChannelEnabled('telegram') },
  { label: 'WhatsApp Web', icon: 'forum', to: '/whatsapp-web', available: app.isChannelEnabled('whatsappWeb') },
  { label: 'WhatsApp Cloud', icon: 'cloud_sync', to: '/whatsapp-cloud', available: app.isChannelEnabled('whatsappCloud') },
  { label: 'Gmail', icon: 'mail', to: '/email', available: app.isChannelEnabled('email') },
  { separator: true, label: 'Governança' },
  { label: 'Convites', icon: 'link', to: '/invites', available: true },
  { label: 'Termos e LGPD', icon: 'verified_user', to: '/terms', available: true },
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

async function logout() {
  disconnectSocket()
  await auth.logout()
  router.replace({ name: 'login' })
}

onMounted(() => app.fetchStatus())
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
