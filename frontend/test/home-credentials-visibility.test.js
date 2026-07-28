import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const source = readFileSync(
  fileURLToPath(new URL('../src/pages/HomePage.vue', import.meta.url)),
  'utf8',
)

describe('visibilidade das credenciais no Início', () => {
  it('usa uma revelação autenticada e um único controle por canal', () => {
    expect(source).toContain("http.get(`/settings/reveal/${channel}`)")
    expect(source.match(/@click="toggleChannelCredentials\('/g)).toHaveLength(3)
    expect(source).toContain("toggleChannelCredentials('telegram')")
    expect(source).toContain("toggleChannelCredentials('whatsappCloud')")
    expect(source).toContain("toggleChannelCredentials('email')")
    expect(source.match(/\? 'edit_off' : 'edit'/g)).toHaveLength(3)
    expect(source).toContain('Exibir todas as credenciais')
    expect(source).not.toContain('telegramWebhookSecretVisible')
  })

  it('restaura previews ao ocultar e usa apenas telefone fictício no exemplo tocado', () => {
    const visibilityBeforePreview = source.indexOf('channelCredentialsVisible[channel] = false')
    const previewAssignment = source.indexOf("settings[channel][field] = previews[field] || ''")

    expect(visibilityBeforePreview).toBeGreaterThan(-1)
    expect(visibilityBeforePreview).toBeLessThan(previewAssignment)
    expect(source).toContain('settings[channel][field] = savedCredentialPreviews[channel]?.[field]')
    expect(source.match(/\+55 \(11\) 93123-4567/g)).toHaveLength(1)
    expect(source).toContain("'+###############'")
    expect(source).not.toContain("'+## (##) #####-####'")
  })
})
