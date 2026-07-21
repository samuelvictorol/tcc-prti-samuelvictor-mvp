import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../src/${relativePath}`, import.meta.url)), 'utf8')
}

describe('integração visual do monitor WhatsApp Web', () => {
  it('centraliza QR, regeneração e desconexão exclusivamente na Home', () => {
    const home = source('pages/HomePage.vue')
    const monitor = source('pages/WhatsappWebPage.vue')

    expect(home).toContain("'/whatsapp-web/session/regenerate'")
    expect(home).toContain("http.delete('/whatsapp-web/session')")
    expect(home).toContain('QR Code para autenticar o WhatsApp Web')
    expect(monitor).not.toContain("http.post('/whatsapp-web/session')")
    expect(monitor).not.toContain('qrDialog')
    expect(monitor).toContain('Conectar na tela Início')
    expect(home).toContain('Toda interação recebida pelo WhatsApp Web ou Cloud identifica e atualiza o contato')
    expect(home).toContain('o sistema autoriza Web e Cloud para o mesmo contato')
    expect(home).toContain('sem criar um destino que ainda não foi identificado')
  })

  it('bloqueia menu e rota do monitor enquanto a sessão não estiver pronta', () => {
    const layout = source('layouts/MainLayout.vue')
    const router = source('router/index.js')

    expect(layout).toContain("available: app.isChannelEnabled('whatsappWeb')")
    expect(layout).toContain("socket.on('whatsapp_web:disconnected'")
    expect(router).toMatch(/path:\s*'whatsapp-web'[\s\S]*?meta:\s*\{\s*channel:\s*'whatsappWeb'\s*\}/)
    expect(router).toContain("app.fetchStatus(to.meta.channel === 'whatsappWeb')")
  })

  it('acompanha conversas, mensagens e reconexão pelos eventos emitidos pela API', () => {
    const monitor = source('pages/WhatsappWebPage.vue')

    expect(monitor).toContain("socket.on('conversation:message', onConversationMessage)")
    expect(monitor).toContain("socket.on('conversations:updated', onConversationsUpdated)")
    expect(monitor).toContain("socket.on('whatsapp_web:message', onWhatsappProviderMessage)")
    expect(monitor).toContain("socket.on('connect', onSocketConnected)")
    expect(monitor).toContain("socket.on('system:ready', onSocketConnected)")
    expect(monitor).toContain("loadData({ background: true, refreshSelected: true })")
  })

  it('mantém conversa não autorizada visível, mas bloqueia o composer', () => {
    const monitor = source('pages/WhatsappWebPage.vue')

    expect(monitor).toContain('selectedReplyAllowed')
    expect(monitor).toContain('Conversa disponível somente para leitura')
    expect(monitor).toContain('whatsappPermissionCommandFromSettings')
    expect(monitor).toContain('autoriza as duas integrações WhatsApp')
    expect(monitor).toContain('Editar permissão')
  })
})
