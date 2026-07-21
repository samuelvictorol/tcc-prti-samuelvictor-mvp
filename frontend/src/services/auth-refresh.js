import axios from 'axios'
import { clearStoredSession, setAccessToken } from './tokens.js'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'
export const AUTH_REFRESHED_EVENT = 'auth:refreshed'
export const AUTH_EXPIRED_EVENT = 'auth:expired'

let refreshRequest = null

function browserEvent(name, detail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

export function publishAuthRefreshed(token) {
  browserEvent(AUTH_REFRESHED_EVENT, { token })
}

export function expireSession() {
  clearStoredSession()
  browserEvent(AUTH_EXPIRED_EVENT)
}

export function refreshAccessToken() {
  refreshRequest ??= axios
    .post(`${API_BASE_URL}/auth/refresh`, {}, { withCredentials: true })
    .then((response) => response.data?.data?.accessToken || response.data?.accessToken || response.data?.token)
    .then((token) => {
      if (!token) throw new Error('Refresh sem novo token')
      const remember = typeof localStorage !== 'undefined' && Boolean(localStorage.getItem('notify.accessToken'))
      setAccessToken(token, remember)
      publishAuthRefreshed(token)
      return token
    })
    .finally(() => {
      refreshRequest = null
    })

  return refreshRequest
}
