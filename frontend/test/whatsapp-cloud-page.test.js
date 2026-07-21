import { describe, expect, it, vi } from 'vitest'

vi.mock('quasar', () => ({ useQuasar: () => ({}) }))

import {
  dispatchDeliveryCount,
  isOfficialCloudTemplateAvailable,
  isCloudContactEligible,
  isCloudSendConfigured,
  normalizeDeliveryIssuePage,
  selectedGroupEligibility,
  templateParameterDefinitions,
} from '../src/pages/WhatsappCloudPage.vue'

const eligibleContact = {
  id: 'contact-1',
  displayName: 'Ana',
  active: true,
  channels: [{ channel: 'whatsapp_cloud', address: '5511999999999', authorized: true, consentStatus: 'granted', source: 'whatsapp_cloud_webhook' }],
}

const deniedContact = {
  id: 'contact-2',
  displayName: 'Bruno',
  active: true,
  channels: [{ channel: 'whatsapp_cloud', address: '5511888888888', authorized: false, consentStatus: 'unknown' }],
}

describe('disparo oficial WhatsApp Cloud', () => {
  it('mantem o webhook independente das credenciais de envio', () => {
    expect(isCloudSendConfigured({ webhookConfigured: true, sendConfigured: false })).toBe(false)
    expect(isCloudSendConfigured({ webhookConfigured: false, sendConfigured: true })).toBe(true)
  })

  it('oferece somente templates oficiais ativos', () => {
    expect(isOfficialCloudTemplateAvailable({
      active: true,
      templateType: 'approved_template',
      externalTemplateName: 'confirmacao_ativa',
    })).toBe(true)
    expect(isOfficialCloudTemplateAvailable({
      active: false,
      templateType: 'approved_template',
      externalTemplateName: 'confirmacao_inativa',
    })).toBe(false)
  })

  it('distingue contatos elegíveis pelo consentimento do canal', () => {
    expect(isCloudContactEligible(eligibleContact)).toBe(true)
    expect(isCloudContactEligible(deniedContact)).toBe(false)
  })

  it('expande grupos e aponta inelegíveis sem bloquear os elegíveis', () => {
    const result = selectedGroupEligibility(
      ['group-1'],
      [{ id: 'group-1', contacts: ['contact-1', 'contact-2', 'missing'] }],
      [eligibleContact, deniedContact],
    )
    expect(result.eligible.map((contact) => contact.id)).toEqual(['contact-1'])
    expect(result.ineligible.map((item) => item.contactId)).toEqual(['contact-2', 'missing'])
  })

  it('lê dinamicamente os campos salvos pelo builder do template', () => {
    const fields = templateParameterDefinitions({
      whatsappCloudPreset: 'custom',
      payload: {
        builder: {
          components: [{ type: 'header', parameters: [{ key: 'arquivo', label: 'Documento', example: 'https://example.com/a.pdf', type: 'document' }] }],
        },
      },
    })
    expect(fields).toEqual([expect.objectContaining({ key: 'arquivo', label: 'Documento', type: 'document', componentType: 'header' })])
  })

  it('expõe cupom de botão copy_code como campo amigável no disparo', () => {
    const fields = templateParameterDefinitions({
      payload: {
        builder: {
          components: [{ type: 'button', subType: 'copy_code', parameters: [{ key: 'cupom', label: 'Código promocional', type: 'coupon_code' }] }],
        },
      },
    })
    expect(fields).toEqual([expect.objectContaining({ key: 'cupom', type: 'coupon_code' })])
  })

  it('normaliza a página remota de falhas e vincula os contatos locais', () => {
    const result = normalizeDeliveryIssuePage({
      items: [{ id: 'issue-1', notificationId: 'notification-1', contactId: 'contact-2', status: 'skipped', errorCode: 'CHANNEL_NOT_AUTHORIZED', errorMessage: 'Sem autorização' }],
      total: 37,
      page: 2,
      limit: 10,
    }, [deniedContact])
    expect(result).toEqual(expect.objectContaining({ total: 37, page: 2, limit: 10 }))
    expect(result.items).toEqual([expect.objectContaining({
      notificationId: 'notification-1',
      contactId: 'contact-2',
      contact: deniedContact,
      errorCode: 'CHANNEL_NOT_AUTHORIZED',
    })])
  })

  it('mantém o resumo do POST independente da presença de deliveries', () => {
    const dispatch = { queuedCount: 12, summary: { skipped: 3, failed: 1 } }
    expect(dispatchDeliveryCount(dispatch, 'queued')).toBe(12)
    expect(dispatchDeliveryCount(dispatch, 'skipped')).toBe(3)
    expect(dispatchDeliveryCount(dispatch, 'failed')).toBe(1)
  })
})
