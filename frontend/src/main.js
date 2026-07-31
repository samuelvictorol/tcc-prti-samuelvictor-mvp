import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { Quasar, Dialog, Loading, Notify } from 'quasar'
import '@quasar/extras/material-icons/material-icons.css'
import '@quasar/extras/mdi-v7/mdi-v7.css'
import '@quasar/extras/bootstrap-icons/bootstrap-icons.css'
import 'quasar/src/css/index.sass'
import './css/app.css'

import App from './App.vue'
import router from './router/index.js'
import { useAuthStore } from './stores/auth.js'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(Quasar, {
  plugins: { Dialog, Loading, Notify },
  config: {
    brand: {
      primary: '#35BCA4',
      secondary: '#82F8E6',
      dark: '#031515',
    },
    notify: {
      position: 'top-right',
      timeout: 3500,
      progress: true,
    },
  },
})
app.use(router)

window.addEventListener('auth:expired', () => {
  const auth = useAuthStore(pinia)
  auth.clearSession()
  if (router.currentRoute.value.meta.requiresAuth) {
    router.replace({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } })
  }
})

app.mount('#app')
