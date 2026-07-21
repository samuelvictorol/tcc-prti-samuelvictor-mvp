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

  it('expõe IDs da Cloud e do WhatsApp Web sem inventar user_id ausente', () => {
    expect(identityIdentifiers({
      channel: 'whatsapp_cloud',
      address: '5561981748795',
      metadata: { waId: '5561981748795', userId: 'BR.123', phoneNumberId: 'phone-1' },
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'waId', value: '5561981748795' }),
      expect.objectContaining({ key: 'userId', value: 'BR.123' }),
      expect.objectContaining({ key: 'phoneNumberId', value: 'phone-1' }),
    ]))

    expect(identityIdentifiers({
      channel: 'whatsapp_web',
      address: '5561981748795@c.us',
      metadata: { contactUser: '5561981748795' },
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'chatId', value: '5561981748795@c.us' }),
      expect.objectContaining({ key: 'contactId', value: '5561981748795@c.us' }),
      expect.objectContaining({ key: 'contactUser', value: '5561981748795' }),
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
      channel: 'whatsapp_web',
      source: 'whatsapp_web_message',
      metadata: { autoRegisteredVia: 'whatsapp_web' },
      consentSource: 'admin_ui',
      consentCommand: '/notify-me',
    }
    expect(identityRegistrationSource(identity)).toMatchObject({ automatic: true, label: 'WhatsApp Web' })
    expect(identityConsentProvenance(identity)).toMatchObject({
      changedByAdmin: true,
      automaticCommand: true,
      command: '/notify-me',
    })
  })

  it('explica que o comando WhatsApp é compartilhado e preserva o canal em que chegou', () => {
    expect(identityConsentProvenance({
      channel: 'whatsapp_cloud',
      source: 'whatsapp_cloud_webhook',
      consentSource: 'automatic_permission_command',
      consentCommand: '/notify-me',
      metadata: {
        permissionCommandReceivedVia: 'whatsapp_web',
        sharedWhatsappConsent: true,
      },
    })).toMatchObject({
      automaticCommand: true,
      changedByAdmin: false,
      permissionChannel: 'whatsapp_web',
      permissionChannelLabel: 'WhatsApp Web',
      sharedWhatsappGrant: true,
      label: 'Autorizado automaticamente via /notify-me recebido pelo WhatsApp Web (WhatsApp Web + Cloud)',
    })
  })

  it('não rotula um consentimento automático legado de canal único como compartilhado', () => {
    expect(identityConsentProvenance({
      channel: 'whatsapp_web',
      source: 'whatsapp_web_permission_command',
      consentCommand: '/notify-me',
    })).toMatchObject({
      automaticCommand: true,
      permissionChannel: 'whatsapp_web',
      sharedWhatsappGrant: false,
      label: 'Autorizado automaticamente via /notify-me recebido pelo WhatsApp Web',
    })
  })

  it('localiza apenas a intenção pendente do canal WhatsApp solicitado', () => {
    const contact = {
      pendingWhatsappConsents: [{
        channel: 'whatsapp_cloud',
        sourceChannel: 'whatsapp_web',
        status: 'granted',
        command: '/notify-me',
      }],
    }

    expect(pendingWhatsappConsent(contact, 'whatsapp-cloud')).toMatchObject({
      channel: 'whatsapp_cloud',
      sourceChannel: 'whatsapp_web',
    })
    expect(pendingWhatsappConsent(contact, 'whatsapp_web')).toBeNull()
    expect(pendingWhatsappConsent(contact, 'email')).toBeNull()
    expect(pendingWhatsappConsent({
      pendingWhatsappConsents: [{ channel: 'whatsapp_cloud', status: 'revoked' }],
    }, 'whatsapp_cloud')).toBeNull()
  })
})
