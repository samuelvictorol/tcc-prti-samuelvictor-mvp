import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WHATSAPP_PERMISSION_COMMAND,
  isWhatsappWebLog,
  normalizeWhatsappWebStatus,
  shouldShowOperationalLog,
  whatsappPermissionCommandFromSettings,
} from '../src/services/whatsapp-web.js'

describe('estado em tempo real do WhatsApp Web', () => {
  it('normaliza sessão pronta e remove QR já consumido', () => {
    expect(normalizeWhatsappWebStatus({ state: 'ready', qrCode: 'data:image/png;base64,antigo' }))
      .toMatchObject({ ready: true, state: 'ready', qrCode: '', attemptActive: false })
  })

  it('preserva dados anteriores ao receber um evento parcial de QR', () => {
    expect(normalizeWhatsappWebStatus(
      { qrCode: 'data:image/png;base64,novo', state: 'qr', attemptActive: true },
      { configured: true, initialized: true },
    )).toMatchObject({ configured: true, initialized: true, ready: false, state: 'qr', attemptActive: true })
  })

  it('lê o comando novo e mantém /notify-me como padrão', () => {
    expect(whatsappPermissionCommandFromSettings({ configuration: { whatsappPermission: { command: ' /quero-alertas ' } } }))
      .toBe('/quero-alertas')
    expect(whatsappPermissionCommandFromSettings({})).toBe(DEFAULT_WHATSAPP_PERMISSION_COMMAND)
  })

  it('oculta eventos do WhatsApp Web enquanto a sessão está desconectada', () => {
    const wwebLog = { event: 'whatsapp_web.session.error', message: 'Falha no WhatsApp Web' }
    expect(isWhatsappWebLog(wwebLog)).toBe(true)
    expect(shouldShowOperationalLog(wwebLog, false)).toBe(false)
    expect(shouldShowOperationalLog(wwebLog, true)).toBe(true)
    expect(shouldShowOperationalLog({ channel: 'telegram' }, false)).toBe(true)
  })
})
