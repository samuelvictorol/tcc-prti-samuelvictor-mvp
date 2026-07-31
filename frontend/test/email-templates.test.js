import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emailHtmlToPlainText, looksLikeFlattenedEmailHtml } from '../src/services/email-templates.js'

describe('templates HTML de email', () => {
  it('detecta HTML que perdeu os sinais de abertura e fechamento', () => {
    expect(looksLikeFlattenedEmailHtml('div style=background-color:#fff; p Olá /p /div')).toBe(true)
    expect(looksLikeFlattenedEmailHtml('<div style="background-color:#fff"><p>Olá</p></div>')).toBe(false)
    expect(looksLikeFlattenedEmailHtml('Mensagem de texto comum')).toBe(false)
  })

  it('gera o texto alternativo sem duplicar o código HTML', () => {
    expect(emailHtmlToPlainText('<div>Olá, <strong>{{displayName}}</strong>.</div><script>alert(1)</script>'))
      .toBe('Olá, {{displayName}}.')
  })

  it('usa editor de código-fonte e mantém a prévia HTML em tempo real', () => {
    const source = readFileSync(new URL('../src/pages/TemplatesPage.vue', import.meta.url), 'utf8')

    expect(source).toContain('label="Código HTML *"')
    expect(source).toContain('input-class="html-source-editor__input"')
    expect(source).toContain('v-if="flattenedEmailHtml"')
    expect(source).toContain('v-html="safePreview"')
    expect(source).not.toContain('<q-editor v-if="form.channel === \'email\' && form.format === \'html\'"')
  })
})
