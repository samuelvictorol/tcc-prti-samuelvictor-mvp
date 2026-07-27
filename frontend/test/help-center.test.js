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
    expect(page).toContain('Do convite ao log de entrega')
    expect(page).toContain('Um fluxo em quatro etapas')
    expect(page).toContain('Um destinatário inválido ou sem consentimento não bloqueia os demais')
  })

  it('explica a jornada pública sem manter o parágrafo longo visível no banner', () => {
    const page = source('pages/HelpPage.vue')
    expect(page).toContain('text="O Notify Flow centraliza canais diferentes')
    expect(page).not.toMatch(/<p>\s*O Notify Flow centraliza canais diferentes/)
    expect(page).toContain("label: 'Contato'")
    expect(page).toContain("label: 'Permissão'")
    expect(page).toContain("label: 'Fila'")
    expect(page).toContain("label: 'Entrega'")
    expect(page).toContain('/meu-perfil')
    expect(page).toContain("to: '/invites'")
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

  it('move instruções operacionais extensas para ajuda contextual', () => {
    const home = source('pages/HomePage.vue')
    const cloud = source('pages/WhatsappCloudPage.vue')
    const forbiddenInlineHints = [
      'hint="Pode ser alterado; /notify-me',
      'hint="O comando recebido no WhatsApp Web ou Cloud',
      'hint="Use v25.0',
      'hint="Usado nos links wa.me',
      'hint="Cadastre esta URL em Meta Developers',
      'hint="Se você colar apenas a URL base do ngrok',
      'hint="Se ficar vazio ao registrar',
      'hint="Identificador técnico fornecido pela Meta',
    ]

    for (const hint of forbiddenInlineHints) expect(home).not.toContain(hint)
    expect(home).toContain('title="Webhook secret do Telegram"')
    expect(home).toContain('title="Callback do WhatsApp Cloud"')
    expect(home).toContain('title="Phone Number ID"')
    expect(cloud).toContain('title="Cadastro pelo webhook"')
    expect(cloud).toContain('title="Eventos seguros do webhook"')
    expect(cloud).not.toContain('<p class="section-copy">Mensagens recebidas cadastram')
    expect(cloud).not.toContain('<p class="section-copy">Status de entrega')
  })

  it('mascara segredo salvo e só copia um valor existente ou recém-gerado', () => {
    const home = source('pages/HomePage.vue')

    expect(home).toContain("const TELEGRAM_WEBHOOK_SECRET_MASK = '••••")
    expect(home).toContain('delete telegramSource.webhookSecret')
    expect(home).toContain('generateSecureWebhookSecret()')
    expect(home).toContain('Por segurança, a API não devolve o segredo já salvo')
    expect(home).toContain('aria-label="Gerar novo webhook secret"')
    expect(home).toContain('aria-label="Copiar webhook secret"')
  })
})
