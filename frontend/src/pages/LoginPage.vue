<script setup>
import { reactive, ref } from 'vue'
import { useQuasar } from 'quasar'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'
import { errorMessage } from '../services/http.js'
import { fetchProfileAccessConfig, safeWhatsappLoginUrl } from '../services/profile.js'

const $q = useQuasar()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const loading = ref(false)
const showPassword = ref(false)
const accessMode = ref('admin')
const userAccessDialog = ref(false)
const accessConfigLoading = ref(false)
const accessConfigLoaded = ref(false)
const accessConfigError = ref('')
const accessConfig = ref({
  profilePath: '/meu-perfil',
  whatsapp: { configured: false, loginUrl: null },
})
const form = reactive({ email: '', password: '', remember: true })

async function loadAccessConfig(force = false) {
  if (accessConfigLoading.value || (accessConfigLoaded.value && !force)) return
  accessConfigLoading.value = true
  accessConfigError.value = ''
  try {
    accessConfig.value = await fetchProfileAccessConfig()
    accessConfigLoaded.value = true
  } catch {
    accessConfigError.value = 'Não foi possível consultar o acesso pelo WhatsApp agora.'
  } finally {
    accessConfigLoading.value = false
  }
}

function selectAdminAccess() {
  accessMode.value = 'admin'
}

function openUserAccess() {
  accessMode.value = 'user'
  userAccessDialog.value = true
  void loadAccessConfig()
}

async function openProfile() {
  userAccessDialog.value = false
  await router.push(accessConfig.value.profilePath || '/meu-perfil')
}

function openWhatsappLogin() {
  const url = safeWhatsappLoginUrl(accessConfig.value.whatsapp?.loginUrl)
  if (!url) return
  const popup = window.open(url, '_blank', 'noopener,noreferrer')
  if (popup) popup.opener = null
}

