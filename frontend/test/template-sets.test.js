import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  templateSetChannels,
  templateSetContains,
  templateSetLinkResultSummary,
  templateSetPayload,
  templateSetTemplateIds,
  templateSetWithTemplate,
} from '../src/services/template-sets.js'

describe('conjuntos de templates', () => {
  it('normaliza referências resumidas recebidas da API por canal', () => {
    const set = {
      templates: {
        whatsapp_cloud: { id: 'wa-1', name: 'WhatsApp' },
        telegram: { _id: 'tg-1', name: 'Telegram' },
      },
    }

    expect(templateSetTemplateIds(set)).toEqual({
      whatsapp_cloud: 'wa-1',
      telegram: 'tg-1',
      email: null,
    })
    expect(templateSetChannels(set)).toEqual(['whatsapp_cloud', 'telegram'])
    expect(templateSetContains(set, 'telegram', 'tg-1')).toBe(true)
  })

  it('monta o contrato de escrita sem apagar os outros canais', () => {
    const original = {
      name: 'Boas-vindas',
      description: 'Fluxo de onboarding',
      inviteId: 'invite-1',
      templateIds: {
        whatsapp_cloud: 'wa-1',
        email: 'mail-1',
      },
    }
    const payload = templateSetWithTemplate(original, 'telegram', 'tg-1')

    expect(payload).toEqual({
      name: 'Boas-vindas',
      description: 'Fluxo de onboarding',
      inviteId: 'invite-1',
      templateIds: {
        whatsapp_cloud: 'wa-1',
        telegram: 'tg-1',
        email: 'mail-1',
      },
    })
    expect(templateSetPayload({ ...original, description: '', inviteId: null })).toEqual({
      name: 'Boas-vindas',
      description: null,
      inviteId: null,
      templateIds: {
        whatsapp_cloud: 'wa-1',
        email: 'mail-1',
      },
    })
  })

  it('resume vínculos múltiplos sem esconder sucesso parcial', () => {
    const error = new Error('falha no segundo conjunto')
    expect(templateSetLinkResultSummary([
      { status: 'fulfilled', value: {} },
      { status: 'rejected', reason: error },
      { status: 'fulfilled', value: {} },
    ])).toEqual({
      succeeded: 2,
      failed: 1,
      firstError: error,
    })
  })

  it('expõe CRUD, busca por convite e vínculo a partir da row de templates', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/pages/TemplatesPage.vue', import.meta.url)), 'utf8')

    expect(source).toContain("http.get('/template-sets'")
    expect(source).toContain("http.post('/template-sets'")
    expect(source).toContain('`/template-sets/${templateSetEditingId.value}`')
    expect(source).toContain('`/template-sets/${templateSetId(set)}`')
    expect(source).toContain('templateSetInviteFilter')
    expect(source).toContain('Buscar conjunto ou convite')
    expect(source).toContain('Vincular este template a um ou mais conjuntos')
    expect(source).toContain('templateSetWithTemplate')
    expect(source).toContain('Promise.allSettled(setsToLink.map')
    expect(source).toContain('Vínculo parcial:')
    expect(source).toContain('templateSets.value.length === 1 && templateSetPagination.value.page > 1')
    expect(source).toContain('v-model:pagination="templateSetPagination"')
    const setsPanelEnd = source.indexOf('</q-card>', source.indexOf('template-sets-panel'))
    const libraryHeading = source.indexOf('class="template-library-heading"')
    const templatesTable = source.indexOf(':rows="filteredTemplates"')
    expect(libraryHeading).toBeGreaterThan(setsPanelEnd)
    expect(libraryHeading).toBeLessThan(templatesTable)
    expect(source.slice(libraryHeading, templatesTable)).toContain('label="Novo template"')
    expect(source).toContain('Biblioteca por canal')
    expect(source).toContain('Templates por canal')
    const setColumns = source.slice(
      source.indexOf('const templateSetColumns'),
      source.indexOf('const inviteOptions'),
    )
    expect(setColumns).not.toContain('sortable: true')
  })
})
