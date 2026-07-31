<script setup>
import { computed, ref, watch } from 'vue'
import { copyToClipboard, useQuasar } from 'quasar'
import QRCode from 'qrcode'
import { useRoute } from 'vue-router'
import PublicLegalDialog from '../components/PublicLegalDialog.vue'
import { errorMessage, http, unwrap } from '../services/http.js'
import {
  fallbackLegalDocument,
  inviteChannelPresentation,
  PUBLIC_LEGAL_TYPES,
  safeInviteIconUrl,
} from '../services/public-invites.js'

const route = useRoute()
const $q = useQuasar()
const loading = ref(true)
const error = ref('')
const invite = ref(null)
const legalDialog = ref(false)
const legalAccepted = ref(false)
const pendingLink = ref(null)
const legalLoading = ref(true)
const legalDocuments = ref(PUBLIC_LEGAL_TYPES.map((item) => fallbackLegalDocument(item.type)))
const inviteIconFailed = ref(false)
const qrDialog = ref(false)
const qrLoading = ref(false)
const qrDataUrl = ref('')
const qrTargetUrl = ref('')

function safeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback
}

const gradient = computed(() => {
  const start = safeColor(invite.value?.gradientStart || invite.value?.theme?.gradientStart, '#82F8E6')
  const end = safeColor(invite.value?.gradientEnd || invite.value?.theme?.gradientEnd, '#35BCA4')
  return `linear-gradient(145deg, ${start}, ${end})`
})
const inviteIcon = computed(() => inviteIconFailed.value ? '' : safeInviteIconUrl(invite.value?.iconeUrl))

function iconFor(type) {
  return inviteChannelPresentation(type).icon
}

function toneFor(type) {
  return inviteChannelPresentation(type).tone
}

function channelCaption(type) {
  return inviteChannelPresentation(type).caption
}

async function loadInvite() {
  loading.value = true
  error.value = ''
  invite.value = null
  inviteIconFailed.value = false
  try {
    invite.value = unwrap(await http.get(`/public/invites/${encodeURIComponent(route.params.slug)}`, { params: { token: route.query.token || undefined } }))
    if (!invite.value || invite.value.active === false) throw new Error('Este convite não está disponível.')
  } catch (requestError) {
    error.value = errorMessage(requestError, 'Este convite não foi encontrado ou está inativo.')
  } finally {
    loading.value = false
  }
}

async function loadLegalDocuments() {
  legalLoading.value = true
  const results = await Promise.allSettled(PUBLIC_LEGAL_TYPES.map(async (definition) => (
    unwrap(await http.get(`/public/terms/${definition.type}`))
  )))
  legalDocuments.value = results.map((result, index) => {
    const definition = PUBLIC_LEGAL_TYPES[index]
    return result.status === 'fulfilled' && result.value
      ? { ...result.value, type: definition.type }
      : fallbackLegalDocument(definition.type)
  })
  legalLoading.value = false
}

async function loadPublicRoute() {
  legalDialog.value = false
  legalAccepted.value = false
  pendingLink.value = null
  await Promise.all([loadInvite(), loadLegalDocuments()])
}

async function follow(link) {
  const url = link.trackingUrl
  if (!url) return
  if (!legalAccepted.value) {
    pendingLink.value = link
    legalDialog.value = true
    return
  }
  window.location.assign(url)
}

function openLegalDocuments() {
  pendingLink.value = null
  legalDialog.value = true
}

function onLegalAccepted() {
  legalAccepted.value = true
  const link = pendingLink.value
  pendingLink.value = null
  if (link?.trackingUrl) window.location.assign(link.trackingUrl)
}

async function openQrDialog() {
  qrTargetUrl.value = window.location.href
  qrDataUrl.value = ''
  qrDialog.value = true
  qrLoading.value = true
  try {
    qrDataUrl.value = await QRCode.toDataURL(qrTargetUrl.value, {
      errorCorrectionLevel: 'M',
      width: 360,
      margin: 2,
      color: { dark: '#073b35', light: '#ffffff' },
    })
  } catch {
    qrDialog.value = false
    $q.notify({ type: 'negative', message: 'Não foi possível gerar o QR Code deste convite.' })
  } finally {
    qrLoading.value = false
  }
}

async function copyCurrentInviteUrl() {
  try {
    await copyToClipboard(qrTargetUrl.value)
    $q.notify({ type: 'positive', message: 'Link completo do convite copiado.' })
  } catch {
    $q.notify({ type: 'warning', message: 'Não foi possível copiar o link.' })
  }
}

watch(
  () => [route.params.slug, route.query.token],
  loadPublicRoute,
  { immediate: true },
)
</script>

