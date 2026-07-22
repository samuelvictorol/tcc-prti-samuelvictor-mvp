import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('quasar', () => ({ useQuasar: () => ({}) }))
import {
  SYSTEM_WHATSAPP_TEMPLATE_NAMES,
  buildCustomWhatsAppCloudDefinition,
  isSystemTemplateRecord,
} from '../src/pages/TemplatesPage.vue'

const page = readFileSync(new URL('../src/pages/TemplatesPage.vue', import.meta.url), 'utf8')

describe('templates fixos do sistema', () => {
  it('reconhece os tres nomes oficiais e permite excluir os demais', () => {
    expect(SYSTEM_WHATSAPP_TEMPLATE_NAMES).toEqual([
      'verify_code_1',
      'jaspers_market_plain_text_v1',
      'jaspers_market_order_confirmation_v1',
    ])
    expect(isSystemTemplateRecord({ channel: 'whatsapp_cloud', externalTemplateName: 'verify_code_1' })).toBe(true)
    expect(isSystemTemplateRecord({ channel: 'telegram', externalTemplateName: 'verify_code_1' })).toBe(false)
    expect(isSystemTemplateRecord({ channel: 'whatsapp_cloud', externalTemplateName: 'campanha_v2' })).toBe(false)
    expect(isSystemTemplateRecord({ systemManaged: true })).toBe(true)
  })

  it('oculta a exclusao dos fixos e mostra o cadeado', () => {
    expect(page).toContain('v-if="isSystemTemplateRecord(props.row)" name="lock"')
    expect(page).toContain('<q-btn v-else flat round dense color="negative" icon="delete"')
    expect(page).toContain('Este é um template padrão do sistema e não pode ser removido.')
  })

  it('permite reutilizar a variavel codigo no corpo e no botao OTP', () => {
    const definition = buildCustomWhatsAppCloudDefinition({
      templateName: 'verify_code_1',
      languageCode: 'pt_BR',
      components: [
        { type: 'body', parameters: [{ type: 'text', key: 'codigo', label: 'Código' }] },
        { type: 'button', subType: 'otp_copy_code', index: 0, parameters: [{ type: 'text', key: 'codigo', label: 'Copiar código' }] },
      ],
    })
    expect(definition.variables).toEqual(['codigo'])
    expect(definition.payload.builder.components[1]).toMatchObject({ subType: 'otp_copy_code' })
  })
})
