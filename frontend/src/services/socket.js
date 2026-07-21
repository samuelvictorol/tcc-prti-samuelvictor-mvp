import { io } from 'socket.io-client'
import { getAccessToken } from './tokens.js'

let socket

function socketOrigin() {
  if (import.meta.env.VITE_SOCKET_URL) return import.meta.env.VITE_SOCKET_URL
  return window.location.origin
}

export function getSocket() {
  if (!socket) {
    socket = io(socketOrigin(), {
      path: '/socket.io',
      autoConnect: false,
      transports: ['websocket', 'polling'],
      auth: (callback) => callback({ token: getAccessToken() }),
    })
  }
  return socket
}

export function connectSocket() {
  const instance = getSocket()
  if (!instance.connected) instance.connect()
  return instance
}

export function disconnectSocket() {
  socket?.disconnect()
}