<template>
  <main class="public-page" :style="{ background: gradient }">
    <q-card v-if="loading" flat class="public-card glass-card"><q-skeleton type="QAvatar" size="64px" class="q-mx-auto" /><q-skeleton type="text" class="q-mt-lg" /><q-skeleton v-for="n in 3" :key="n" type="QBtn" class="q-mt-md" /></q-card>
    <q-card v-else-if="error" flat class="public-card glass-card error-card"><q-icon name="link_off" size="58px" color="negative" /><h1>Convite indisponível</h1><p>{{ error }}</p></q-card>
    <q-card v-else flat class="public-card glass-card">
      <div class="public-logo">
        <img v-if="inviteIcon" :src="inviteIcon" :alt="`Ícone de ${invite.title}`" referrerpolicy="no-referrer" @error="inviteIconFailed = true" />
        <q-icon v-else name="notifications_active" />
      </div>
      <div class="eyebrow">VOCÊ FOI CONVIDADO</div>
      <h1>{{ invite.title }}</h1>
      <p>{{ invite.description }}</p>
      <div class="public-links">
        <q-btn
          v-for="link in (invite.links || []).filter((item) => item.active !== false)"
          :key="link.id || link._id || link.label"
          unelevated
          no-caps
          :class="['public-link', `public-link--${toneFor(link.channel)}`]"
          :aria-label="`${link.label}. ${channelCaption(link.channel)}`"
          @click="follow(link)"
        >
          <span class="public-link__icon" aria-hidden="true">
            <q-icon :name="iconFor(link.channel)" />
          </span>
          <span class="public-link__copy">
            <strong>{{ link.label }}</strong>
            <small>{{ channelCaption(link.channel) }}</small>
          </span>
          <q-icon class="public-link__arrow" name="arrow_forward" aria-hidden="true" />
        </q-btn>
      </div>
      <q-btn
        unelevated
        no-caps
        class="public-profile-link"
        to="/meu-perfil"
        aria-label="Acessar Meu perfil e permissões"
      >
        <span class="public-profile-link__icon" aria-hidden="true"><q-icon name="manage_accounts" /></span>
        <span class="public-profile-link__copy">
          <small>Já possui cadastro?</small>
          <strong>Meu perfil e permissões</strong>
          <span>Revise seus dados, convites e canais autorizados.</span>
        </span>
        <q-icon class="public-profile-link__arrow" name="arrow_forward" aria-hidden="true" />
      </q-btn>
      <div class="privacy-copy"><q-icon name="verified_user" /><span>Escolher um botão apenas abre o serviço. No Telegram, inicie o bot para autorizar esse canal. No WhatsApp, envie o comando informado pelo administrador para autorizar as notificações oficiais.</span></div>
      <div class="public-secondary-actions">
        <q-btn class="public-qr-action" outline no-caps color="primary" icon="qr_code_2" label="QR Code deste convite" @click="openQrDialog" />
      </div>
    </q-card>

    <q-btn
      class="legal-reopen-link"
      flat
      no-caps
      icon="policy"
      label="Termos e Privacidade"
      @click="openLegalDocuments"
    />
    <PublicLegalDialog
      v-model="legalDialog"
      :documents="legalDocuments"
      :loading="legalLoading"
      @accepted="onLegalAccepted"
    />
    <q-dialog v-model="qrDialog">
      <q-card class="public-qr-dialog">
        <q-card-section class="row items-center q-pb-sm">
          <div>
            <div class="text-h6 text-weight-bold">QR Code do convite</div>
            <div class="text-caption text-muted">Inclui o link completo e o token individual, quando houver.</div>
          </div>
          <q-space />
          <q-btn v-close-popup flat round dense icon="close" aria-label="Fechar QR Code" />
        </q-card-section>
        <q-card-section class="public-qr-dialog__content">
          <q-spinner v-if="qrLoading" color="primary" size="48px" />
          <img v-else-if="qrDataUrl" :src="qrDataUrl" alt="QR Code do link completo deste convite" />
          <div class="public-qr-dialog__url">{{ qrTargetUrl }}</div>
        </q-card-section>
        <q-card-actions align="right" class="q-pa-md">
          <q-btn flat no-caps color="primary" icon="content_copy" label="Copiar link" @click="copyCurrentInviteUrl" />
          <q-btn v-close-popup unelevated no-caps color="primary" label="Fechar" />
        </q-card-actions>
      </q-card>
    </q-dialog>
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
  border: 1px solid rgba(255, 255, 255, 0.66);
  border-radius: clamp(24px, 4vw, 34px);
  box-shadow: 0 24px 70px rgba(3, 62, 55, 0.13);
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
  overflow: hidden;
}

.public-logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
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
  gap: 12px;
}

.public-link {
  min-height: 68px;
  padding: 8px 12px;
  border: 1px solid rgba(255, 255, 255, 0.34);
  border-radius: 19px;
  box-shadow: 0 12px 28px rgba(3, 62, 55, 0.13);
  color: #fff !important;
  transition: transform 160ms ease, box-shadow 160ms ease, filter 160ms ease;
}

.public-link:focus-visible {
  outline: 3px solid rgba(255, 255, 255, 0.94);
  outline-offset: 3px;
  box-shadow: 0 16px 34px rgba(3, 62, 55, 0.2);
  filter: saturate(1.08);
  transform: translateY(-2px);
}

