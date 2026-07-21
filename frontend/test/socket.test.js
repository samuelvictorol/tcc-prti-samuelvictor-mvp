import { beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const handlers = {}
  const windowHandlers = {}
  const socket = {
    connected: false,
    auth: null,
    on: vi.fn((event, handler) => { handlers[event] = handler }),
    connect: vi.fn(function connect() { this.connected = true; return this }),
    disconnect: vi.fn(function disconnect() { this.connected = false; return this }),
  }
  return {
    handlers,
    windowHandlers,
    socket,
    io: vi.fn(() => socket),
    refreshAccessToken: vi.fn(() => Promise.resolve('token-renovado')),
  }
})

vi.mock('socket.io-client', () => ({ io: mocks.io }))
vi.mock('../src/services/tokens.js', () => ({ getAccessToken: () => 'token-atual' }))
vi.mock('../src/services/auth-refresh.js', () => ({
  AUTH_REFRESHED_EVENT: 'auth:refreshed',
  expireSession: vi.fn(),
  refreshAccessToken: mocks.refreshAccessToken,
}))

let socketService

describe('reautenticação do Socket.IO', () => {
  beforeAll(async () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost' },
      addEventListener: vi.fn((event, handler) => { mocks.windowHandlers[event] = handler }),
    })
    socketService = await import('../src/services/socket.js')
  })

  it('renova após desconexão do servidor e reconecta ao receber auth:refreshed', async () => {
    const socket = socketService.connectSocket()
    expect(socket.connected).toBe(true)
    expect(socket.auth).toEqual({ token: 'token-atual' })

    mocks.handlers.disconnect('io server disconnect')
    mocks.handlers.disconnect('io server disconnect')
    expect(mocks.refreshAccessToken).toHaveBeenCalledTimes(1)
    await Promise.resolve()

    mocks.windowHandlers['auth:refreshed']({ detail: { token: 'token-renovado' } })
    expect(socket.auth).toEqual({ token: 'token-renovado' })
    expect(socket.disconnect).toHaveBeenCalledTimes(1)
    expect(socket.connect).toHaveBeenCalledTimes(2)
  })

  it('reconhece falhas de autenticação também no connect_error', () => {
    expect(socketService.isSocketAuthenticationError(new Error('Não autorizado: token expirado'))).toBe(true)
    expect(socketService.isSocketAuthenticationError(new Error('Unauthorized'))).toBe(true)
    expect(socketService.isSocketAuthenticationError(new Error('transport error'))).toBe(false)
    expect(mocks.handlers.connect_error).toBeTypeOf('function')
  })
})
