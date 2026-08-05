import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../src/${relativePath}`, import.meta.url)), 'utf8')
}

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

function unsignedToken(expiresAt) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(expiresAt / 1000) })).toString('base64url')
  return `${header}.${payload}.signature`
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('acesso publico ao perfil', () => {
  it('persiste a validade, completa Base64URL e remove a sessao automaticamente ao expirar', async () => {
    vi.useFakeTimers()
    const localStorage = memoryStorage()
    const events = []
    vi.stubGlobal('localStorage', localStorage)
    vi.stubGlobal('CustomEvent', class CustomEvent { constructor(type) { this.type = type } })
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      dispatchEvent: (event) => events.push(event.type),
    })
    const profile = await import('../src/services/profile.js')
    const expiresAt = Date.now() + 600_000
    const token = unsignedToken(expiresAt)

    profile.setProfileToken(token)
    expect(profile.getProfileToken()).toBe(token)
    expect(new Date(profile.getProfileExpiresAt()).getTime()).toBe(Math.floor(expiresAt / 1000) * 1000)

    await vi.advanceTimersByTimeAsync(600_100)
    expect(localStorage.getItem('notify.profileAccessToken')).toBeNull()
    expect(localStorage.getItem('notify.profileAccessExpiresAt')).toBeNull()
    expect(events).toContain('notify:profile-session-expired')
  })

  it('mantem rota publica, menu administrativo e UX sem promessa neutra falsa', () => {
    const router = source('router/index.js')
    const layout = source('layouts/MainLayout.vue')
    const profilePage = source('pages/ProfilePage.vue')
    const loginSettings = source('pages/LoginSettingsPage.vue')

    expect(router).toContain("path: '/meu-perfil'")
    expect(router).toContain("meta: { public: true }")
    expect(router).toContain("path: 'logins'")
    expect(layout).toContain("label: 'Logins'")
    expect(profilePage).toContain('/login')
    expect(profilePage).toContain('profileLinkTokenFromFragment')
    expect(profilePage).toContain('window.history.replaceState')
    expect(profilePage).toContain('result.whatsappUrl')
    expect(profilePage).toContain('Se não houver um cadastro único')
    expect(profilePage).not.toContain('a resposta é sempre a mesma')
    expect(profilePage).toContain('historyAudienceLabel')
    expect(profilePage).toContain('Global · via')
    expect(profilePage).not.toContain('Acesso administrativo')
    expect(profilePage).toContain('<div class="auth-icon"><q-icon name="login" /></div>')
    expect(profilePage).toContain('label="Entrar usando"')
    expect(profilePage).toContain("v-if=\"identifierType === 'email'\"")
    expect(profilePage).toContain('type="email"')
    expect(profilePage).toContain('inputmode="email"')
    expect(profilePage).toContain('type="tel"')
    expect(profilePage).toContain('inputmode="tel"')
    expect(profilePage).toContain('setOwnEmailConsent')
    expect(profilePage).toContain('emailConsentDialog')
    expect(profilePage).toContain('O identificador interno do WhatsApp não é usado como telefone.')
    expect(profilePage).toContain('formato seguro <code>/start ...</code>')
    expect(profilePage).toContain('Comandos das suas conversas')
    expect(profilePage).toContain('activationLinks.value?.helpCommands?.whatsapp')
    expect(profilePage).toContain('activationLinks.value?.helpCommands?.telegram')
    expect(profilePage).toContain("command: '/help'")
    expect(profilePage).toContain("command: '/cancelar'")
    expect(profilePage).toContain("command: '/stop'")
    expect(profilePage).toContain("command: '/start'")
    expect(profilePage).toContain('profile-command-grid')
    expect(loginSettings).toContain('/login')
    expect(loginSettings).toContain('dentro da janela oficial')
    expect(loginSettings).toContain('providers.telegram?.configured')
    expect(loginSettings).toContain('template.prerequisite')
    expect(loginSettings).toContain('não depende de template de autenticação da Meta')
  })

  it('usa endpoint dedicado e confirmado para a decisao de email', () => {
    const service = source('services/profile.js')
    expect(service).toContain("post('/my-profile/consents/email', { enabled, confirmed: true })")
  })
})
