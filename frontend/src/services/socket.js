import { io } from 'socket.io-client'
import { getAccessToken } from './tokens.js'
import {
  AUTH_REFRESHED_EVENT,
  expireSession,
  refreshAccessToken,
} from './auth-refresh.js'

let socket
let refreshAfterDisconnect = null
let authEventListenerInstalled = false

function socketOrigin() {
  if (import.meta.env.VITE_SOCKET_URL) return import.meta.env.VITE_SOCKET_URL
  return window.location.origin
}

export function shouldRefreshAfterSocketDisconnect(reason) {
  return reason === 'io server disconnect'
}

export function isSocketAuthenticationError(error) {
  return /n[aã]o autorizado|unauthori[sz]ed|jwt|token/i.test(String(error?.message || error || ''))
}

function reconnectWithToken(token) {
  if (!socket || !token) return
  socket.auth = { token }
  if (socket.connected) socket.disconnect()
  if (!socket.connected) socket.connect()
}

function onAuthRefreshed(event) {
  reconnectWithToken(event?.detail?.token || getAccessToken())
}

function installAuthEventListener() {
  if (authEventListenerInstalled || typeof window === 'undefined') return
  window.addEventListener(AUTH_REFRESHED_EVENT, onAuthRefreshed)
  authEventListenerInstalled = true
}

function refreshSocketAuthentication() {
  if (refreshAfterDisconnect) return refreshAfterDisconnect
  refreshAfterDisconnect = refreshAccessToken()
    .catch(() => {
      socket?.disconnect()
      expireSession()
    })
    .finally(() => {
      refreshAfterDisconnect = null
    })
  return refreshAfterDisconnect
}

function recoverExpiredSocket(reason) {
  if (!shouldRefreshAfterSocketDisconnect(reason)) return
  refreshSocketAuthentication()
}

function recoverSocketConnectionError(error) {
  if (!isSocketAuthenticationError(error)) return
  refreshSocketAuthentication()
}

export function getSocket() {
  if (!socket) {
    socket = io(socketOrigin(), {
      path: '/socket.io',
      autoConnect: false,
      transports: ['websocket', 'polling'],
      auth: (callback) => callback({ token: getAccessToken() }),
    })
    socket.on('disconnect', recoverExpiredSocket)
    socket.on('connect_error', recoverSocketConnectionError)
    installAuthEventListener()
  }
  return socket
}

export function connectSocket() {
  const instance = getSocket()
  instance.auth = { token: getAccessToken() }
  if (!instance.connected) instance.connect()
  return instance
}

export function disconnectSocket() {
  socket?.disconnect()
}