.public-link--whatsapp {
  background: linear-gradient(135deg, #075e54 0%, #087e69 56%, #0b7a62 100%) !important;
}

.public-link--telegram {
  background: linear-gradient(135deg, #0e5d88 0%, #116f9e 58%, #167eaa 100%) !important;
}

.public-link--email {
  background: linear-gradient(135deg, #8e2531 0%, #a72f3b 58%, #b83f4a 100%) !important;
}

.public-link--default {
  background: linear-gradient(135deg, #075e54, #0b7a62) !important;
}

.public-link :deep(.q-btn__content),
.public-profile-link :deep(.q-btn__content) {
  width: 100%;
  flex-wrap: nowrap;
  justify-content: flex-start;
}

.public-link__icon,
.public-profile-link__icon {
  display: grid;
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  border: 1px solid rgba(255, 255, 255, 0.26);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.18);
  font-size: 25px;
  place-items: center;
}

.public-link__copy,
.public-profile-link__copy {
  display: grid;
  min-width: 0;
  margin-left: 12px;
  line-height: 1.2;
  text-align: left;
}

.public-link__copy strong {
  font-size: 0.96rem;
  font-weight: 800;
}

.public-link__copy small {
  margin-top: 4px;
  color: rgba(255, 255, 255, 0.83);
  font-size: 0.7rem;
  white-space: normal;
}

.public-link__arrow,
.public-profile-link__arrow {
  flex: 0 0 auto;
  margin-left: auto;
  font-size: 21px;
}

.public-profile-link {
  width: 100%;
  min-height: 82px;
  margin-top: 18px;
  padding: 10px 13px;
  border: 1px solid rgba(5, 103, 91, 0.25);
  border-radius: 20px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(222, 250, 244, 0.96)) !important;
  box-shadow: 0 13px 30px rgba(3, 62, 55, 0.12);
  color: #073b35 !important;
  transition: transform 160ms ease, box-shadow 160ms ease;
}

.public-profile-link:focus-visible {
  outline: 3px solid #087e73;
  outline-offset: 3px;
  box-shadow: 0 17px 38px rgba(3, 62, 55, 0.18);
  transform: translateY(-2px);
}

.public-profile-link__icon {
  border-color: rgba(18, 140, 126, 0.13);
  background: linear-gradient(145deg, #c8f7ec, #83ead7);
  color: #087e73;
}

.public-profile-link__copy small {
  color: #168171;
  font-size: 0.64rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.public-profile-link__copy strong {
  margin-top: 2px;
  font-size: 1rem;
  font-weight: 850;
}

.public-profile-link__copy span {
  margin-top: 4px;
  color: #52716c;
  font-size: 0.7rem;
  white-space: normal;
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

.public-secondary-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 20px;
  flex-wrap: wrap;
}

.public-qr-action {
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.42);
}

.public-qr-dialog {
  width: min(460px, calc(100vw - 28px));
  max-width: 460px;
  border-radius: 22px;
}

.public-qr-dialog__content {
  display: grid;
  min-height: 280px;
  justify-items: center;
  align-content: center;
  gap: 14px;
}

.public-qr-dialog__content img {
  width: min(360px, 100%);
  height: auto;
  border-radius: 16px;
}

.public-qr-dialog__url {
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(3, 21, 21, 0.05);
  color: #536b67;
  font-size: 0.72rem;
  overflow-wrap: anywhere;
}

.error-card h1 {
  margin-top: 20px;
}

.legal-reopen-link {
  position: fixed;
  z-index: 100;
  right: max(14px, env(safe-area-inset-right));
  bottom: max(12px, env(safe-area-inset-bottom));
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 8px 24px rgba(3, 62, 55, 0.12);
  color: #285e56;
  backdrop-filter: blur(14px);
}

@media (max-width: 600px) {
  .public-page {
    padding: 18px 14px 78px;
    place-items: start center;
  }

  .public-card {
    padding: 28px 18px;
    border-radius: 26px;
  }

  .public-link {
    min-height: 66px;
  }

  .public-link__icon,
  .public-profile-link__icon {
    width: 42px;
    height: 42px;
  }

  .public-profile-link {
    min-height: 88px;
  }

  .public-secondary-actions,
  .public-qr-action {
    width: 100%;
  }

  .privacy-copy {
    font-size: 0.72rem;
  }

  .legal-reopen-link {
    right: 50%;
    transform: translateX(50%);
  }
}

@media (hover: hover) and (pointer: fine) {
  .public-link:hover {
    box-shadow: 0 16px 34px rgba(3, 62, 55, 0.2);
    filter: saturate(1.08);
    transform: translateY(-2px);
  }

  .public-profile-link:hover {
    box-shadow: 0 17px 38px rgba(3, 62, 55, 0.18);
    transform: translateY(-2px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .public-link,
  .public-profile-link {
    transition: none;
  }

  .public-link:hover,
  .public-link:focus-visible,
  .public-profile-link:hover,
  .public-profile-link:focus-visible {
    filter: none;
    transform: none;
  }
}
</style>
