import { describe, expect, it } from 'vitest'
import {
  automaticRegistrationSources,
  identityConsentProvenance,
  identityIdentifiers,
  identityRegistrationSource,
  pendingWhatsappConsent,
} from '../src/services/contact-identities.js'

describe('identidades exibidas dos provedores', () => {
  it('expõe chat_id e user_id do Telegram com o endereço como fallback', () => {
    const identifiers = identityIdentifiers({
      channel: 'telegram',
      address: '99887766',
      metadata: { chatId: '99887766', userId: '99887766' },
    })

    expect(identifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'address', value: '99887766' }),
      expect.objectContaining({ key: 'chatId', value: '99887766' }),
      expect.objectContaining({ key: 'userId', value: '99887766' }),
    ]))
  })

  it('expõe os identificadores oficiais recebidos pelo WhatsApp Cloud', () => {
    expect(identityIdentifiers({
      channel: 'whatsapp_cloud',
      address: '5511931234567',
      metadata: { waId: '5511931234567', userId: 'BR.123', phoneNumberId: 'phone-1' },
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'waId', value: '5511931234567' }),
      expect.objectContaining({ key: 'userId', value: 'BR.123' }),
      expect.objectContaining({ key: 'phoneNumberId', value: 'phone-1' }),
    ]))
  })

  it('identifica a fonte automática pelo source ou metadata', () => {
    const cloud = {
      channel: 'whatsapp_cloud',
      source: 'whatsapp_cloud_permission_command',
      metadata: { autoRegisteredVia: 'whatsapp_cloud' },
    }
    expect(identityRegistrationSource(cloud)).toMatchObject({ automatic: true, label: 'WhatsApp Cloud' })
    expect(automaticRegistrationSources({ channels: [cloud, { channel: 'email', source: 'manual' }] }))
      .toEqual(['WhatsApp Cloud'])
  })

  it('mantém separadas a origem do cadastro e a última decisão de consentimento', () => {
    const identity = {
      channel: 'whatsapp_cloud',
      source: 'whatsapp_cloud_webhook',
      metadata: { autoRegisteredVia: 'whatsapp_cloud' },
      consentSource: 'admin_ui',
      consentCommand: '/notify-me',
    }
    expect(identityRegistrationSource(identity)).toMatchObject({ automatic: true, label: 'WhatsApp Cloud' })
    expect(identityConsentProvenance(identity)).toMatchObject({
      changedByAdmin: true,
      automaticCommand: true,
      command: '/notify-me',
    })
  })

  it('preserva o canal oficial em que o comando de consentimento chegou', () => {
    expect(identityConsentProvenance({
      channel: 'whatsapp_cloud',
      source: 'whatsapp_cloud_webhook',
      consentSource: 'automatic_permission_command',
      consentCommand: '/notify-me',
      metadata: { permissionCommandReceivedVia: 'whatsapp_cloud' },
    })).toMatchObject({
      automaticCommand: true,
      changedByAdmin: false,
      permissionChannel: 'whatsapp_cloud',
      permissionChannelLabel: 'WhatsApp Cloud',
      label: 'Autorizado automaticamente via /notify-me recebido pelo WhatsApp Cloud',
    })
  })

  it('localiza apenas a intenção pendente do canal oficial solicitado', () => {
    const contact = {
      pendingWhatsappConsents: [{
        channel: 'whatsapp_cloud',
        sourceChannel: 'whatsapp_cloud',
        status: 'granted',
        command: '/notify-me',
      }],
    }

    expect(pendingWhatsappConsent(contact, 'whatsapp-cloud')).toMatchObject({
      channel: 'whatsapp_cloud',
      sourceChannel: 'whatsapp_cloud',
    })
    expect(pendingWhatsappConsent(contact, 'email')).toBeNull()
    expect(pendingWhatsappConsent({
      pendingWhatsappConsents: [{ channel: 'whatsapp_cloud', status: 'revoked' }],
    }, 'whatsapp_cloud')).toBeNull()
  })
})
