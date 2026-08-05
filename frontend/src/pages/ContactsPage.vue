<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useQuasar } from 'quasar'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import ContactDialog from '../components/ContactDialog.vue'
import { errorMessage, fetchAll, http, unwrap } from '../services/http.js'
import {
  buildInviteGroupSyncPayload,
  contactInviteOrigins,
  groupInviteIds,
  groupInviteOrigins,
  inviteGroupSyncCaption,
} from '../services/contact-invites.js'
import {
  automaticRegistrationSources,
  contactIdentitySummaries,
  identityConsentProvenance,
} from '../services/contact-identities.js'

const $q = useQuasar()
const route = useRoute()
const router = useRouter()
const tab = ref('contacts')
const loading = ref(false)
const saving = ref(false)
const search = ref('')
const inviteFilter = ref(String(route.query.inviteId || '').trim() || null)
const contacts = ref([])
const groups = ref([])
const invites = ref([])
const dialog = ref(false)
const contactDialog = ref(false)
const editingContact = ref(null)
const editingId = ref(null)
const editingInviteLinked = ref(false)
const syncingGroupId = ref(null)
let openingQueryContact = false

const emptyGroup = () => ({
  name: '',
  description: '',
  contactIds: [],
  source: 'manual',
  membershipMode: 'manual',
  inviteIds: [],
})
const groupForm = reactive(emptyGroup())

const primaryGroupInviteId = computed({
  get: () => groupForm.inviteIds[0] || null,
  set: (value) => { groupForm.inviteIds = value ? [value] : [] },
})

const contactColumns = [
  { name: 'name', label: 'Contato', field: 'name', align: 'left', sortable: true },
  { name: 'channels', label: 'Notificações e chat', field: 'channels', align: 'left' },
  { name: 'updatedAt', label: 'Atualizado', field: 'updatedAt', align: 'left', sortable: true },
  { name: 'actions', label: '', field: 'actions', align: 'right' },
]

const groupColumns = [
  { name: 'name', label: 'Grupo', field: 'name', align: 'left', sortable: true },
  { name: 'members', label: 'Membros', field: 'members', align: 'left' },
  { name: 'source', label: 'Origem', field: 'source', align: 'left' },
  { name: 'actions', label: '', field: 'actions', align: 'right' },
]

const contactOptions = computed(() => contacts.value.map((contact) => ({
  label: contact.displayName || contact.name || contact.email || contact.phone,
  value: contact.id || contact._id,
})))

const inviteOptions = computed(() => invites.value.map((invite) => ({
  label: invite.title || invite.name || invite.slug || 'Convite',
  value: recordId(invite),
  slug: invite.slug || '',
})))

const filteredContacts = computed(() => {
  const needle = search.value.trim().toLowerCase()
  if (!needle) return contacts.value
  return contacts.value.filter((contact) =>
    [
      contact.displayName,
      contact.name,
      contact.email,
      contact.phone,
      contact.telegramUsername,
      ...contactInviteOrigins(contact, invites.value).flatMap((origin) => [origin.title, origin.slug]),
      ...(Array.isArray(contact.channels) ? contact.channels.flatMap((identity) => [
        identity?.address,
        ...Object.values(identity?.metadata || {}),
      ]) : []),
    ]
      .some((value) => String(value || '').toLowerCase().includes(needle)),
  )
})

const filteredGroups = computed(() => {
  const needle = search.value.trim().toLowerCase()
  if (!needle) return groups.value
  return groups.value.filter((group) =>
    [group.name, group.description, group.source]
      .some((value) => String(value || '').toLowerCase().includes(needle)),
  )
})

function recordId(record) {
  return record?.id || record?._id
}

