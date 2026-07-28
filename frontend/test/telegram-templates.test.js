import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  createTelegramButton,
  createTelegramDefinition,
  createTelegramMenuNode,
  normalizeTelegramDefinition,
  telegramDefinitionBody,
  telegramDefinitionError,
  telegramVariables,
} from '../src/services/telegram-templates.js'

describe('builder amigável de templates Telegram', () => {
  it('não expõe cadastro global, JSON manual ou HTML fora do email', () => {
    const page = readFileSync(new URL('../src/pages/TemplatesPage.vue', import.meta.url), 'utf8')
    expect(page).not.toContain("label: 'Global'")
    expect(page).not.toContain('variantsJson')
    expect(page).not.toContain('payloadJson')
    expect(page).toContain("v-if=\"form.channel === 'email' && form.format === 'html'\"")
    expect(page).toContain('telegramMediaPreview.kind === \'photo\'')
    expect(page).toContain('.preview-frame :deep(img)')
  })

  it('cria os quatro formatos sem payload manual', () => {
    expect(createTelegramDefinition('text')).toMatchObject({ version: 1, kind: 'text', text: '' })
    expect(createTelegramDefinition('photo')).toMatchObject({ version: 1, kind: 'photo', mediaUrl: 'https://' })
    expect(createTelegramDefinition('video')).toMatchObject({ version: 1, kind: 'video', mediaUrl: 'https://' })
    expect(createTelegramDefinition('menu')).toMatchObject({ version: 1, kind: 'menu', nodes: [{ title: 'Menu principal' }] })
  })

  it('normaliza menu salvo e preserva linhas e submenus', () => {
    const root = createTelegramMenuNode({ id: 'inicio', title: 'Início' })
    const child = createTelegramMenuNode({ id: 'ajuda', parentId: 'inicio', title: 'Ajuda' })
    root.rows = [[createTelegramButton('submenu', { id: 'abrir_ajuda', label: 'Abrir ajuda', targetNodeId: child.id })]]
    const definition = normalizeTelegramDefinition({ version: 1, kind: 'menu', rootNodeId: root.id, nodes: [root, child] })

    expect(definition.nodes[0].rows[0][0]).toMatchObject({ action: 'submenu', targetNodeId: 'ajuda' })
    expect(telegramDefinitionBody(definition)).toBe('Início')
    expect(telegramDefinitionError(definition)).toBeNull()
  })

  it('rejeita mídia e links de menu que não usam HTTPS', () => {
    expect(telegramDefinitionError({ version: 1, kind: 'photo', mediaUrl: 'http://example.com/a.jpg', caption: '' })).toMatch(/HTTPS/)
    const menu = {
      version: 1,
      kind: 'menu',
      rootNodeId: 'inicio',
      nodes: [{ id: 'inicio', parentId: null, title: 'Início', text: '', rows: [[{ id: 'site', label: 'Site', action: 'url', url: 'javascript:alert(1)' }]] }],
    }
    expect(telegramDefinitionError(menu)).toMatch(/HTTPS/)
  })

  it('extrai variáveis de texto, caption e páginas automaticamente', () => {
    expect(telegramVariables({
      version: 1,
      kind: 'menu',
      rootNodeId: 'inicio',
      nodes: [{ id: 'inicio', title: 'Olá {{nome}}', text: 'Pedido {{pedido}}', rows: [] }],
    })).toEqual(['nome', 'pedido'])
  })
})