async function submit() {
  loading.value = true
  try {
    await auth.login(form)
    $q.notify({ type: 'positive', message: 'Bem-vindo à central de notificações.' })
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await router.replace(redirect)
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Email ou senha inválidos.') })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-story" aria-label="Apresentação do produto">
      <div class="story-content">
        <div class="brand-lockup">
          <span class="brand-mark"><q-icon name="notifications_active" size="28px" /></span>
          <span>Notify <strong>Flow</strong></span>
        </div>
        <div class="story-kicker">COMUNICAÇÃO COM CONSENTIMENTO</div>
        <h1>Um fluxo claro para cada mensagem importante.</h1>
        <p>
          Organize contatos, permissões e disparos por Telegram, WhatsApp e email em uma
          única operação auditável.
        </p>
        <div class="story-points">
          <div><q-icon name="verified_user" /><span>Controles de privacidade e LGPD</span></div>
          <div><q-icon name="conversion_path" /><span>Entregas multicanal rastreáveis</span></div>
          <div><q-icon name="shield_lock" /><span>Credenciais protegidas no servidor</span></div>
        </div>
      </div>
      <div class="orb orb--one" />
      <div class="orb orb--two" />
    </section>

    <section class="login-panel">
      <q-card flat class="login-card glass-card">
        <q-card-section class="q-pa-none">
          <div class="mobile-brand">
            <span class="brand-mark"><q-icon name="notifications_active" /></span>
            Notify <strong>Flow</strong>
          </div>
          <div class="login-kicker">ESCOLHA SEU ACESSO</div>
          <h2>Como você quer entrar?</h2>
          <p class="login-copy">Selecione a área adequada para continuar com segurança.</p>

          <div class="access-mode-grid" role="group" aria-label="Tipo de acesso">
            <button
              type="button"
              class="access-mode"
              :class="{ 'access-mode--active': accessMode === 'admin' }"
              :aria-pressed="accessMode === 'admin'"
              @click="selectAdminAccess"
            >
              <span class="access-mode__icon"><q-icon name="admin_panel_settings" /></span>
              <span>
                <strong>Administrador</strong>
                <small>Gerencie canais e campanhas</small>
              </span>
              <q-icon name="check_circle" class="access-mode__check" />
            </button>
            <button
              type="button"
              class="access-mode"
              :class="{ 'access-mode--active': accessMode === 'user' }"
              :aria-pressed="accessMode === 'user'"
              @click="openUserAccess"
            >
              <span class="access-mode__icon access-mode__icon--user"><q-icon name="person" /></span>
              <span>
                <strong>Usuário</strong>
                <small>Acesse dados e permissões</small>
              </span>
              <q-icon name="arrow_outward" class="access-mode__check" />
            </button>
          </div>

          <div v-if="accessMode === 'admin'" class="admin-access">
            <div class="admin-access__heading">
              <strong>Acesso administrativo</strong>
              <span>Use o administrador configurado no ambiente da API.</span>
            </div>
            <q-form class="q-mt-lg" @submit.prevent="submit">
            <q-input
              v-model.trim="form.email"
              outlined
              type="email"
              label="Email"
              autocomplete="username"
              :rules="[(value) => Boolean(value) || 'Informe o email']"
              lazy-rules
            >
              <template #prepend><q-icon name="alternate_email" /></template>
            </q-input>
            <q-input
              v-model="form.password"
              outlined
              :type="showPassword ? 'text' : 'password'"
              label="Senha"
              autocomplete="current-password"
              class="q-mt-sm"
              :rules="[(value) => Boolean(value) || 'Informe a senha']"
              lazy-rules
            >
              <template #prepend><q-icon name="lock" /></template>
              <template #append>
                <q-btn
                  flat
                  round
                  dense
                  :icon="showPassword ? 'visibility_off' : 'visibility'"
                  :aria-label="showPassword ? 'Ocultar senha' : 'Mostrar senha'"
                  @click="showPassword = !showPassword"
                />
              </template>
            </q-input>
            <q-checkbox v-model="form.remember" color="primary" label="Manter acesso neste dispositivo" />
            <q-btn
              type="submit"
              color="dark"
              unelevated
              no-caps
              size="lg"
              class="full-width q-mt-lg"
              label="Entrar com segurança"
              icon-right="arrow_forward"
              :loading="loading"
            />
            </q-form>
            <div class="security-note">
              <q-icon name="encrypted" color="primary" />
              <span>Seu token de acesso é enviado apenas para a API configurada.</span>
            </div>
          </div>
          <div v-else class="user-access-summary">
            <q-icon name="manage_accounts" />
            <div>
              <strong>Área do usuário selecionada</strong>
              <span>Consulte seus dados ou solicite um link rápido pelo WhatsApp.</span>
            </div>
            <q-btn
              outline
              no-caps
              color="primary"
              label="Ver opções"
              @click="openUserAccess"
            />
          </div>
        </q-card-section>
      </q-card>
    </section>

    <q-dialog v-model="userAccessDialog">
      <q-card class="user-access-dialog">
        <q-card-section class="user-access-dialog__header">
          <div class="user-access-dialog__mark">
            <q-icon name="person" />
          </div>
          <div>
            <div class="dialog-kicker">ÁREA DO USUÁRIO</div>
            <h3>Escolha como continuar</h3>
            <p>Revise seu cadastro ou peça ao WhatsApp um link temporário de acesso.</p>
          </div>
          <q-btn v-close-popup flat round dense icon="close" aria-label="Fechar" />
        </q-card-section>

        <q-card-section class="user-access-options">
          <button type="button" class="user-access-option" @click="openProfile">
            <span class="user-access-option__icon"><q-icon name="manage_accounts" /></span>
            <span>
              <strong>Acessar Meu perfil</strong>
              <small>Entre com telefone ou email e gerencie suas permissões.</small>
            </span>
            <q-icon name="arrow_forward" />
          </button>

          <button
            type="button"
            class="user-access-option user-access-option--whatsapp"
            :disabled="accessConfigLoading || !accessConfig.whatsapp.configured"
            @click="openWhatsappLogin"
          >
            <span class="user-access-option__icon"><q-icon name="mdi-whatsapp" /></span>
            <span>
              <strong>Login rápido pelo WhatsApp</strong>
              <small>Abra o número oficial com a mensagem /login já preenchida.</small>
            </span>
            <q-spinner v-if="accessConfigLoading" size="22px" />
            <q-icon v-else name="open_in_new" />
          </button>

          <div
            v-if="!accessConfigLoading && (!accessConfig.whatsapp.configured || accessConfigError)"
            class="access-config-state"
            role="status"
          >
            <q-icon name="info" />
            <span>
              {{ accessConfigError || 'O número público do WhatsApp ainda não foi configurado. Use Meu perfil para continuar.' }}
            </span>
            <q-btn
              v-if="accessConfigError"
              flat
              dense
              no-caps
              color="primary"
              label="Tentar novamente"
              @click="loadAccessConfig(true)"
            />
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </main>
</template>

<style scoped>
.login-page {
  display: grid;
  min-height: 100vh;
  grid-template-columns: minmax(0, 1.08fr) minmax(430px, 0.92fr);
  background: #f6fcfa;
}

.login-story {
  position: relative;
  display: grid;
  min-height: 100vh;
  padding: clamp(42px, 7vw, 96px);
  background:
    linear-gradient(135deg, rgba(3, 21, 21, 0.96), rgba(4, 55, 49, 0.94)),
    #031515;
  color: #effffb;
  overflow: hidden;
  place-items: center start;
}

.story-content {
  position: relative;
  z-index: 2;
  max-width: 680px;
}

.brand-lockup,
.mobile-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 1.24rem;
}

.brand-mark {
  display: grid;
  width: 46px;
  height: 46px;
  border-radius: 15px;
  background: linear-gradient(135deg, #82f8e6, #35bca4);
  box-shadow: 0 12px 32px rgba(53, 188, 164, 0.28);
  color: #031515;
  place-items: center;
}

.story-kicker,
.login-kicker {
  margin-top: clamp(70px, 14vh, 150px);
  color: #82f8e6;
  font-size: 0.72rem;
  font-weight: 850;
  letter-spacing: 0.16em;
}

.login-kicker {
  margin-top: 0;
  color: #137d6c;
}

h1 {
  max-width: 620px;
  margin: 18px 0;
  font-size: clamp(2.6rem, 5.6vw, 5.25rem);
  font-weight: 820;
  letter-spacing: -0.065em;
  line-height: 0.98;
}

.story-content > p {
  max-width: 570px;
  color: rgba(239, 255, 251, 0.74);
  font-size: clamp(1rem, 1.4vw, 1.15rem);
  line-height: 1.65;
}

.story-points {
  display: grid;
  gap: 13px;
  margin-top: 36px;
}

.story-points > div {
  display: flex;
  align-items: center;
  gap: 12px;
  color: rgba(239, 255, 251, 0.82);
}

.story-points .q-icon {
  color: #82f8e6;
}

.orb {
  position: absolute;
  border-radius: 50%;
  background: #35bca4;
  filter: blur(2px);
  opacity: 0.16;
}

.orb--one {
  top: -160px;
  right: -100px;
  width: 440px;
  height: 440px;
}

.orb--two {
  right: 12%;
  bottom: -130px;
  width: 320px;
  height: 320px;
  background: #82f8e6;
}

.login-panel {
  display: grid;
  padding: 30px;
  place-items: center;
}

.login-card {
  width: min(470px, 100%);
  padding: clamp(28px, 4vw, 46px);
}

.mobile-brand {
  display: none;
  margin-bottom: 34px;
  font-weight: 650;
}

.mobile-brand .brand-mark {
  width: 38px;
  height: 38px;
}

h2 {
  margin: 8px 0 0;
  color: #031515;
  font-size: 2rem;
  font-weight: 820;
  letter-spacing: -0.045em;
}

.login-copy {
  margin: 8px 0 0;
  color: #607572;
}

.access-mode-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 24px;
}

.access-mode {
  position: relative;
  display: grid;
  min-width: 0;
  padding: 14px;
  border: 1px solid #d7e6e2;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.72);
  color: #17312d;
  cursor: pointer;
  gap: 10px;
  text-align: left;
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}

.access-mode:hover {
  border-color: #6fd9c7;
  transform: translateY(-1px);
}

.access-mode--active {
  border-color: #35bca4;
  background: linear-gradient(145deg, #effefa, #f9fffd);
  box-shadow: 0 10px 28px rgba(53, 188, 164, 0.12);
}

.access-mode__icon {
  display: grid;
  width: 38px;
  height: 38px;
  border-radius: 13px;
  background: #daf8f1;
  color: #087b68;
  font-size: 21px;
  place-items: center;
}

.access-mode__icon--user {
  background: #eaf2ff;
  color: #2869ae;
}

.access-mode strong,
.access-mode small {
  display: block;
}

.access-mode strong {
  font-size: 0.88rem;
}

.access-mode small {
  margin-top: 3px;
  color: #6a7e7a;
  font-size: 0.69rem;
  line-height: 1.35;
}

.access-mode__check {
  position: absolute;
  top: 13px;
  right: 13px;
  color: #35bca4;
  font-size: 17px;
}

.admin-access {
  margin-top: 24px;
  padding-top: 22px;
  border-top: 1px solid #e0ebe8;
}

.admin-access__heading {
  display: grid;
  gap: 3px;
}

.admin-access__heading strong {
  color: #17312d;
  font-size: 0.88rem;
}

.admin-access__heading span {
  color: #607572;
  font-size: 0.76rem;
}

.user-access-summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  margin-top: 24px;
  padding: 18px;
  border: 1px solid #cdebe5;
  border-radius: 18px;
  background: #f1fcf9;
  color: #116e60;
}

.user-access-summary > .q-icon {
  font-size: 30px;
}

.user-access-summary strong,
.user-access-summary span {
  display: block;
}

.user-access-summary span {
  margin-top: 3px;
  color: #607572;
  font-size: 0.75rem;
}

.user-access-summary .q-btn {
  grid-column: 1 / -1;
}

.security-note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 24px;
  color: #657976;
  font-size: 0.75rem;
  text-align: center;
}