function normalizeConsents(contact) {
  const source = contact.consents || contact.channels || {}
  if (Array.isArray(source)) {
    return {
      email: source.some((item) => (typeof item === 'string' ? item === 'email' : item.channel === 'email' && item.authorized && item.consentStatus === 'granted')),
      telegram: source.some((item) => (typeof item === 'string' ? item === 'telegram' : item.channel === 'telegram' && item.authorized && item.consentStatus === 'granted')),
      whatsappCloud: source.some((item) => typeof item === 'string'
        ? ['whatsappCloud', 'whatsapp-cloud', 'whatsapp_cloud'].includes(item)
        : ['whatsappCloud', 'whatsapp-cloud', 'whatsapp_cloud'].includes(item.channel) && item.authorized && item.consentStatus === 'granted'),
    }
  }
  return {
    email: Boolean(source.email?.granted ?? source.email),
    telegram: Boolean(source.telegram?.granted ?? source.telegram),
    whatsappCloud: Boolean(source.whatsappCloud?.granted ?? source.whatsappCloud ?? source.whatsapp_cloud),
  }
}

function channelLabels(contact) {
  const consent = normalizeConsents(contact)
  return [
    ['telegram', 'Telegram'],
    ['whatsappCloud', 'WhatsApp Cloud'],
    ['email', 'Email'],
  ].filter(([key]) => consent[key]).map(([, label]) => label)
}

function isIdentityAuthorized(identity) {
  return Boolean(identity?.authorized && identity?.consentStatus === 'granted')
}

function visibleIdentitySummaries(contact) {
  return contactIdentitySummaries(contact)
    .filter((summary) => ['telegram', 'whatsapp_cloud'].includes(summary.channel))
    .map((summary) => ({ ...summary, consent: identityConsentProvenance(summary.identity) }))
}

function memberCount(group) {
  return group.contactCount ?? group.memberCount ?? group.contacts?.length ?? group.contactIds?.length ?? group.members?.length ?? 0
}

function compactInviteOrigins(record, kind = 'contact') {
  return kind === 'group'
    ? groupInviteOrigins(record, invites.value)
    : contactInviteOrigins(record, invites.value)
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

async function loadData() {
  loading.value = true
  try {
    const [contactItems, groupItems, inviteItems] = await Promise.all([
      fetchAll('/contacts', {
        params: { inviteId: inviteFilter.value || undefined },
        preferredKey: 'contacts',
      }),
      fetchAll('/contact-groups', { preferredKey: 'groups' }),
      fetchAll('/invites', { preferredKey: 'invites' }),
    ])
    contacts.value = contactItems
    groups.value = groupItems
    invites.value = inviteItems
    await openContactFromQuery()
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível carregar contatos e grupos.') })
  } finally {
    loading.value = false
  }
}

async function applyInviteFilter() {
  const query = { ...route.query }
  if (inviteFilter.value) query.inviteId = inviteFilter.value
  else delete query.inviteId
  await router.replace({ query })
  loading.value = true
  try {
    contacts.value = await fetchAll('/contacts', {
      params: { inviteId: inviteFilter.value || undefined },
      preferredKey: 'contacts',
    })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível filtrar os contatos por convite.') })
  } finally {
    loading.value = false
  }
}

async function openContactFromQuery() {
  const id = String(route.query.contactId || route.query.editContact || '').trim()
  if (!id || openingQueryContact) return
  openingQueryContact = true
  try {
    let contact = contacts.value.find((item) => String(recordId(item)) === id)
    if (!contact) contact = unwrap(await http.get(`/contacts/${id}`))
    if (contact) {
      editingContact.value = contact
      contactDialog.value = true
    }
    const query = { ...route.query }
    delete query.contactId
    delete query.editContact
    await router.replace({ query })
  } catch (error) {
    $q.notify({ type: 'warning', message: errorMessage(error, 'Não foi possível abrir o contato indicado.') })
  } finally {
    openingQueryContact = false
  }
}

function openCreate(kind) {
  if (kind === 'contact') {
    editingContact.value = null
    contactDialog.value = true
    return
  }
  editingId.value = null
  editingInviteLinked.value = false
  Object.assign(groupForm, emptyGroup())
  dialog.value = true
}

function openEdit(kind, record) {
  if (kind === 'contact') {
    editingContact.value = record
    contactDialog.value = true
    return
  }
  editingId.value = recordId(record)
  editingInviteLinked.value = groupInviteIds(record).length > 0
  Object.assign(groupForm, emptyGroup(), {
    name: record.name || '',
    description: record.description || '',
    source: record.source || 'manual',
    contactIds: (record.contactIds || record.contacts || record.members || []).map((item) => typeof item === 'object' ? recordId(item) : item),
    membershipMode: groupInviteIds(record).length ? 'invite' : 'manual',
    inviteIds: groupInviteIds(record),
  })
  dialog.value = true
}

async function save() {
  saving.value = true
  try {
    let result
    if (groupForm.membershipMode === 'invite') {
      if (!groupForm.inviteIds.length) {
        $q.notify({ type: 'warning', message: 'Selecione pelo menos um convite para sincronizar.' })
        return
      }
      if (editingId.value) {
        result = unwrap(await http.post(
          `/contact-groups/${editingId.value}/sync-invite`,
          { inviteId: primaryGroupInviteId.value },
        )) || {}
      } else {
        result = unwrap(await http.post(
          '/contact-groups/sync-invites',
          buildInviteGroupSyncPayload(groupForm),
        )) || {}
      }
      $q.notify({
        type: 'positive',
        message: editingId.value ? 'Grupo sincronizado pelo convite.' : 'Grupos sincronizados pelos convites.',
        caption: inviteGroupSyncCaption(result),
      })
    } else {
      const payload = {
        name: groupForm.name,
        description: groupForm.description,
        contactIds: groupForm.contactIds,
        source: 'manual',
      }
      if (editingId.value) await http.put(`/contact-groups/${editingId.value}`, payload)
      else await http.post('/contact-groups', payload)
      $q.notify({ type: 'positive', message: 'Grupo salvo com sucesso.' })
    }
    dialog.value = false
    await loadData()
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error) })
  } finally {
    saving.value = false
  }
}

