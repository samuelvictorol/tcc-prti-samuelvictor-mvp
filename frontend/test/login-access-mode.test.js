import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  normalizeProfileAccessConfig,
  safeWhatsappLoginUrl,
} from '../src/services/profile.js'

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../src/${relativePath}`, import.meta.url)), 'utf8')
}

describe('escolha de acesso no login', () => {
  it('aceita apenas URL oficial wa.me com telefone e comando /login', () => {
    const valid = 'https://wa.me/5511988887777?text=%2Flogin'
    expect(safeWhatsappLoginUrl(valid)).toBe(valid)
    expect(safeWhatsappLoginUrl('http://wa.me/5511988887777?text=%2Flogin')).toBe('')
    expect(safeWhatsappLoginUrl('https://example.test/5511988887777?text=%2Flogin')).toBe('')
    expect(safeWhatsappLoginUrl('https://wa.me/5511988887777?text=%2Fnotify-me')).toBe('')
    expect(safeWhatsappLoginUrl('https://wa.me/login?text=%2Flogin')).toBe('')
    expect(safeWhatsappLoginUrl('https://wa.me:8443/5511988887777?text=%2Flogin')).toBe('')
    expect(safeWhatsappLoginUrl('https://wa.me/5511988887777?text=%2Flogin#externo')).toBe('')
  })

  it('normaliza resposta publica e desabilita configuracao inconsistente', () => {
    expect(normalizeProfileAccessConfig({
      profilePath: '/meu-perfil',
      whatsapp: {
        configured: true,
        loginUrl: 'https://wa.me/5511988887777?text=%2Flogin',
      },
    })).toEqual({
      profilePath: '/meu-perfil',
      whatsapp: {
        configured: true,
        loginUrl: 'https://wa.me/5511988887777?text=%2Flogin',
      },
    })

    expect(normalizeProfileAccessConfig({
      profilePath: 'https://malicioso.example',
      whatsapp: {
        configured: true,
        loginUrl: 'javascript:alert(1)',
      },
    })).toEqual({
      profilePath: '/meu-perfil',
      whatsapp: { configured: false, loginUrl: null },
    })
  })

  it('mantem formulario administrativo e oferece dialog responsivo para usuario', () => {
    const page = source('pages/LoginPage.vue')
    const service = source('services/profile.js')

    expect(page).toContain('Administrador')
    expect(page).toContain('Usuário')
    expect(page).toContain("accessMode === 'admin'")
    expect(page).toContain('@submit.prevent="submit"')
    expect(page).toContain('Login rápido pelo WhatsApp')
    expect(page).toContain('Acessar Meu perfil')
    expect(page).toContain('O número público do WhatsApp ainda não foi configurado')
    expect(page).toContain("window.open(url, '_blank', 'noopener,noreferrer')")
    expect(page).toContain('popup.opener = null')
    expect(page).toContain('@media (max-width: 520px)')
    expect(page).toContain('mdi-shield-lock-outline')
    expect(page).not.toContain('name="shield_lock"')
    expect(service).toContain("get('/my-profile/access-config')")
  })
})
