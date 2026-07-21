<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { errorMessage, http, unwrap } from '../services/http.js'

const route = useRoute()
const loading = ref(true)
const error = ref('')
const invite = ref(null)

function safeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback
}

const gradient = computed(() => {
  const start = safeColor(invite.value?.gradientStart || invite.value?.theme?.gradientStart, '#82F8E6')
  const end = safeColor(invite.value?.gradientEnd || invite.value?.theme?.gradientEnd, '#35BCA4')
  return `linear-gradient(145deg, ${start}, ${end})`
})

function iconFor(type) {
  return { telegram: 'send_to_mobile', whatsapp_web: 'forum', whatsapp_cloud: 'cloud_sync', email: 'mail' }[type] || 'arrow_outward'
}

async function loadInvite() {
  try {
    invite.value = unwrap(await http.get(`/public/invites/${encodeURIComponent(route.params.slug)}`, { params: { token: route.query.token || undefined } }))
    if (!invite.value || invite.value.active === false) throw new Error('Este convite não está disponível.')
  } catch (requestError) {
    error.value = errorMessage(requestError, 'Este convite não foi encontrado ou está inativo.')
  } finally {
    loading.value = false
  }
}

async function follow(link) {
  const url = link.trackingUrl
  if (!url) return
  window.location.assign(url)
}

onMounted(loadInvite)
</script>

<template>
  <main class="public-page" :style="{ background: gradient }">
    <q-card v-if="loading" flat class="public-card glass-card"><q-skeleton type="QAvatar" size="64px" class="q-mx-auto" /><q-skeleton type="text" class="q-mt-lg" /><q-skeleton v-for="n in 3" :key="n" type="QBtn" class="q-mt-md" /></q-card>
    <q-card v-else-if="error" flat class="public-card glass-card error-card"><q-icon name="link_off" size="58px" color="negative" /><h1>Convite indisponível</h1><p>{{ error }}</p></q-card>
    <q-card v-else flat class="public-card glass-card">
      <div class="public-logo"><q-icon name="notifications_active" /></div>
      <div class="eyebrow">VOCÊ FOI CONVIDADO</div>
      <h1>{{ invite.title }}</h1>
      <p>{{ invite.description }}</p>
      <div class="public-links">
        <q-btn
          v-for="link in (invite.links || []).filter((item) => item.active !== false)"
          :key="link.id || link._id || link.label"
          unelevated
          no-caps
          class="public-link"
          :icon="iconFor(link.channel)"
          icon-right="arrow_forward"
          :label="link.label"
          @click="follow(link)"
        />
      </div>
      <div class="privacy-copy"><q-icon name="verified_user" /><span>Escolher um botão apenas abre o serviço. No Telegram, inicie o bot para autorizar esse canal. No WhatsApp, envie o comando informado pelo administrador para autorizar Web e Cloud.</span></div>
    </q-card>
  </main>
</template>

<style scoped>
.public-page {
  display: grid;
  min-height: 100vh;
  padding: clamp(20px, 5vw, 60px);
  color: #031515;
  place-items: center;
}

.public-card {
  width: min(590px, 100%);
  padding: clamp(28px, 6vw, 56px);
  text-align: center;
}

.public-logo {
  display: grid;
  width: 70px;
  height: 70px;
  margin: 0 auto;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 14px 34px rgba(3, 62, 55, 0.12);
  font-size: 32px;
  place-items: center;
}

.eyebrow {
  margin-top: 24px;
  color: #137d6c;
  font-size: 0.7rem;
  font-weight: 850;
  letter-spacing: 0.16em;
}

h1 {
  margin: 10px 0;
  font-size: clamp(2rem, 7vw, 3.5rem);
  font-weight: 840;
  letter-spacing: -0.065em;
  line-height: 1;
}

.public-card > p {
  margin: 12px auto 25px;
  color: #4f6965;
  font-size: 1rem;
  line-height: 1.6;
}

.public-links {
  display: grid;
  gap: 10px;
}

.public-link {
  min-height: 52px;
  justify-content: space-between;
  border: 1px solid rgba(3, 21, 21, 0.08);
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.86) !important;
  box-shadow: 0 8px 24px rgba(3, 62, 55, 0.08);
  color: #073b35 !important;
}

.privacy-copy {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 25px;
  color: #58706c;
  font-size: 0.7rem;
  line-height: 1.5;
  text-align: left;
}

.error-card h1 {
  margin-top: 20px;
}
</style>
