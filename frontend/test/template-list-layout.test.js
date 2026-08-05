import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const page = readFileSync(fileURLToPath(new URL('../src/pages/TemplatesPage.vue', import.meta.url)), 'utf8')

describe('ícones da lista de templates', () => {
  it('renderiza um glifo explícito e centralizado dentro de uma caixa uniforme', () => {
    expect(page).toContain("['template-icon', `template-icon--${channelTone(props.row.channel || props.row.type)}`]")
    expect(page).toContain('size="22px"')
    expect(page).toMatch(/\.template-icon\s*\{[\s\S]*?width:\s*44px[\s\S]*?height:\s*44px[\s\S]*?place-items:\s*center/)
    expect(page).toMatch(/\.template-icon\s+:deep\(\.q-icon\)\s*\{[\s\S]*?font-size:\s*22px\s*!important/)
  })

  it('usa a identidade oficial e a paleta de cada canal nas abas e linhas', () => {
    expect(page).toContain("icon: 'mdi-whatsapp', tone: 'whatsapp'")
    expect(page).toContain("icon: 'bi-telegram', tone: 'telegram'")
    expect(page).toContain("icon: 'mdi-gmail', tone: 'gmail'")
    expect(page).toContain('template-channel-tab--${channel.tone}')
    expect(page).toContain('template-channel-badge--${channelTone(props.row.channel || props.row.type)}')
    expect(page).toContain(':table-row-class-fn="templateRowClass"')
    expect(page).toMatch(/\.template-icon--whatsapp\s*\{[\s\S]*?color:\s*#128c6a/)
    expect(page).toMatch(/\.template-icon--telegram\s*\{[\s\S]*?color:\s*#248bd6/)
    expect(page).toMatch(/\.template-icon--gmail\s*\{[\s\S]*?color:\s*#d9514e/)
    expect(page).toMatch(/\.template-library-table\s+:deep\(\.template-list-row--whatsapp\)\s*\{[\s\S]*?rgba\(71,\s*211,\s*162/)
    expect(page).toMatch(/\.template-library-table\s+:deep\(\.template-list-row--telegram\)\s*\{[\s\S]*?rgba\(91,\s*184,\s*245/)
    expect(page).toMatch(/\.template-library-table\s+:deep\(\.template-list-row--gmail\)\s*\{[\s\S]*?rgba\(242,\s*130,\s*126/)
  })

  it('separa o texto do avatar para estilos de ellipsis não cortarem o ícone', () => {
    expect(page).toContain('class="template-name__copy"')
    expect(page).toContain('grid-template-columns: 44px minmax(0, 1fr)')
    expect(page).not.toMatch(/\.template-name\s+span\s*\{/)
    expect(page).toMatch(/\.template-name__copy span\s*\{[\s\S]*?text-overflow:\s*ellipsis/)
  })

  it('preserva uma área fixa para o ícone em telas pequenas', () => {
    const mobile = page.slice(page.indexOf('@media (max-width: 600px)'))
    expect(mobile).toContain('grid-template-columns: 42px minmax(0, 1fr)')
    expect(mobile).toContain('min-width: 42px')
    expect(mobile).toContain('min-height: 42px')
  })
})