.user-access-dialog {
  width: min(620px, calc(100vw - 32px));
  max-width: 620px;
  border-radius: 26px;
  overflow: hidden;
}

.user-access-dialog__header {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 16px;
  padding: 26px 26px 20px;
  border-bottom: 1px solid #e1ece9;
  background:
    radial-gradient(circle at 8% 0%, rgba(130, 248, 230, 0.28), transparent 38%),
    #fbfffe;
}

.user-access-dialog__mark {
  display: grid;
  width: 52px;
  height: 52px;
  border-radius: 18px;
  background: linear-gradient(145deg, #68e2ce, #35bca4);
  box-shadow: 0 10px 24px rgba(53, 188, 164, 0.2);
  color: #073c34;
  font-size: 26px;
  place-items: center;
}

.dialog-kicker {
  color: #137d6c;
  font-size: 0.68rem;
  font-weight: 850;
  letter-spacing: 0.14em;
}

.user-access-dialog h3 {
  margin: 5px 0 0;
  color: #082b27;
  font-size: 1.48rem;
  line-height: 1.15;
}

.user-access-dialog__header p {
  margin: 7px 0 0;
  color: #607572;
  line-height: 1.5;
}

.user-access-options {
  display: grid;
  gap: 12px;
  padding: 22px 26px 26px;
}

.user-access-option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  width: 100%;
  padding: 16px;
  border: 1px solid #d8e7e3;
  border-radius: 18px;
  background: #fff;
  color: #17312d;
  cursor: pointer;
  gap: 14px;
  text-align: left;
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}

