import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../src/${relativePath}`, import.meta.url)), 'utf8')
}

describe('vínculos do próprio perfil', () => {
  it('usa endpoints autenticados e sempre confirma remoções', () => {
    const service = source('services/profile.js')
    expect(service).toContain("get('/my-profile/memberships')")
    expect(service).toContain('get(`/my-profile/groups/${encodeURIComponent(groupId)}`)')
    expect(service).toContain('delete(`/my-profile/groups/${encodeURIComponent(groupId)}`')
    expect(service).toContain('delete(`/my-profile/invites/${encodeURIComponent(inviteId)}`')
    expect(service.match(/data: \{ confirmed: true \}/g)).toHaveLength(2)
  })

  it('mostra convites, grupos, telefones mascarados e diálogos persistentes de confirmação', () => {
    const page = source('pages/ProfilePage.vue')
    expect(page).toContain('Convites utilizados')
    expect(page).toContain('Grupos de contatos')
    expect(page).toContain('member.phoneMasked')
    expect(page).toContain('Somente o início dos telefones é exibido')
    expect(page).toContain('v-model="leaveGroupDialog" persistent')
    expect(page).toContain('v-model="removeInviteDialog" persistent')
    expect(page).toContain('Somente o seu contato será removido')
    expect(page).toContain('grupos sincronizados por esse convite')
    expect(page).not.toContain('member.phone }}')
  })

  it('permite ao administrador remover somente um vínculo no diálogo do contato', () => {
    const dialog = source('components/ContactDialog.vue')
    expect(dialog).toContain('confirmRemoveInviteOrigin')
    expect(dialog).toContain('data: { confirmed: true }')
    expect(dialog).toContain('`/contacts/${contactId}/invites/${inviteId}`')
    expect(dialog).toContain('o convite e os demais participantes serão preservados')
    expect(dialog).toContain('Remover vínculo deste contato')
  })
})
