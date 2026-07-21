import { defineStore } from 'pinia'
import { http, unwrap } from '../services/http.js'
import {
  clearStoredSession,
  getAccessToken,
  getStoredUser,
  setAccessToken,
  setStoredUser,
} from '../services/tokens.js'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: getStoredUser(),
    token: getAccessToken(),
    ready: false,
  }),
  getters: {
    isAuthenticated: (state) => Boolean(state.token),
    displayName: (state) => state.user?.name || state.user?.email || 'Administrador',
  },
  actions: {
    async login(credentials) {
      const result = unwrap(await http.post('/auth/login', {
        email: credentials.email,
        password: credentials.password,
      }))
      const token = result?.accessToken || result?.token || result?.jwt
      if (!token) throw new Error('A API não retornou um token de acesso.')
      const user = result.user || { email: credentials.email }
      setAccessToken(token, credentials.remember)
      setStoredUser(user, credentials.remember)
      this.token = token
      this.user = user
      this.ready = true
      return user
    },
    async bootstrap() {
      if (this.ready) return
      if (!this.token) {
        this.ready = true
        return
      }
      try {
        const result = unwrap(await http.get('/auth/me'))
        this.user = result?.user || result
        setStoredUser(this.user, Boolean(localStorage.getItem('notify.accessToken')))
      } catch {
        this.clearSession()
      } finally {
        this.ready = true
      }
    },
    async logout() {
      try {
        await http.post('/auth/logout')
      } catch {
        // A sessão local ainda deve ser encerrada se a API estiver indisponível.
      }
      this.clearSession()
    },
    clearSession() {
      clearStoredSession()
      this.token = null
      this.user = null
      this.ready = true
    },
  },
})