function confirmSyncGroup(group) {
  const sourceInvites = compactInviteOrigins(group, 'group')
  if (!sourceInvites.length) return
  $q.dialog({
    title: 'Sincronizar grupo pelos convites?',
    message: 'Novos contatos associados ao convite serão adicionados. Nenhum membro atual será removido.',
    cancel: { flat: true, label: 'Cancelar' },
    ok: { color: 'primary', label: 'Sincronizar' },
    persistent: true,
  }).onOk(() => syncGroupInvites(group))
}

async function syncGroupInvites(group) {
  const id = recordId(group)
  syncingGroupId.value = id
  try {
    const result = unwrap(await http.post(
      `/contact-groups/${id}/sync-invite`,
      { inviteId: groupInviteIds(group)[0] },
    )) || {}
    $q.notify({
      type: 'positive',
      message: 'Grupo atualizado pelos convites.',
      caption: inviteGroupSyncCaption(result),
    })
    await loadData()
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível sincronizar o grupo.') })
  } finally {
    syncingGroupId.value = null
  }
}

function remove(kind, record) {
  const isContact = kind === 'contact'
  $q.dialog({
    title: `Remover ${isContact ? 'contato' : 'grupo'}?`,
    message: isContact
      ? 'O contato terá consentimentos revogados e deve sair de qualquer fila pendente.'
      : 'Os membros não serão removidos, mas o grupo deixará de receber notificações.',
    cancel: { flat: true, label: 'Cancelar' },
    ok: { color: 'negative', label: 'Remover' },
    persistent: true,
  }).onOk(async () => {
    try {
      await http.delete(`${isContact ? '/privacy/contacts' : '/contact-groups'}/${recordId(record)}`)
      $q.notify({ type: 'positive', message: `${isContact ? 'Contato' : 'Grupo'} removido.` })
      await loadData()
    } catch (error) {
      $q.notify({ type: 'negative', message: errorMessage(error) })
    }
  })
}

