import { describe, expect, it } from 'vitest'
import {
  contactIneligibility,
  dispatchDeliveryCount,
  normalizeDeliveryPage,
  normalizeDeliveryIssuePage,
  selectedRecipientsEligibility,
} from '../src/services/bulk-notifications.js'

const contacts = [
  {
    id: 'allowed',
    displayName: 'Autorizado',
    active: true,
    channels: [{ channel: 'telegram', authorized: true, consentStatus: 'granted', address: '100' }],
  },
  {
    id: 'denied',
    displayName: 'Sem permissão',
    active: true,
    channels: [{ channel: 'telegram', authorized: false, consentStatus: 'pending', address: '200' }],
  },
]

describe('bulk notifications helpers', () => {
  it('deduplica contatos diretos e de grupos sem ocultar inelegíveis', () => {
    const result = selectedRecipientsEligibility({
      selectedContactIds: ['allowed'],
      selectedGroupIds: ['group-a'],
      groups: [{ id: 'group-a', contactIds: ['allowed', 'denied', 'missing'] }],
      contacts,
      channel: 'telegram',
    })

    expect(result.contactIds).toEqual(['allowed', 'denied', 'missing'])
    expect(result.eligible.map((contact) => contact.id)).toEqual(['allowed'])
    expect(result.ineligible.map((item) => item.contactId)).toEqual(['denied', 'missing'])
    expect(result.ineligible[0].reason).toContain('não concedida')
  })

  it('explica contato desativado antes da permissão do canal', () => {
    expect(contactIneligibility({ ...contacts[0], notificationDisabled: true }, 'telegram'))
      .toBe('Contato desativado para notificações')
  })

  it('normaliza paginação de falhas e associa o contato', () => {
    const result = normalizeDeliveryIssuePage({
      items: [{ id: 'issue-1', contactId: 'denied', status: 'skipped' }],
      total: 12,
      page: 2,
      limit: 5,
    }, contacts)

    expect(result.total).toBe(12)
    expect(result.page).toBe(2)
    expect(result.items[0].contact.displayName).toBe('Sem permissão')
  })

  it('lê contadores tanto do resumo quanto do formato legado', () => {
    expect(dispatchDeliveryCount({ summary: { queued: 4 } }, 'queued')).toBe(4)
    expect(dispatchDeliveryCount({ skippedCount: 3 }, 'skipped')).toBe(3)
  })

  it('normaliza também as entregas bem-sucedidas do lote', () => {
    const result = normalizeDeliveryPage({
      items: [{ id: 'delivery-1', contactId: 'allowed', status: 'sent', attempts: 1 }],
      total: 1,
    }, contacts)

    expect(result.items[0]).toMatchObject({
      status: 'sent',
      attempts: 1,
      contact: { displayName: 'Autorizado' },
    })
  })
})
