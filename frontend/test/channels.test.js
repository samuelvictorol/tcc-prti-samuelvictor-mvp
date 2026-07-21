import { describe, expect, it } from 'vitest'
import {
  channelSettingsPayload,
  compactChannelSettings,
  isMaskedSecret,
  normalizeTelegramWebhookUrl,
  notificationChannel,
  notificationDeliveryCounts,
  sendsToAllAvailableChannels,
} from '../src/services/channels.js'

describe('configuração independente dos canais', () => {
  it('envia somente os campos editáveis do canal escolhido', () => {
    expect(channelSettingsPayload('telegram', {
      botToken: '  token-do-bot  ',
      webhookSecret: '',
      webhookUrl: 'https://exemplo.ngrok.app',
      configured: false,
    })).toEqual({ telegram: { botToken: 'token-do-bot' } })
  })

  it('ignora segredos vazios ou mascarados sem apagar os existentes', () => {
    expect(isMaskedSecret('••••••')).toBe(true)
    expect(compactChannelSettings('email', {
      user: 'admin@example.com',
      appPassword: '••••••',
    })).toEqual({ user: 'admin@example.com' })
  })

  it('completa uma URL base do ngrok com a rota do Telegram', () => {
    expect(normalizeTelegramWebhookUrl('https://notify.ngrok-free.app'))
      .toBe('https://notify.ngrok-free.app/api/webhooks/telegram')
    expect(normalizeTelegramWebhookUrl('https://notify.ngrok-free.app/custom-hook'))
      .toBe('https://notify.ngrok-free.app/custom-hook')
  })

  it('rejeita webhook sem HTTPS', () => {
    expect(() => normalizeTelegramWebhookUrl('http://localhost:8080')).toThrow('HTTPS')
  })

  it('reserva o envio global exclusivamente para templates por canal', () => {
    expect(notificationChannel('quick', 'global')).toBe('global')
    expect(sendsToAllAvailableChannels('quick', 'global')).toBe(false)
    expect(notificationChannel('template', 'telegram')).toBe('telegram')
    expect(sendsToAllAvailableChannels('template', 'telegram')).toBe(false)
    expect(notificationChannel('global', 'telegram')).toBe('global')
  })

  it('distingue entregas enfileiradas das ignoradas', () => {
    expect(notificationDeliveryCounts({
      deliveries: [{ status: 'queued' }, { status: 'skipped' }, { status: 'skipped' }],
    })).toEqual({ queued: 1, skipped: 2 })
    expect(notificationDeliveryCounts({ queuedCount: 0, skippedCount: 3 }))
      .toEqual({ queued: 0, skipped: 3 })
  })
})
