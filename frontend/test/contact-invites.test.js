import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildInviteGroupSyncPayload,
  contactInviteOrigins,
  groupInviteIds,
  groupInviteOrigins,
  inviteGroupSyncCaption,
} from '../src/services/contact-invites.js'

const contactsPage = readFileSync(
  fileURLToPath(new URL('../src/pages/ContactsPage.vue', import.meta.url)),
  'utf8',
)

describe('origens e grupos por convite', () => {
  it('normaliza as origens retornadas pela API para busca e exibição compacta', () => {
    expect(contactInviteOrigins({
      inviteOrigins: [{
        inviteId: 'invite-1',
        title: 'Clientes do evento',
        slug: 'clientes-evento',
        firstUsedAt: '2026-07-20T10:00:00.000Z',
        lastUsedAt: '2026-07-21T10:00:00.000Z',
        channels: ['telegram'],
      }],
    })).toEqual([expect.objectContaining({
      id: 'invite-1',
      title: 'Clientes do evento',
      slug: 'clientes-evento',
      channels: ['telegram'],
    })])
  })

  it('reconhece a origem persistida no grupo sincronizado', () => {
    const group = {
      sourceInviteId: 'invite-1',
      sourceInvite: { id: 'invite-1', title: 'Convite principal', slug: 'principal' },
    }
    expect(groupInviteIds(group)).toEqual(['invite-1'])
    expect(groupInviteOrigins(group)).toEqual([
      expect.objectContaining({ id: 'invite-1', title: 'Convite principal', slug: 'principal' }),
    ])
  })

  it('monta a sincronização aditiva sem instrução para remover membros', () => {
    expect(buildInviteGroupSyncPayload({
      inviteIds: ['invite-1', 'invite-1', 'invite-2'],
    })).toEqual({ inviteIds: ['invite-1', 'invite-2'] })

    expect(inviteGroupSyncCaption({
      summary: { invitesProcessed: 2, contactsAdded: 4 },
    })).toContain('4 adicionado(s)')
  })

  it('integra filtro, criação e atualização aos endpoints de convite', () => {
    expect(contactsPage).toContain("params: { inviteId: inviteFilter.value || undefined }")
    expect(contactsPage).toContain("'/contact-groups/sync-invites'")
    expect(contactsPage).toContain('`/contact-groups/${editingId.value}/sync-invite`')
    expect(contactsPage).toContain('nunca remove membros atuais')
    expect(contactsPage).not.toContain("mode: 'replace'")
    expect(contactsPage).toContain('color="blue-7"')
    expect(contactsPage).toContain('text-color="white"')
  })
})
