<script setup>
import { useAuthStore } from '../stores/auth.js'

const auth = useAuthStore()
</script>

<template>
  <main class="not-found">
    <q-card flat class="glass-card not-found__card">
      <div class="error-code">404</div>
      <h1>Esta rota não existe</h1>
      <p>O endereço pode ter mudado ou o conteúdo não está mais disponível.</p>
      <q-btn color="primary" unelevated no-caps icon="arrow_back" :to="auth.isAuthenticated ? '/' : '/login'" label="Voltar ao início" />
    </q-card>
  </main>
</template>

<style scoped>
.not-found {
  display: grid;
  min-height: 100vh;
  padding: 20px;
  place-items: center;
}

.not-found__card {
  width: min(520px, 100%);
  padding: 48px;
  text-align: center;
}

.error-code {
  color: #35bca4;
  font-size: clamp(4rem, 16vw, 8rem);
  font-weight: 900;
  letter-spacing: -0.09em;
  line-height: 0.9;
}

h1 {
  margin: 20px 0 8px;
  font-size: 1.8rem;
}

p {
  margin: 0 0 24px;
  color: #617572;
}
</style>
