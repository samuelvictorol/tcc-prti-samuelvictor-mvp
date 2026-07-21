import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('axios', () => ({ default: { post: vi.fn() } }))

import axios from 'axios'
import { AUTH_REFRESHED_EVENT, refreshAccessToken } from '../src/services/auth-refresh.js'

function storage() {
  const values = new Map()
  return {
    getItem: vi.fn((key) => values.get(key) || null),
    setItem: vi.fn((key, value) => values.set(key, String(value))),
    removeItem: vi.fn((key) => values.delete(key)),
  }
}

describe('refresh centralizado da sessão', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('localStorage', storage())
    vi.stubGlobal('sessionStorage', storage())
    vi.stubGlobal('CustomEvent', class CustomEvent {
      constructor(type, options = {}) {
        this.type = type
        this.detail = options.detail
      }
    })
    vi.stubGlobal('window', { dispatchEvent: vi.fn() })
  })

  it('compartilha uma única requisição e publica o novo token para o socket', async () => {
    axios.post.mockResolvedValue({ data: { data: { accessToken: 'token-renovado' } } })

    const first = refreshAccessToken()
    const second = refreshAccessToken()
    expect(first).toBe(second)
    await expect(first).resolves.toBe('token-renovado')

    expect(axios.post).toHaveBeenCalledTimes(1)
    expect(sessionStorage.setItem).toHaveBeenCalledWith('notify.accessToken', 'token-renovado')
    expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: AUTH_REFRESHED_EVENT,
      detail: { token: 'token-renovado' },
    }))
  })
})
