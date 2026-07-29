import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('quasar', () => ({ useQuasar: () => ({}) }))

import {
  contactAuthorizationValidation,
  contactConsentProvenance,
} from '../src/components/ContactDialog.vue'

describe('autorizações manuais do contato', () => {
  it('exige telefone ao habilitar WhatsApp Cloud', () => {
    expect(contactAuthorizationValidation({
      phone: '',
      consents: { whatsappCloud: true },
    })).toContain('Informe um telefone')
    expect(contactAuthorizationValidation({
      phone: '5511931234567',
      consents: { whatsappCloud: true },
    })).toBeNull()
  })

  it('aceita a decisão automática pendente da Cloud sem inventar um telefone', () => {
    expect(contactAuthorizationValidation({
      phone: '',
      consents: { whatsappCloud: true },
      hasPendingWhatsappCloud: true,
    })).toBeNull()
  })

  it('expõe a proveniência automática e a última alteração administrativa', () => {
    expect(contactConsentProvenance({
      channel: 'whatsapp_cloud',
      source: 'whatsapp_cloud_permission_command',
      consentCommand: '/notify-me',
    })).toMatchObject({
      automaticCommand: true,
      changedByAdmin: false,
      permissionChannel: 'whatsapp_cloud',
      permissionChannelLabel: 'WhatsApp Cloud',
      label: 'Autorizado automaticamente via /notify-me recebido pelo WhatsApp Cloud',
    })
    expect(contactConsentProvenance({
      consentSource: 'admin_ui',
      consentChangedAt: '2026-07-21T12:00:00.000Z',
    })).toMatchObject({
      changedByAdmin: true,
      label: 'Alterado por último pelo administrador',
    })
  })

  it('deixa origem e ator com a API e confirma explicitamente apenas a revogação', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/components/ContactDialog.vue', import.meta.url)), 'utf8')
    const consentRequest = source.slice(source.indexOf('async function persistConsentChanges'), source.indexOf('async function save'))

    expect(consentRequest).toContain("...(change.granted ? {} : { confirmed: true })")
    expect(consentRequest).not.toContain('source:')
    expect(consentRequest).not.toContain('actor')
  })

  it('não converte uma autorização automática pendente em identidade sintética', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/components/ContactDialog.vue', import.meta.url)), 'utf8')
    expect(source).toContain('!pendingWhatsappCloud.value && form.consents.whatsappCloud')
    expect(source).toContain("item.pending ? 'Cancelar autorização pendente'")
  })

  it('exibe e persiste a permissão do Telegram quando a identidade do bot existe', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/components/ContactDialog.vue', import.meta.url)), 'utf8')

    expect(source).toContain("consents: { telegram: false, email: false, whatsappCloud: false }")
    expect(source).toContain("key: 'telegram'")
    expect(source).toContain("channel: 'telegram'")
    expect(source).toContain("available: Boolean(identity(props.contact || props.initial, 'telegram'))")
    expect(source).toContain("telegram: Boolean(telegramIdentity?.authorized && telegramIdentity?.consentStatus === 'granted')")
    expect(source).toContain('Telegram, WhatsApp Cloud e Email permanecem separados')
  })
})
