<script setup>
import { reactive, ref } from 'vue'
import { useQuasar } from 'quasar'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'
import { errorMessage } from '../services/http.js'

const $q = useQuasar()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const loading = ref(false)
const showPassword = ref(false)
const form = reactive({ email: '', password: '', remember: true })

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
          <div class="login-kicker">ACESSO ADMINISTRATIVO</div>
          <h2>Entre na sua central</h2>
          <p class="login-copy">Use o administrador configurado no ambiente da API.</p>

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
        </q-card-section>
      </q-card>
    </section>
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
</style>
