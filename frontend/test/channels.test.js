import { describe, expect, it } from 'vitest'
import {
  channelCredentialPreviews,
  channelSettingsPayload,
  compactChannelSettings,
  generateSecureWebhookSecret,
  isMaskedSecret,
  mergeRevealedChannelValues,
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
    expect(isMaskedSecret('556••••••••9083')).toBe(true)
    expect(isMaskedSecret('556********9083')).toBe(true)
    expect(compactChannelSettings('email', {
      user: 'admin@example.com',
      appPassword: '••••••',
    })).toEqual({ user: 'admin@example.com' })
  })

  it('usa previews mascarados e não reenvia credenciais apenas reveladas', () => {
    expect(channelCredentialPreviews('telegram', {
      previews: {
        botToken: '123••••••••reto',
        webhookSecret: 'web••••••••reto',
      },
    })).toEqual({
      botToken: '123••••••••reto',
    })

    const revealed = {
      botToken: '123:token-real',
    }
    expect(mergeRevealedChannelValues('telegram', revealed, {
      botToken: '123••••••••real',
      webhookSecret: '',
    })).toEqual(revealed)
    expect(channelSettingsPayload('telegram', revealed, revealed)).toBeNull()
    expect(channelSettingsPayload('telegram', {
      ...revealed,
      webhookSecret: 'secret-alterado',
    }, revealed)).toBeNull()
  })

  it('gera webhook secret criptograficamente aleatório sem fallback fraco', () => {
    const cryptoApi = {
      getRandomValues(bytes) {
        bytes.forEach((_value, index) => { bytes[index] = index })
        return bytes
      },
    }
    expect(generateSecureWebhookSecret(cryptoApi, 16))
      .toBe('000102030405060708090a0b0c0d0e0f')
    expect(() => generateSecureWebhookSecret({}, 32)).toThrow('segura indisponível')
    expect(() => generateSecureWebhookSecret(cryptoApi, 8)).toThrow('Tamanho inválido')
  })

  it('mantém número público separado do Phone Number ID no payload do Cloud', () => {
    expect(channelSettingsPayload('whatsappCloud', {
      phoneNumberId: '1000000000000001',
      displayPhoneNumber: '5511931234567',
      configured: true,
    })).toEqual({
      whatsappCloud: {
        phoneNumberId: '1000000000000001',
        displayPhoneNumber: '5511931234567',
      },
    })
  })

  it('não reenvia o preview mascarado do número público ao alterar outro campo', () => {
    expect(channelSettingsPayload('whatsappCloud', {
      phoneNumberId: '1000000000000001',
      displayPhoneNumber: '556••••••••9083',
      businessAccountId: '2000000000000001',
    })).toEqual({
      whatsappCloud: {
        phoneNumberId: '1000000000000001',
        businessAccountId: '2000000000000001',
      },
    })
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
