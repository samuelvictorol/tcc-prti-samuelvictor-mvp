import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../src/${relativePath}`, import.meta.url)), 'utf8')
}

describe('Central de Ajuda', () => {
  it('expõe uma rota autenticada e um item de navegação dedicado', () => {
    expect(source('router/index.js')).toContain("path: 'help'")
    expect(source('router/index.js')).toContain("name: 'help'")
    expect(source('layouts/MainLayout.vue')).toContain("label: 'Ajuda'")
    expect(source('layouts/MainLayout.vue')).toContain("to: '/help'")
  })

  it('mantém o conteúdo explicativo fora das telas operacionais', () => {
    const page = source('pages/HelpPage.vue')
    expect(page).toContain('Da autorização ao log de entrega')
    expect(page).toContain('Um fluxo em quatro etapas')
    expect(page).toContain('Um destinatário inválido ou sem consentimento não bloqueia os demais')
  })

  it('usa meuperfil.png quando disponível e oferece fallback acessível', () => {
    const page = source('pages/HelpPage.vue')
    expect(page).toContain('src="/meuperfil.png"')
    expect(page).toContain('@error="profileImageAvailable = false"')
    expect(page).toContain('Espaço reservado para a imagem da tela Meu perfil')
  })

  it('fornece um ícone help reutilizável com tooltip e diálogo responsivo', () => {
    const component = source('components/ContextHelp.vue')
    expect(source('pages/HelpPage.vue')).toContain("import ContextHelp from '../components/ContextHelp.vue'")
    expect(component).toContain('<q-tooltip')
    expect(component).toContain(':persistent="persistent"')
    expect(component).toContain(':maximized="$q.screen.lt.sm"')
    expect(component).toContain('aria-haspopup="dialog"')
    expect(component).toContain('defineExpose({ open })')
  })
})
