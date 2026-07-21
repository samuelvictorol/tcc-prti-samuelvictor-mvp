<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useQuasar } from 'quasar'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import ContactDialog from '../components/ContactDialog.vue'
import { errorMessage, fetchAll, http } from '../services/http.js'

const $q = useQuasar()
const tab = ref('contacts')
const loading = ref(false)
const saving = ref(false)
const search = ref('')
const contacts = ref([])
const groups = ref([])
const dialog = ref(false)
const contactDialog = ref(false)
const editingContact = ref(null)
const mode = ref('contact')
const editingId = ref(null)

const emptyContact = () => ({
  name: '',
  email: '',
  phone: '',
  telegramUsername: '',
  notes: '',
  consents: { email: false, telegram: false, whatsappWeb: false, whatsappCloud: false },
})
const emptyGroup = () => ({ name: '', description: '', contactIds: [], source: 'manual' })
const contactForm = reactive(emptyContact())
const groupForm = reactive(emptyGroup())

const contactColumns = [
  { name: 'name', label: 'Contato', field: 'name', align: 'left', sortable: true },
  { name: 'channels', label: 'Canais autorizados', field: 'channels', align: 'left' },
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
    [contact.displayName, contact.name, contact.email, contact.phone, contact.telegramUsername]
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
      email: source.some((item) => (typeof item === 'string' ? item === 'email' : item.channel === 'email' && (item.authorized || item.consentStatus === 'granted'))),
      telegram: source.some((item) => (typeof item === 'string' ? item === 'telegram' : item.channel === 'telegram' && (item.authorized || item.consentStatus === 'granted'))),
      whatsappWeb: source.some((item) => typeof item === 'string'
        ? ['whatsappWeb', 'whatsapp-web', 'whatsapp_web'].includes(item)
        : ['whatsappWeb', 'whatsapp-web', 'whatsapp_web'].includes(item.channel) && (item.authorized || item.consentStatus === 'granted')),
      whatsappCloud: source.some((item) => typeof item === 'string'
        ? ['whatsappCloud', 'whatsapp-cloud', 'whatsapp_cloud'].includes(item)
        : ['whatsappCloud', 'whatsapp-cloud', 'whatsapp_cloud'].includes(item.channel) && (item.authorized || item.consentStatus === 'granted')),
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
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível carregar contatos e grupos.') })
  } finally {
    loading.value = false
  }
}

function openCreate(kind) {
  if (kind === 'contact') {
    editingContact.value = null
    contactDialog.value = true
    return
  }
  mode.value = kind
  editingId.value = null
  Object.assign(contactForm, emptyContact())
  Object.assign(groupForm, emptyGroup())
  dialog.value = true
}

function openEdit(kind, record) {
  if (kind === 'contact') {
    editingContact.value = record
    contactDialog.value = true
    return
  }
  mode.value = kind
  editingId.value = recordId(record)
  if (kind === 'contact') {
    Object.assign(contactForm, emptyContact(), {
      name: record.name || '',
      email: record.email || '',
      phone: record.phone || '',
      telegramUsername: record.telegramUsername || record.telegram_username || '',
      notes: record.notes || '',
      consents: normalizeConsents(record),
    })
  } else {
    Object.assign(groupForm, emptyGroup(), {
      name: record.name || '',
      description: record.description || '',
      source: record.source || 'manual',
      contactIds: (record.contactIds || record.contacts || record.members || []).map((item) => typeof item === 'object' ? recordId(item) : item),
    })
  }
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
                  </div>
                </div>
              </q-td>
            </template>
            <template #body-cell-channels="props">
              <q-td :props="props">
                <div class="channel-badges">
                  <q-badge v-for="channel in channelLabels(props.row)" :key="channel" outline color="primary" :label="channel" />
                  <span v-if="!channelLabels(props.row).length" class="text-muted">Nenhum consentimento</span>
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
          <div class="text-h6 text-weight-bold">{{ editingId ? 'Editar' : 'Novo' }} {{ mode === 'contact' ? 'contato' : 'grupo' }}</div>
          <q-space />
          <q-btn v-close-popup flat round dense icon="close" aria-label="Fechar" />
        </q-card-section>
        <q-separator />
        <q-form @submit.prevent="save">
          <q-card-section class="q-pa-lg">
            <div v-if="mode === 'contact'" class="form-grid">
              <q-input v-model.trim="contactForm.name" outlined label="Nome *" :rules="[(value) => Boolean(value) || 'Informe o nome']" />
              <q-input v-model.trim="contactForm.email" outlined type="email" label="Email" />
              <q-input v-model.trim="contactForm.phone" outlined label="Telefone" hint="Inclua o código do país" />
              <q-input v-model.trim="contactForm.telegramUsername" outlined label="Usuário do Telegram" prefix="@" />
              <q-input v-model="contactForm.notes" outlined type="textarea" label="Observações" class="full-span" />
              <div class="full-span consent-box">
                <div class="text-weight-bold">Consentimentos confirmados</div>
                <div class="text-caption text-muted q-mb-sm">Marque apenas canais autorizados. Interações verificadas pela API podem atualizar estes campos.</div>
                <div class="row q-gutter-md">
                  <q-checkbox v-model="contactForm.consents.telegram" label="Telegram" />
                  <q-checkbox v-model="contactForm.consents.whatsappWeb" label="WhatsApp Web" />
                  <q-checkbox v-model="contactForm.consents.whatsappCloud" label="WhatsApp Cloud" />
                  <q-checkbox v-model="contactForm.consents.email" label="Email" />
                </div>
              </div>
            </div>
            <div v-else class="form-grid">
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

.channel-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.consent-box {
  padding: 15px;
  border: 1px solid rgba(53, 188, 164, 0.2);
  border-radius: 15px;
  background: rgba(130, 248, 230, 0.09);
}
</style>
