import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const source = readFileSync(
  fileURLToPath(new URL('../src/pages/HomePage.vue', import.meta.url)),
  'utf8',
)

describe('mensagens amigáveis do Telegram no Início', () => {
  it('carrega e salva os quatro textos pelo contrato estruturado da API', () => {
    expect(source).toContain('settings.telegram.messages.onboarding')
    expect(source).toContain('settings.telegram.messages.phoneShare')
    expect(source).toContain('settings.telegram.messages.profile')
    expect(source).toContain('settings.telegram.messages.help')
    expect(source).toContain('telegram: { messages }')
    expect(source).toContain('source.telegram?.messages || messages')
  })

  it('explica os placeholders e mantém editor compacto e responsivo', () => {
    for (const placeholder of ['{name}', '{command}', '{status}', '{invites}']) {
      expect(source).toContain(placeholder)
    }
    expect(source).toContain('telegram-messages-card__grid')
    expect(source).toContain('@media (max-width: 650px)')
    expect(source).toContain("grid-template-columns: 1fr")
  })
})
