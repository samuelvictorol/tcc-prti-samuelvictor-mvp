import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../src/${relativePath}`, import.meta.url)), 'utf8')
}

describe('layout responsivo dos diálogos', () => {
  it('usa altura dinâmica e uma área rolável reutilizável nos diálogos comuns', () => {
    const styles = source('css/app.css')

    expect(styles).toContain('max-height: calc(100dvh - 32px)')
    expect(styles).toContain('max-width: 860px !important')
    expect(styles).toContain('max-width: 720px !important')
    expect(styles).toMatch(/\.dialog-scroll-body\s*\{[\s\S]*?overflow-y:\s*auto/)
    expect(styles).toMatch(/\.dialog-card\s*>\s*\.q-form[\s\S]*?min-height:\s*0/)
  })

  it('maximiza de verdade os construtores grandes conforme o breakpoint do Quasar', () => {
    const files = [
      'components/ContactDialog.vue',
      'components/PublicLegalDialog.vue',
      'pages/ContactsPage.vue',
      'pages/InvitesPage.vue',
      'pages/TelegramPage.vue',
      'pages/TemplatesPage.vue',
      'pages/TermsPage.vue',
      'pages/WhatsappCloudPage.vue',
    ]

    for (const file of files) {
      const content = source(file)
      expect(content, file).not.toContain('maximized-on-mobile')
      expect(content, file).toContain(':maximized="$q.screen.lt.')
    }
  })

  it('mantém cabeçalho, corpo e ações independentes nos diálogos com prévia ou tabela', () => {
    const invites = source('pages/InvitesPage.vue')
    const templates = source('pages/TemplatesPage.vue')
    const cloud = source('pages/WhatsappCloudPage.vue')
    const legal = source('components/PublicLegalDialog.vue')

    expect(invites).toContain('invite-dialog__header')
    expect(invites).toContain('invite-dialog__footer')
    expect(invites).toMatch(/\.invite-builder\s*\{[\s\S]*?overflow:\s*auto/)
    expect(templates).toContain('template-dialog__header')
    expect(templates).toContain('template-dialog__footer')
    expect(templates).toMatch(/\.template-builder\s*\{[\s\S]*?overflow:\s*auto/)
    expect(cloud).toContain('eligibility-dialog__body')
    expect(legal).toContain('public-legal-dialog__scroll')
    expect(legal).toContain('public-legal-dialog__footer')
  })

  it('sobrescreve o limite desktop de 560px aplicado pelo QDialog minimizado', () => {
    expect(source('pages/InvitesPage.vue')).toContain('max-width: 1180px !important')
    expect(source('pages/TemplatesPage.vue')).toContain('max-width: 1280px !important')
    expect(source('pages/TermsPage.vue')).toContain('max-width: 900px !important')
    expect(source('components/ContactDialog.vue')).toContain('max-width: 1040px !important')
    expect(source('components/PublicLegalDialog.vue')).toContain('max-width: 860px !important')
    expect(source('pages/WhatsappCloudPage.vue')).toContain('max-width: 1040px !important')
  })
})