onMounted(loadData)
watch(() => route.query.contactId || route.query.editContact, openContactFromQuery)
</script>

<template>
  <q-page class="page-container">
    <PageHeader
      eyebrow="Base de relacionamento"
      title="Contatos e grupos"
      icon="group"
    >
      <template #actions>
        <q-btn color="dark" unelevated no-caps icon="person_add" label="Novo contato" @click="openCreate('contact')" />
        <q-btn color="primary" unelevated no-caps icon="group_add" label="Novo grupo" @click="openCreate('group')" />
      </template>
    </PageHeader>

    <q-card flat class="glass-card section-card">
      <div class="toolbar-row">
        <q-tabs v-model="tab" dense no-caps inline-label active-color="primary" indicator-color="transparent">
          <q-tab name="contacts" icon="person" label="Contatos" />
          <q-tab name="groups" icon="groups" label="Grupos" />
        </q-tabs>
        <div class="contact-search-controls">
          <q-input v-model="search" dense outlined clearable debounce="250" placeholder="Buscar nome, email, telefone ou convite" class="search-field">
            <template #prepend><q-icon name="search" /></template>
          </q-input>
          <q-select
            v-if="tab === 'contacts'"
            v-model="inviteFilter"
            dense
            outlined
            clearable
            emit-value
            map-options
            :options="inviteOptions"
            label="Origem por convite"
            class="invite-filter"
            @update:model-value="applyInviteFilter"
          >
            <template #option="scope">
              <q-item v-bind="scope.itemProps">
                <q-item-section avatar><q-icon name="link" color="primary" /></q-item-section>
                <q-item-section>
                  <q-item-label>{{ scope.opt.label }}</q-item-label>
                  <q-item-label v-if="scope.opt.slug" caption>/invite/{{ scope.opt.slug }}</q-item-label>
                </q-item-section>
              </q-item>
            </template>
          </q-select>
        </div>
      </div>

      <q-tab-panels v-model="tab" animated class="transparent">
        <q-tab-panel name="contacts" class="q-pa-none">
          <EmptyState
            v-if="!loading && !filteredContacts.length"
            icon="person_search"
            title="Nenhum contato encontrado"
            description="Cadastre uma pessoa manualmente ou aguarde uma interação em um canal."
          >
            <q-btn color="primary" unelevated no-caps label="Cadastrar contato" @click="openCreate('contact')" />
          </EmptyState>
          <q-table
            v-else
            flat
            :rows="filteredContacts"
            :columns="contactColumns"
            row-key="id"
            :loading="loading"
            :rows-per-page-options="[10, 25, 50]"
          >
            <template #body-cell-name="props">
              <q-td :props="props">
                <div class="contact-cell">
                  <q-avatar size="40px" class="avatar-fallback">
                    <img v-if="props.row.avatarUrl || props.row.imageUrl" :src="props.row.avatarUrl || props.row.imageUrl" :alt="`Foto de ${props.row.displayName || props.row.name}`" />
                    <span v-else>{{ (props.row.displayName || props.row.name || '?').slice(0, 1).toUpperCase() }}</span>
                  </q-avatar>
                  <div>
                    <strong>{{ props.row.displayName || props.row.name || 'Sem nome' }}</strong>
                    <span>{{ props.row.email || props.row.phone || props.row.telegramUsername || 'Sem identificador' }}</span>
                    <div v-if="automaticRegistrationSources(props.row).length" class="automatic-origin-badges">
                      <q-badge
                        v-for="source in automaticRegistrationSources(props.row)"
                        :key="source"
                        outline
                        color="positive"
                        icon="auto_awesome"
                        :label="`Cadastro automático: ${source}`"
                      />
                    </div>
                    <div v-if="compactInviteOrigins(props.row).length" class="invite-origin-badges">
                      <q-badge
                        v-for="origin in compactInviteOrigins(props.row).slice(0, 2)"
                        :key="origin.id"
                        color="blue-7"
                        text-color="white"
                        icon="link"
                        :label="origin.title"
                      >
                        <q-tooltip>
                          /invite/{{ origin.slug || 'sem-slug' }}
                          <template v-if="origin.lastUsedAt"> · última origem {{ formatDate(origin.lastUsedAt) }}</template>
                        </q-tooltip>
                      </q-badge>
                      <q-badge
                        v-if="compactInviteOrigins(props.row).length > 2"
                        color="grey-3"
                        text-color="grey-8"
                        :label="`+${compactInviteOrigins(props.row).length - 2}`"
                      >
                        <q-tooltip>{{ compactInviteOrigins(props.row).slice(2).map((origin) => origin.title).join(', ') }}</q-tooltip>
                      </q-badge>
                    </div>
                  </div>
                </div>
              </q-td>
            </template>
            <template #body-cell-channels="props">
              <q-td :props="props">
                <div class="channel-badges">
                  <q-badge v-for="channel in channelLabels(props.row)" :key="channel" outline color="primary" :label="channel" />
                  <span v-if="!channelLabels(props.row).length" class="text-muted">Nenhuma autorização</span>
                </div>
                <div v-if="visibleIdentitySummaries(props.row).length" class="provider-id-list">
                  <div
                    v-for="summary in visibleIdentitySummaries(props.row)"
                    :key="summary.identity.id || `${summary.channel}:${summary.identity.address}`"
                    class="provider-id-row"
                  >
                    <span class="provider-id-row__channel">
                      <q-icon :name="summary.icon" />{{ summary.label }}
                      <q-badge
                        dense
                        outline
                        :color="isIdentityAuthorized(summary.identity) ? 'positive' : 'grey-7'"
                        :label="isIdentityAuthorized(summary.identity) ? 'Autorizado' : 'Identificado'"
                      />
                    </span>
                    <div class="provider-id-row__values">
                      <code v-for="identifier in summary.identifiers" :key="identifier.key">{{ identifier.label }}: {{ identifier.value }}</code>
                    </div>
                    <small v-if="summary.consent.changedByAdmin || summary.consent.automaticCommand" class="provider-id-row__consent">
                      {{ summary.consent.label }}
                    </small>
                  </div>
                </div>
              </q-td>
            </template>
            <template #body-cell-updatedAt="props"><q-td :props="props">{{ formatDate(props.row.updatedAt) }}</q-td></template>
            <template #body-cell-actions="props">
              <q-td :props="props">
                <q-btn flat round dense icon="edit" aria-label="Editar contato" @click="openEdit('contact', props.row)" />
                <q-btn flat round dense color="negative" icon="delete" aria-label="Remover contato" @click="remove('contact', props.row)" />
              </q-td>
            </template>
          </q-table>
        </q-tab-panel>

        <q-tab-panel name="groups" class="q-pa-none">
          <EmptyState v-if="!loading && !filteredGroups.length" icon="group_off" title="Nenhum grupo encontrado" description="Agrupe contatos para agilizar envios com o mesmo propósito.">
            <q-btn color="primary" unelevated no-caps label="Criar grupo" @click="openCreate('group')" />
          </EmptyState>
          <q-table v-else flat :rows="filteredGroups" :columns="groupColumns" row-key="id" :loading="loading" :rows-per-page-options="[10, 25, 50]">
            <template #body-cell-name="props">
              <q-td :props="props">
                <strong>{{ props.row.name }}</strong>
                <div class="text-muted text-caption">{{ props.row.description || 'Sem descrição' }}</div>
                <div v-if="compactInviteOrigins(props.row, 'group').length" class="invite-origin-badges">
                  <q-badge
                    v-for="origin in compactInviteOrigins(props.row, 'group')"
                    :key="origin.id"
                    color="blue-7"
                    text-color="white"
                    icon="link"
                    :label="origin.title"
                  />
                </div>
              </q-td>
            </template>
            <template #body-cell-members="props"><q-td :props="props">{{ memberCount(props.row) }} contato(s)</q-td></template>
            <template #body-cell-source="props">
              <q-td :props="props">
                <q-badge
                  outline
                  color="primary"
                  :icon="compactInviteOrigins(props.row, 'group').length ? 'sync' : undefined"
                  :label="compactInviteOrigins(props.row, 'group').length ? 'Convite sincronizado' : (props.row.source || 'manual')"
                />
              </q-td>
            </template>
            <template #body-cell-actions="props">
              <q-td :props="props">
                <template v-if="(props.row.source || 'manual') === 'manual'">
                  <q-btn
                    v-if="compactInviteOrigins(props.row, 'group').length"
                    flat
                    round
                    dense
                    color="primary"
                    icon="sync"
                    aria-label="Sincronizar grupo pelo convite"
                    :loading="syncingGroupId === recordId(props.row)"
                    @click="confirmSyncGroup(props.row)"
                  >
                    <q-tooltip>Adicionar novos contatos deste convite</q-tooltip>
                  </q-btn>
                  <q-btn flat round dense icon="edit" aria-label="Editar grupo" @click="openEdit('group', props.row)" />
                  <q-btn flat round dense color="negative" icon="delete" aria-label="Remover grupo" @click="remove('group', props.row)" />
                </template>
                <span v-else class="text-caption text-muted">Gerencie no canal</span>
              </q-td>
            </template>
          </q-table>
        </q-tab-panel>
      </q-tab-panels>
    </q-card>

    <q-dialog v-model="dialog" persistent :maximized="$q.screen.lt.sm">
      <q-card class="dialog-card dialog-card--medium">
        <q-card-section class="row items-center">
          <div>
            <div class="text-h6 text-weight-bold">{{ editingId ? 'Editar grupo' : 'Novo grupo' }}</div>
            <div class="text-caption text-muted">
              {{ groupForm.membershipMode === 'invite' ? 'Membros adicionados automaticamente pela origem do convite.' : 'Escolha manualmente quem faz parte do grupo.' }}
            </div>
          </div>
          <q-space />
          <q-btn v-close-popup flat round dense icon="close" aria-label="Fechar" />
        </q-card-section>
        <q-separator />
        <q-form @submit.prevent="save">
          <q-card-section class="q-pa-lg">
            <div class="form-grid">
              <q-btn-toggle
                v-model="groupForm.membershipMode"
                spread
                no-caps
                unelevated
                toggle-color="primary"
                color="grey-2"
                text-color="grey-8"
                :disable="editingInviteLinked"
                :options="[
                  { label: 'Selecionar contatos', value: 'manual', icon: 'group_add' },
                  { label: 'Sincronizar convite', value: 'invite', icon: 'link' },
                ]"
                class="full-span group-mode-toggle"
              />

              <template v-if="groupForm.membershipMode === 'manual'">
                <q-input
                  v-model.trim="groupForm.name"
                  outlined
                  label="Nome do grupo *"
                  :rules="[(value) => Boolean(value) || 'Informe o nome']"
                />
                <q-input model-value="Manual" outlined label="Origem" disable />
                <q-input v-model="groupForm.description" outlined type="textarea" label="Descrição" class="full-span" />
              </template>

              <q-select
                v-if="groupForm.membershipMode === 'manual'"
                v-model="groupForm.contactIds"
                outlined
                multiple
                use-chips
                emit-value
                map-options
                option-label="label"
                option-value="value"
                :options="contactOptions"
                label="Membros"
                class="full-span"
              />

              <template v-else>
                <q-input
                  v-if="editingId"
                  :model-value="groupForm.name"
                  outlined
                  readonly
                  label="Grupo que será sincronizado"
                  class="full-span"
                />
                <q-select
                  v-if="editingId"
                  v-model="primaryGroupInviteId"
                  outlined
                  emit-value
                  map-options
                  :options="inviteOptions"
                  label="Convite de origem *"
                  :rules="[(value) => Boolean(value) || 'Selecione um convite']"
                  class="full-span"
                />
                <q-select
                  v-else
                  v-model="groupForm.inviteIds"
                  outlined
                  multiple
                  use-chips
                  emit-value
                  map-options
                  :options="inviteOptions"
                  label="Convites de origem *"
                  hint="Será criado ou atualizado um grupo separado para cada convite"
                  :rules="[(value) => Boolean(value?.length) || 'Selecione pelo menos um convite']"
                  class="full-span"
                />
                <q-banner rounded class="invite-sync-banner full-span">
                  <template #avatar><q-icon name="sync" color="primary" /></template>
                  A sincronização adiciona contatos associados ao convite e nunca remove membros atuais.
                  Depois, use o botão <q-icon name="sync" /> na lista para buscar novos contatos.
                </q-banner>
              </template>
            </div>
          </q-card-section>
          <q-separator />
          <q-card-actions align="right" class="q-pa-md">
            <q-btn v-close-popup flat no-caps label="Cancelar" />
            <q-btn
              type="submit"
              color="primary"
              unelevated
              no-caps
              :icon="groupForm.membershipMode === 'invite' ? 'sync' : 'save'"
              :label="groupForm.membershipMode === 'invite' ? (editingId ? 'Salvar e sincronizar' : 'Criar grupos') : 'Salvar'"
              :loading="saving"
            />
          </q-card-actions>
        </q-form>
      </q-card>
    </q-dialog>

    <ContactDialog
      v-model="contactDialog"
      :contact="editingContact"
      @saved="loadData"
    />
  </q-page>
