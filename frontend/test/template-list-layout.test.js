import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const page = readFileSync(fileURLToPath(new URL('../src/pages/TemplatesPage.vue', import.meta.url)), 'utf8')

describe('ícones da lista de templates', () => {
  it('renderiza um glifo explícito e centralizado dentro de uma caixa uniforme', () => {
    expect(page).toContain('class="template-icon" aria-hidden="true"')
    expect(page).toContain('size="22px"')
    expect(page).toMatch(/\.template-icon\s*\{[\s\S]*?width:\s*44px[\s\S]*?height:\s*44px[\s\S]*?place-items:\s*center/)
    expect(page).toMatch(/\.template-icon\s+:deep\(\.q-icon\)\s*\{[\s\S]*?font-size:\s*22px\s*!important/)
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
