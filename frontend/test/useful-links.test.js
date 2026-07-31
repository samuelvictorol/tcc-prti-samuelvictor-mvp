import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  MAX_USEFUL_LINKS,
  createUsefulLink,
  isSafeUsefulLinkUrl,
  normalizeUsefulLinks,
  usefulLinksPayload,
  validateUsefulLinks,
} from '../src/services/useful-links.js'

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../src/${relativePath}`, import.meta.url)), 'utf8')
}

describe('links úteis configuráveis', () => {
  it('normaliza icon como alias, limita a cinco itens e bloqueia protocolos inseguros', () => {
    const links = Array.from({ length: 7 }, (_, index) => ({
      title: `Guia ${index + 1}`,
      caption: '',
      url: `https://example.com/${index + 1}`,
      icon: 'mdi-book-open-page-variant',
    }))

    expect(MAX_USEFUL_LINKS).toBe(5)
    expect(normalizeUsefulLinks(links)).toHaveLength(5)
    expect(normalizeUsefulLinks(links)[0].iconName).toBe('mdi-book-open-page-variant')
    expect(isSafeUsefulLinkUrl('https://example.com/ajuda')).toBe(true)
    expect(isSafeUsefulLinkUrl('javascript:alert(1)')).toBe(false)
  })

  it('valida os campos amigáveis e serializa o contrato canônico iconName', () => {
    const link = createUsefulLink({
      title: 'Documentação',
      caption: 'Primeiros passos',
      url: 'https://example.com/docs',
      iconName: 'mdi-file-document-outline',
    })

    expect(validateUsefulLinks([link])).toBe('')
    expect(usefulLinksPayload([link])).toEqual([link])
    expect(validateUsefulLinks([{ ...link, url: 'ftp://example.com' }])).toContain('HTTP ou HTTPS')
    expect(validateUsefulLinks([{ ...link, iconName: 'material-icon' }])).toContain('ícone MDI')
  })

  it('oferece cadastro, remoção e reordenação responsivos na página Início', () => {
    const home = source('pages/HomePage.vue')

    expect(home).toContain('Navegação personalizada')
    expect(home).toContain('Salvar links úteis')
    expect(home).toContain('@click="moveUsefulLink(index, -1)"')
    expect(home).toContain('@click="removeUsefulLink(index)"')
    expect(home).toContain('settings.usefulLinks.length >= MAX_USEFUL_LINKS')
    expect(home).toContain('.useful-link-editor__fields')
    expect(home).toContain('@media (max-width: 650px)')
  })

  it('exibe Ajuda antes dos links e abre atalhos externos com isolamento de janela', () => {
    const layout = source('layouts/MainLayout.vue')

    expect(layout).toContain("label: 'Úteis'")
    expect(layout.indexOf("label: 'Ajuda'")).toBeLessThan(layout.indexOf('...usefulNavigationLinks.value'))
    expect(layout).toContain('target="_blank"')
    expect(layout).toContain('rel="noopener noreferrer"')
    expect(layout).toContain('normalizeUsefulLinks(app.settings?.usefulLinks)')
  })

  it('carrega MDI v7 e usa os ícones oficiais nos atalhos de canais', () => {
    const main = source('main.js')
    const home = source('pages/HomePage.vue')
    const layout = source('layouts/MainLayout.vue')

    expect(main).toContain("@quasar/extras/mdi-v7/mdi-v7.css")
    expect(main).toContain("@quasar/extras/bootstrap-icons/bootstrap-icons.css")
    for (const icon of ['mdi-whatsapp', 'bi-telegram', 'mdi-gmail']) {
      expect(home).toContain(icon)
      expect(layout).toContain(icon)
    }
    expect(home).toContain('type="button"')
    expect(home).toContain('@click="openChannel(channel)"')
  })
})
