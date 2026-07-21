<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useQuasar } from 'quasar'
import { useRoute, useRouter } from 'vue-router'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import ContactDialog from '../components/ContactDialog.vue'
import { errorMessage, fetchAll, http, unwrap } from '../services/http.js'
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
const contacts = ref([])
const groups = ref([])
const dialog = ref(false)
const contactDialog = ref(false)
const editingContact = ref(null)
const editingId = ref(null)
let openingQueryContact = false

const emptyGroup = () => ({ name: '', description: '', contactIds: [], source: 'manual' })
const groupForm = reactive(emptyGroup())

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
      whatsappWeb: source.some((item) => typeof item === 'string'
        ? ['whatsappWeb', 'whatsapp-web', 'whatsapp_web'].includes(item)
        : ['whatsappWeb', 'whatsapp-web', 'whatsapp_web'].includes(item.channel) && item.authorized && item.consentStatus === 'granted'),
      whatsappCloud: source.some((item) => typeof item === 'string'
        ? ['whatsappCloud', 'whatsapp-cloud', 'whatsapp_cloud'].includes(item)
        : ['whatsappCloud', 'whatsapp-cloud', 'whatsapp_cloud'].includes(item.channel) && item.authorized && item.consentStatus === 'granted'),
    }
  }
  return {
    email: Boolean(source.email?.granted ?? source.email),
    telegram: Boolean(source.telegram?.granted ?? source.telegram),
    whatsappWeb: Boolean(source.whatsappWeb?.granted ?? source.whatsappWeb ?? source.whatsapp_web),
    whatsappCloud: Boolean(source.whatsappCloud?.granted ?? source.whatsappCloud ?? source.whatsapp_cloud),
  }
}

function channelLabels(contact) {
  const consent = normalizeConsents(contact)
  return [
    ['telegram', 'Telegram'],
    ['whatsappWeb', 'WhatsApp Web'],
    ['whatsappCloud', 'WhatsApp Cloud'],
    ['email', 'Email'],
  ].filter(([key]) => consent[key]).map(([, label]) => label)
}

function hasWhatsappWebChat(contact) {
  const channels = Array.isArray(contact?.channels) ? contact.channels : []
  return channels.some((item) => String(typeof item === 'string' ? item : item?.channel).replaceAll('-', '_') === 'whatsapp_web')
}

function whatsappWebIdentity(contact) {
  const channels = Array.isArray(contact?.channels) ? contact.channels : []
  return channels.find((item) => String(item?.channel || '').replaceAll('-', '_') === 'whatsapp_web') || null
}

function isIdentityAuthorized(identity) {
  return Boolean(identity?.authorized && identity?.consentStatus === 'granted')
}

function visibleIdentitySummaries(contact) {
  return contactIdentitySummaries(contact)
    .filter((summary) => ['telegram', 'whatsapp_cloud', 'whatsapp_web'].includes(summary.channel))
    .map((summary) => ({ ...summary, consent: identityConsentProvenance(summary.identity) }))
}

function memberCount(group) {
  return group.contactCount ?? group.memberCount ?? group.contacts?.length ?? group.contactIds?.length ?? group.members?.length ?? 0
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

async function loadData() {
  loading.value = true
  try {
    const [contactItems, groupItems] = await Promise.all([
      fetchAll('/contacts', { preferredKey: 'contacts' }),
      fetchAll('/contact-groups', { preferredKey: 'groups' }),
    ])
    contacts.value = contactItems
    groups.value = groupItems
    await openContactFromQuery()
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível carregar contatos e grupos.') })
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
  Object.assign(groupForm, emptyGroup(), {
    name: record.name || '',
    description: record.description || '',
    source: record.source || 'manual',
    contactIds: (record.contactIds || record.contacts || record.members || []).map((item) => typeof item === 'object' ? recordId(item) : item),
  })
  dialog.value = true
}

async function save() {
  saving.value = true
  try {
    const payload = { ...groupForm, source: 'manual' }
    if (editingId.value) await http.put(`/contact-groups/${editingId.value}`, payload)
    else await http.post('/contact-groups', payload)
    $q.notify({ type: 'positive', message: 'Grupo salvo com sucesso.' })
    dialog.value = false
    await loadData()
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error) })
  } finally {
    saving.value = false
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
      description="Centralize identidades, origens e consentimentos por canal antes de qualquer envio."
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
        <q-input v-model="search" dense outlined clearable debounce="250" placeholder="Buscar por nome, email ou telefone" class="search-field">
          <template #prepend><q-icon name="search" /></template>
        </q-input>
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
                  </div>
                </div>
              </q-td>
            </template>
            <template #body-cell-channels="props">
              <q-td :props="props">
                <div class="channel-badges">
                  <q-badge v-for="channel in channelLabels(props.row)" :key="channel" outline color="primary" :label="channel" />
                  <q-badge
                    v-if="hasWhatsappWebChat(props.row) && !isIdentityAuthorized(whatsappWebIdentity(props.row))"
                    outline
                    color="warning"
                    text-color="dark"
                    icon="visibility"
                    label="WhatsApp Web: somente leitura"
                  />
                  <span v-if="!channelLabels(props.row).length && !hasWhatsappWebChat(props.row)" class="text-muted">Nenhuma autorização</span>
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
              <q-td :props="props"><strong>{{ props.row.name }}</strong><div class="text-muted text-caption">{{ props.row.description || 'Sem descrição' }}</div></q-td>
            </template>
            <template #body-cell-members="props"><q-td :props="props">{{ memberCount(props.row) }} contato(s)</q-td></template>
            <template #body-cell-source="props"><q-td :props="props"><q-badge outline color="primary" :label="props.row.source || 'manual'" /></q-td></template>
            <template #body-cell-actions="props">
              <q-td :props="props">
                <template v-if="(props.row.source || 'manual') === 'manual'">
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

    <q-dialog v-model="dialog" persistent>
      <q-card class="dialog-card">
        <q-card-section class="row items-center">
          <div class="text-h6 text-weight-bold">{{ editingId ? 'Editar grupo' : 'Novo grupo' }}</div>
          <q-space />
          <q-btn v-close-popup flat round dense icon="close" aria-label="Fechar" />
        </q-card-section>
        <q-separator />
        <q-form @submit.prevent="save">
          <q-card-section class="q-pa-lg">
            <div class="form-grid">
              <q-input v-model.trim="groupForm.name" outlined label="Nome do grupo *" :rules="[(value) => Boolean(value) || 'Informe o nome']" />
              <q-input model-value="Manual" outlined label="Origem" disable />
              <q-input v-model="groupForm.description" outlined type="textarea" label="Descrição" class="full-span" />
              <q-select v-model="groupForm.contactIds" outlined multiple use-chips emit-value map-options option-label="label" option-value="value" :options="contactOptions" label="Membros" class="full-span" />
            </div>
          </q-card-section>
          <q-separator />
          <q-card-actions align="right" class="q-pa-md">
            <q-btn v-close-popup flat no-caps label="Cancelar" />
            <q-btn type="submit" color="primary" unelevated no-caps label="Salvar" :loading="saving" />
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
  .provider-id-row code {
    max-width: 72vw;
  }
}
</style>