</template>

<style scoped>
.search-field {
  width: min(360px, 100%);
}

.contact-search-controls {
  display: flex;
  width: min(700px, 100%);
  align-items: center;
  justify-content: flex-end;
  gap: 9px;
}

.contact-search-controls .search-field {
  flex: 1 1 330px;
}

.invite-filter {
  width: min(270px, 100%);
  flex: 0 1 270px;
}

.contact-cell {
  display: flex;
  align-items: center;
  gap: 11px;
}

.contact-cell strong,
.contact-cell span {
  display: block;
}

.contact-cell span {
  margin-top: 2px;
  color: #667a77;
  font-size: 0.77rem;
}

.automatic-origin-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
}

.invite-origin-badges {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
}

.invite-origin-badges :deep(.q-badge) {
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-mode-toggle {
  overflow: hidden;
  border: 1px solid rgba(3, 21, 21, 0.09);
  border-radius: 13px;
}

.invite-sync-banner {
  border: 1px solid rgba(53, 188, 164, 0.2);
  background: rgba(130, 248, 230, 0.1);
  color: #476660;
  line-height: 1.5;
}

.channel-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.provider-id-list {
  display: grid;
  gap: 7px;
  margin-top: 9px;
}

.provider-id-row {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.provider-id-row__channel {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #49645f;
  font-size: 0.68rem;
  font-weight: 700;
}

.provider-id-row__consent {
  color: #55706c;
  font-size: 0.65rem;
}

.provider-id-row__values {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 3px 8px;
}

.provider-id-row code {
  max-width: 310px;
  overflow: hidden;
  color: #607773;
  font-size: 0.63rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.consent-box {
  padding: 15px;
  border: 1px solid rgba(53, 188, 164, 0.2);
  border-radius: 15px;
  background: rgba(130, 248, 230, 0.09);
}

@media (max-width: 640px) {
  .contact-search-controls {
    align-items: stretch;
    flex-direction: column;
  }

  .contact-search-controls .search-field,
  .invite-filter {
    width: 100%;
    flex-basis: auto;
  }

  .group-mode-toggle :deep(.q-btn__content) {
    font-size: 0.72rem;
  }

  .provider-id-row code {
    max-width: 72vw;
  }
}
</style>
