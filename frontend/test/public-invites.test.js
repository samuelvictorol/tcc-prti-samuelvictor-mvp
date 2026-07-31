import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildTelegramInviteUrl,
  buildWhatsappInviteUrl,
  defaultInviteActionLink,
  fallbackLegalDocument,
  inviteChannelPresentation,
  normalizeWhatsappDisplayPhone,
  PUBLIC_LEGAL_TYPES,
  safeInviteIconUrl,
  slugifyInviteTitle,
} from '../src/services/public-invites.js'

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../src/${relativePath}`, import.meta.url)), 'utf8')
}

describe('convites públicos e documentos LGPD', () => {
  it('gera slug previsível a cada título e mantém um mínimo seguro', () => {
    expect(slugifyInviteTitle('Olá, Mundo!')).toBe('ola-mundo')
    expect(slugifyInviteTitle('A')).toBe('convite-a')
    expect(slugifyInviteTitle('')).toBe('convite-publico')
  })

  it('gera ações oficiais de WhatsApp e Telegram a partir das configurações detectadas', () => {
    expect(inviteChannelPresentation('whatsapp_cloud')).toMatchObject({ icon: 'mdi-whatsapp', tone: 'whatsapp' })
    expect(inviteChannelPresentation('whatsapp-cloud')).toMatchObject({ icon: 'mdi-whatsapp', tone: 'whatsapp' })
    expect(inviteChannelPresentation('telegram')).toMatchObject({ icon: 'bi-telegram', tone: 'telegram' })
    expect(inviteChannelPresentation('email')).toMatchObject({ icon: 'mdi-gmail', tone: 'email' })
    expect(inviteChannelPresentation('canal-personalizado')).toMatchObject({ icon: 'arrow_outward', tone: 'default' })
    expect(normalizeWhatsappDisplayPhone('+55 (11) 93123-4567')).toBe('5511931234567')
    expect(buildWhatsappInviteUrl('+55 (11) 93123-4567', '/notify-me'))
      .toBe('https://wa.me/5511931234567?text=%2Fnotify-me')
    expect(buildWhatsappInviteUrl('', '/quero alertas'))
      .toBe('https://wa.me/?text=%2Fquero%20alertas')
    expect(buildTelegramInviteUrl('@Notify_App_Bot')).toBe('https://t.me/Notify_App_Bot?start=notify-me')
    expect(buildTelegramInviteUrl('@Notify_App_Bot', '/quero alertas'))
      .toBe('https://t.me/Notify_App_Bot?start=quero-alertas')
    expect(buildTelegramInviteUrl('inválido')).toBe('')
    expect(defaultInviteActionLink('whatsapp_cloud', {
      whatsappPhoneNumber: '5511931234567',
      whatsappPermissionCommand: '/notify-me',
    })).toMatchObject({
      label: 'Autorizar WhatsApp',
      url: 'https://wa.me/5511931234567?text=%2Fnotify-me',
      channel: 'whatsapp_cloud',
      _generated: true,
    })
    expect(defaultInviteActionLink('telegram', {
      telegramBotUsername: 'Notify_App_Bot',
      whatsappPermissionCommand: '/quero-alertas',
    })).toMatchObject({
      label: 'Iniciar Telegram',
      url: 'https://t.me/Notify_App_Bot?start=quero-alertas',
      channel: 'telegram',
      _generated: true,
    })
  })

  it('aceita somente ícone HTTPS público sem credenciais ou porta alternativa', () => {
    expect(safeInviteIconUrl('https://cdn.example.com/icon.png')).toBe('https://cdn.example.com/icon.png')
    expect(safeInviteIconUrl('javascript:alert(1)')).toBe('')
    expect(safeInviteIconUrl('data:image/svg+xml,evil')).toBe('')
    expect(safeInviteIconUrl('file:///tmp/icon.png')).toBe('')
    expect(safeInviteIconUrl('http://cdn.example.com/icon.png')).toBe('')
    expect(safeInviteIconUrl('https://user:pass@example.com/icon.png')).toBe('')
    expect(safeInviteIconUrl('https://example.com:8443/icon.png')).toBe('')
    expect(safeInviteIconUrl('https://127.0.0.1/icon.png')).toBe('')
    expect(safeInviteIconUrl('https://192.168.0.8/icon.png')).toBe('')
    expect(safeInviteIconUrl('https://[::1]/icon.png')).toBe('')
  })

  it('oferece estado explícito quando um documento ainda não foi publicado', () => {
    expect(PUBLIC_LEGAL_TYPES.map((item) => item.type)).toEqual([
      'terms_of_use',
      'terms_of_service',
      'privacy_policy',
    ])
    expect(fallbackLegalDocument('privacy_policy')).toMatchObject({
      type: 'privacy_policy',
      title: 'Política de Privacidade',
      fallback: true,
    })
  })

  it('abre os termos somente ao acionar um canal e exige aceite antes do redirecionamento', () => {
    const page = source('pages/PublicInvitePage.vue')
    const dialog = source('components/PublicLegalDialog.vue')

    expect(page).toContain('const legalDialog = ref(false)')
    expect(page).toContain('const legalAccepted = ref(false)')
    expect(page).toContain("() => [route.params.slug, route.query.token]")
    expect(page).toContain('if (!legalAccepted.value)')
    expect(page).toContain('pendingLink.value = link')
    expect(page).toContain('@accepted="onLegalAccepted"')
    expect(page).toContain('window.location.assign(link.trackingUrl)')
    expect(page).toContain('label="Termos e Privacidade"')
    expect(page).toContain('<PublicLegalDialog')
    expect(dialog).toContain('persistent')
    expect(dialog).toContain('no-esc-dismiss')
    expect(dialog).toContain('no-backdrop-dismiss')
    expect(dialog).toContain('public-legal-dialog__scroll')
    expect(dialog).toContain('public-legal-dialog__footer')
    expect(dialog).toContain('Aceitar e continuar')
    expect(dialog).toContain('Aguardando publicação')
    expect(dialog).not.toContain('<q-input')
    expect(dialog).not.toContain('<q-editor')
    expect(page).toMatch(/\.legal-reopen-link\s*\{[\s\S]*?position:\s*fixed/)
  })

  it('mantém slug visual automático e nunca envia slug escolhido pelo navegador', () => {
    const page = source('pages/InvitesPage.vue')
    const payload = page.slice(page.indexOf('const payload = {'), page.indexOf('try {', page.indexOf('const payload = {')))

    expect(page).toContain('form.slug = slugifyInviteTitle(value)')
    expect(page).toContain('label="Slug automático"')
    expect(payload).not.toContain('slug:')
    expect(page).toContain('label="URL HTTPS do ícone"')
    expect(page).toContain('referrerpolicy="no-referrer"')
  })

  it('gera QR somente na tela pública com a URL atual completa e oferece acesso ao perfil', () => {
    const publicPage = source('pages/PublicInvitePage.vue')
    const inviteEditor = source('pages/InvitesPage.vue')

    expect(publicPage).toContain("import QRCode from 'qrcode'")
    expect(publicPage).toContain('qrTargetUrl.value = window.location.href')
    expect(publicPage).toContain('QRCode.toDataURL(qrTargetUrl.value')
    expect(publicPage).toContain('label="QR Code deste convite"')
    expect(publicPage).toContain('to="/meu-perfil"')
    expect(publicPage).toContain('class="public-profile-link"')
    expect(publicPage).toContain('inviteChannelPresentation(type).icon')
    expect(inviteEditor).toContain('preview-profile')
    expect(inviteEditor).toContain('inviteChannelPresentation(link.channel).icon')
    expect(inviteEditor).not.toContain("import QRCode from 'qrcode'")
  })

  it('mantém links editáveis e regenera a ação ao trocar o canal', () => {
    const page = source('pages/InvitesPage.vue')

    expect(page).toContain("defaultInviteActionLink('whatsapp_cloud', inviteActionContext)")
    expect(page).toContain("defaultInviteActionLink('telegram', inviteActionContext)")
    expect(page).toContain("http.get('/telegram/status'")
    expect(page).toContain('configuration.whatsappCloud?.displayPhoneNumber')
    expect(page).toContain('@update:model-value="markLinkEdited(link)"')
    expect(page).toContain('@update:model-value="onLinkChannelChange(link, $event)"')
  })

  it('simplifica o formulário legal para Título e Texto com publicação interna', () => {
    const page = source('pages/TermsPage.vue')
    const builder = page.slice(page.indexOf('<q-card-section class="terms-builder'), page.indexOf('</q-card-section>', page.indexOf('<q-card-section class="terms-builder')))

    expect(builder).toContain('label="Título *"')
    expect(builder).toContain('Texto *')
    expect(builder).not.toContain('form.version')
    expect(builder).not.toContain('form.status')
    expect(builder).not.toContain('form.effectiveAt')
    expect(builder).not.toContain('v-model="form.type"')
    expect(builder).not.toContain('<q-select')
    expect(page).toContain('status: \'published\'')
    expect(page).toContain('terms-dialog__footer')
    expect(page).toContain("params: { status: 'published' }")
    expect(page).not.toContain('label="Novo documento"')
    expect(page).not.toContain('<q-btn-dropdown')
    expect(page).not.toContain('openTerm(null')
  })
})
