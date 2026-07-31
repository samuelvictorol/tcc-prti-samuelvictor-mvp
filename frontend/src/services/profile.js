import axios from 'axios'
import { API_BASE_URL } from './http.js'

const PROFILE_TOKEN_KEY = 'notify.profileAccessToken'
const PROFILE_TOKEN_EXPIRES_AT_KEY = 'notify.profileAccessExpiresAt'
let expiryTimer = null

export const profileHttp = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: { Accept: 'application/json' },
})

export function getProfileToken() {
  const token = localStorage.getItem(PROFILE_TOKEN_KEY)
  if (!token) return null
  const expiresAt = getProfileExpiresAt(token)
  if (!expiresAt || new Date(expiresAt).getTime() <= Date.now()) {
    clearProfileSession(true)
    return null
  }
  return token
}

function expiryFromToken(token) {
  try {
    const encoded = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')
    const payload = JSON.parse(atob(padded))
    return Number.isFinite(Number(payload.exp)) ? new Date(Number(payload.exp) * 1000).toISOString() : null
  } catch {
    return null
  }
}

export function getProfileExpiresAt(token = localStorage.getItem(PROFILE_TOKEN_KEY)) {
  return localStorage.getItem(PROFILE_TOKEN_EXPIRES_AT_KEY) || expiryFromToken(token)
}

function scheduleExpiry() {
  if (expiryTimer) window.clearTimeout(expiryTimer)
  expiryTimer = null
  const expiresAt = getProfileExpiresAt()
  if (!expiresAt) return
  const delay = new Date(expiresAt).getTime() - Date.now()
  if (delay <= 0) {
    clearProfileSession(true)
    return
  }
  expiryTimer = window.setTimeout(() => clearProfileSession(true), Math.min(delay + 50, 2_147_483_647))
}

export function setProfileToken(token, expiresAt) {
  if (!token) {
    clearProfileSession()
    return
  }
  const resolvedExpiry = expiresAt || expiryFromToken(token)
  localStorage.setItem(PROFILE_TOKEN_KEY, token)
  if (resolvedExpiry) localStorage.setItem(PROFILE_TOKEN_EXPIRES_AT_KEY, resolvedExpiry)
  else localStorage.removeItem(PROFILE_TOKEN_EXPIRES_AT_KEY)
  if (typeof window !== 'undefined') scheduleExpiry()
}

export function clearProfileSession(notify = false) {
  if (expiryTimer && typeof window !== 'undefined') window.clearTimeout(expiryTimer)
  expiryTimer = null
  localStorage.removeItem(PROFILE_TOKEN_KEY)
  localStorage.removeItem(PROFILE_TOKEN_EXPIRES_AT_KEY)
  if (notify && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('notify:profile-session-expired'))
  }
}

profileHttp.interceptors.request.use((config) => {
  const token = getProfileToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

profileHttp.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !/\/(request-login|exchange-link)$/.test(error.config?.url || '')) {
      clearProfileSession(true)
    }
    return Promise.reject(error)
  },
)

function data(response) {
  return response?.data?.data ?? response?.data ?? response
}

export function safeWhatsappLoginUrl(value) {
  try {
    const url = new URL(String(value || ''))
    const path = url.pathname.replace(/\/+$/, '')
    if (url.protocol !== 'https:' || url.hostname !== 'wa.me' || url.username || url.password) return ''
    if ((url.port && url.port !== '443') || url.hash) return ''
    if (!/^\/[1-9]\d{7,14}$/.test(path)) return ''
    if (url.searchParams.get('text') !== '/login') return ''
    return url.toString()
  } catch {
    return ''
  }
}

export function normalizeProfileAccessConfig(payload = {}) {
  const loginUrl = safeWhatsappLoginUrl(payload?.whatsapp?.loginUrl)
  return {
    profilePath: payload?.profilePath === '/meu-perfil' ? payload.profilePath : '/meu-perfil',
    whatsapp: {
      configured: Boolean(payload?.whatsapp?.configured && loginUrl),
      loginUrl: loginUrl || null,
    },
  }
}

export async function fetchProfileAccessConfig() {
  return normalizeProfileAccessConfig(
    data(await profileHttp.get('/my-profile/access-config')),
  )
}

export async function requestProfileLogin(identifier, identifierType = 'phone') {
  return data(await profileHttp.post('/my-profile/request-login', {
    identifier,
    identifierType,
  }))
}

export async function exchangeProfileLink(token) {
  const result = data(await profileHttp.post('/my-profile/exchange-link', { token }))
  if (result?.accessToken) setProfileToken(result.accessToken, result.expiresAt)
  return result
}

export async function fetchOwnProfile() {
  return data(await profileHttp.get('/my-profile'))
}

export async function updateOwnProfile(input) {
  return data(await profileHttp.patch('/my-profile', input))
}

export async function revokeOwnConsent(channel) {
  return data(await profileHttp.post('/my-profile/consents/revoke', { channel, confirmed: true }))
}

export async function setOwnEmailConsent(enabled) {
  return data(await profileHttp.post('/my-profile/consents/email', { enabled, confirmed: true }))
}

export async function fetchProfileActivationLinks() {
  return data(await profileHttp.get('/my-profile/activation-links'))
}

export async function fetchProfileHistory(params = {}) {
  return data(await profileHttp.get('/my-profile/history', { params }))
}

export async function fetchProfileMemberships() {
  return data(await profileHttp.get('/my-profile/memberships'))
}

export async function fetchOwnGroupDetails(groupId) {
  return data(await profileHttp.get(`/my-profile/groups/${encodeURIComponent(groupId)}`))
}

export async function leaveOwnContactGroup(groupId) {
  return data(await profileHttp.delete(`/my-profile/groups/${encodeURIComponent(groupId)}`, {
    data: { confirmed: true },
  }))
}

export async function removeOwnInviteMembership(inviteId) {
  return data(await profileHttp.delete(`/my-profile/invites/${encodeURIComponent(inviteId)}`, {
    data: { confirmed: true },
  }))
}

if (typeof window !== 'undefined' && localStorage.getItem(PROFILE_TOKEN_KEY)) scheduleExpiry()