.user-access-option:hover:not(:disabled) {
  border-color: #35bca4;
  box-shadow: 0 10px 28px rgba(31, 121, 105, 0.1);
  transform: translateY(-1px);
}

.user-access-option:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.user-access-option__icon {
  display: grid;
  width: 44px;
  height: 44px;
  border-radius: 15px;
  background: #e6f8f4;
  color: #0b806d;
  font-size: 22px;
  place-items: center;
}

.user-access-option--whatsapp .user-access-option__icon {
  background: #ddf8e8;
  color: #128c4c;
}

.user-access-option strong,
.user-access-option small {
  display: block;
}

.user-access-option small {
  margin-top: 4px;
  color: #657976;
  line-height: 1.4;
}

.access-config-state {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 13px;
  border-radius: 13px;
  background: #fff8e7;
  color: #765a12;
  font-size: 0.76rem;
  line-height: 1.4;
}

.access-config-state span {
  flex: 1;
}

@media (max-width: 900px) {
  .login-page {
    grid-template-columns: 1fr;
  }

  .login-story {
    display: none;
  }

  .login-panel {
    min-height: 100vh;
    padding: 20px;
  }

  .mobile-brand {
    display: flex;
  }
}

@media (max-width: 520px) {
  .login-panel {
    align-items: start;
    padding: 14px;
  }

  .login-card {
    padding: 24px 20px;
  }

  .access-mode-grid {
    grid-template-columns: 1fr;
  }

  .access-mode {
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
  }

  .user-access-dialog {
    width: calc(100vw - 20px);
    border-radius: 22px;
  }

  .user-access-dialog__header {
    grid-template-columns: auto minmax(0, 1fr);
    padding: 20px 18px 16px;
  }

  .user-access-dialog__header > .q-btn {
    position: absolute;
    top: 10px;
    right: 10px;
  }

  .user-access-dialog__mark {
    width: 44px;
    height: 44px;
    border-radius: 15px;
  }

  .user-access-dialog__header p {
    padding-right: 12px;
    font-size: 0.8rem;
  }

  .user-access-options {
    padding: 16px 18px 20px;
  }

  .user-access-option {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .user-access-option > .q-icon,
  .user-access-option > .q-spinner {
    display: none;
  }

  .access-config-state {
    align-items: flex-start;
    flex-wrap: wrap;
  }
}
</style>
