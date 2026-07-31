import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  playAppSound,
  resetAppSoundsForTests,
  soundFile,
} from '../src/services/sounds.js'
import { invitesAreAvailable } from '../src/stores/app.js'

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../src/${relativePath}`, import.meta.url)), 'utf8')
}

afterEach(() => {
  resetAppSoundsForTests()
  vi.unstubAllGlobals()
})

describe('canais e alertas sonoros', () => {
  it('mantém a ordem visual WhatsApp, Telegram e Gmail sem menu Chats', () => {
    const layout = source('layouts/MainLayout.vue')
    const whatsapp = layout.indexOf("label: 'WhatsApp Cloud'")
    const telegram = layout.indexOf("label: 'Telegram'")
    const gmail = layout.indexOf("label: 'Gmail'")

    expect(whatsapp).toBeGreaterThan(-1)
    expect(whatsapp).toBeLessThan(telegram)
    expect(telegram).toBeLessThan(gmail)
    expect(layout).not.toContain("label: 'Chats'")
    expect(layout).toContain("playAppSound('notify')")
    expect(layout).toContain('nav-item--telegram')
    expect(layout).toContain('nav-item--gmail')
  })

  it('libera Convites somente com WhatsApp Cloud e Gmail configurados', () => {
    expect(invitesAreAvailable({
      whatsapp_cloud: { configured: true },
      email: { configured: true },
    })).toBe(true)
    expect(invitesAreAvailable({
      whatsapp_cloud: { configured: true },
      email: { configured: false },
    })).toBe(false)
    expect(invitesAreAvailable({
      channels: {
        whatsappCloud: { ready: true },
        gmail: { enabled: true },
      },
    })).toBe(true)

    const layout = source('layouts/MainLayout.vue')
    const router = source('router/index.js')
    expect(layout).toContain('available: app.canAccessInvites')
    expect(layout).toContain('Para liberar Convites, configure o WhatsApp Cloud e o Gmail')
    expect(layout).toContain('<q-tooltip v-if="item.tooltip"')
    expect(router).toContain('requiresInviteChannels: true')
    expect(router).toContain('if (!app.canAccessInvites)')
  })

  it('mapeia os três arquivos públicos e ignora falhas de reprodução', async () => {
    const play = vi.fn().mockRejectedValue(Object.assign(new Error('blocked'), { name: 'NotSupportedError' }))
    vi.stubGlobal('Audio', vi.fn(() => ({ play, currentTime: 0, preload: '', volume: 1 })))

    expect(soundFile('notify')).toBe('/notify.mp3')
    expect(soundFile('whatsapp')).toBe('/whatsapp.mp3')
    expect(soundFile('telegram')).toBe('/telegram.mp3')
    expect(readFileSync(fileURLToPath(new URL('../public/whatsapp.mp3', import.meta.url))).byteLength)
      .toBeLessThan(64 * 1024)
    await expect(playAppSound('notify')).resolves.toBe(false)
  })

  it('toca sons de chat somente nos respectivos fluxos em tempo real', () => {
    expect(source('pages/ChatsPage.vue')).toContain("playAppSound('whatsapp')")
    expect(source('pages/TelegramPage.vue')).toContain("playAppSound('telegram')")
    expect(source('pages/TelegramPage.vue')).toContain("tab.value === 'chats'")
  })

  it('mantém conversas Telegram sem opt-in visíveis, mas bloqueia o composer', () => {
    const telegram = source('pages/TelegramPage.vue')

    expect(telegram).toContain('!chatIsAuthorized(selected)')
    expect(telegram).toContain(':disable="!chatIsAuthorized(selected)"')
    expect(telegram).toContain('ainda não autorizou notificações pelo Telegram')
  })

  it('aplica a identidade visual azul no Telegram e vermelha no Gmail', () => {
    const telegram = source('pages/TelegramPage.vue')
    const gmail = source('pages/EmailPage.vue')

    expect(telegram).toContain('telegram-channel-page')
    expect(telegram).toContain('--q-primary: #229ed9')
    expect(telegram).not.toContain('color="primary"')
    expect(gmail).toContain('email-channel-page')
    expect(gmail).toContain('--q-primary: #d93025')
    expect(gmail).toContain('.email-channel-page :deep(.q-btn.bg-dark)')
  })
})
