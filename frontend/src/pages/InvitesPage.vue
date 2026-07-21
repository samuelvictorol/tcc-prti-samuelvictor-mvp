<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useQuasar } from 'quasar'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import { errorMessage, fetchAll, http } from '../services/http.js'

const $q = useQuasar()
const loading = ref(false)
const saving = ref(false)
const dialog = ref(false)
const editingId = ref(null)
const invites = ref([])
const contacts = ref([])

const emptyForm = () => ({
  title: '',
  slug: '',
  description: '',
  gradientStart: '#82F8E6',
  gradientEnd: '#35BCA4',
  active: true,
  recipientContact: null,
  links: [{ label: 'Iniciar Telegram', url: '', channel: 'telegram', active: true }],
})
const form = reactive(emptyForm())

const previewGradient = computed(() => `linear-gradient(145deg, ${safeColor(form.gradientStart)}, ${safeColor(form.gradientEnd)})`)
const contactOptions = computed(() => contacts.value.map((contact) => ({
  label: contact.displayName || contact.name || contact.email || contact.phone || 'Contato',
  value: contact.id || contact._id,
})))

function safeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#35BCA4'
}

function recordId(record) {
  return record?.id || record?._id
}

function publicUrl(invite = form) {
  return invite.publicUrl || `${window.location.origin}/invite/${invite.slug}`
}

function slugify(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function onTitleInput() {
  if (!editingId.value && !form.slug) form.slug = slugify(form.title)
}

async function loadInvites() {
  loading.value = true
  try {
    const [inviteItems, contactItems] = await Promise.all([
      fetchAll('/invites', { preferredKey: 'invites' }),
      fetchAll('/contacts', { params: { active: true }, preferredKey: 'contacts' }),
    ])
    invites.value = inviteItems
    contacts.value = contactItems
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível carregar os convites.') })
  } finally {
    loading.value = false
  }
}

function openInvite(invite) {
  editingId.value = invite ? recordId(invite) : null
  Object.assign(form, emptyForm(), invite ? {
    title: invite.title || '',
    slug: invite.slug || '',
    description: invite.description || '',
    gradientStart: invite.gradientStart || invite.theme?.gradientStart || '#82F8E6',
    gradientEnd: invite.gradientEnd || invite.theme?.gradientEnd || '#35BCA4',
    active: invite.active !== false,
    recipientContact: typeof invite.recipientContact === 'object'
      ? (invite.recipientContact?.id || invite.recipientContact?._id)
      : (invite.recipientContact || null),
    links: (invite.links || []).map((link) => ({
      label: link.label || link.title || '',
      url: link.url || link.linkUrl || link.link_url || '',
      channel: link.channel || link.type || 'other',
      active: link.active ?? link.enabled ?? true,
    })),
  } : {})
  dialog.value = true
}

function addLink() {
  form.links.push({ label: '', url: '', channel: 'other', active: true })
}

function removeLink(index) {
  form.links.splice(index, 1)
}

async function save() {
  saving.value = true
  const payload = {
    title: form.title,
    slug: slugify(form.slug),
    description: form.description,
    active: form.active,
    recipientContact: form.recipientContact || null,
    gradientStart: safeColor(form.gradientStart),
    gradientEnd: safeColor(form.gradientEnd),
    links: form.links.filter((link) => link.label && link.url).map((link) => ({
      label: link.label,
      url: link.url,
      channel: link.channel,
      active: link.active,
    })),
  }
  try {
    if (editingId.value) await http.put(`/invites/${editingId.value}`, payload)
    else await http.post('/invites', payload)
    dialog.value = false
    $q.notify({ type: 'positive', message: 'Página de convite salva.' })
    await loadInvites()
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error) })
  } finally {
    saving.value = false
  }
}

async function copyLink(invite) {
  try {
    await navigator.clipboard.writeText(publicUrl(invite))
    $q.notify({ type: 'positive', message: 'Link público copiado.' })
  } catch {
    $q.notify({ type: 'warning', message: publicUrl(invite) })
  }
}

function remove(invite) {
  $q.dialog({ title: 'Remover convite?', message: 'O link público deixará de funcionar.', cancel: true, ok: { color: 'negative', label: 'Remover' } })
    .onOk(async () => {
      try {
        await http.delete(`/invites/${recordId(invite)}`)
        await loadInvites()
      } catch (error) {
        $q.notify({ type: 'negative', message: errorMessage(error) })
      }
    })
}

onMounted(loadInvites)
</script>

<template>
  <q-page class="page-container">
    <PageHeader
      eyebrow="Aquisição com transparência"
      title="Convites públicos"
      description="Crie uma página clara para reunir links de grupos, iniciar bots e explicar como cada canal será utilizado."
      icon="link"
    >
      <template #actions><q-btn color="primary" unelevated no-caps icon="add_link" label="Novo convite" @click="openInvite()" /></template>
    </PageHeader>

    <EmptyState v-if="!loading && !invites.length" icon="link_off" title="Nenhum convite criado" description="Crie uma página pública para orientar novos contatos.">
      <q-btn color="primary" unelevated no-caps label="Criar convite" @click="openInvite()" />
    </EmptyState>
    <section v-else class="invite-grid">
      <q-card v-for="invite in invites" :key="recordId(invite)" flat class="glass-card invite-card">
        <div class="invite-cover" :style="{ background: `linear-gradient(145deg, ${safeColor(invite.gradientStart || invite.theme?.gradientStart)}, ${safeColor(invite.gradientEnd || invite.theme?.gradientEnd)})` }">
          <q-icon name="notifications_active" size="34px" />
          <q-badge :color="invite.active === false ? 'grey-7' : 'positive'" :label="invite.active === false ? 'Inativo' : 'Publicado'" />
        </div>
        <q-card-section>
          <div class="row items-start no-wrap"><div class="col"><div class="text-h6 text-weight-bold">{{ invite.title }}</div><div class="text-caption text-muted truncate">/invite/{{ invite.slug }}</div></div><q-btn flat round dense icon="more_vert"><q-menu><q-list><q-item v-close-popup clickable @click="openInvite(invite)"><q-item-section avatar><q-icon name="edit" /></q-item-section><q-item-section>Editar</q-item-section></q-item><q-item v-close-popup clickable @click="remove(invite)"><q-item-section avatar><q-icon name="delete" color="negative" /></q-item-section><q-item-section>Remover</q-item-section></q-item></q-list></q-menu></q-btn></div>
          <p class="invite-description">{{ invite.description || 'Sem descrição.' }}</p>
          <div class="invite-meta"><span><q-icon name="ads_click" /> {{ invite.clickCount || invite.clicks || 0 }} cliques</span><span><q-icon name="link" /> {{ invite.links?.length || 0 }} links</span></div>
        </q-card-section>
        <q-separator />
        <q-card-actions class="q-pa-sm"><q-btn flat no-caps color="primary" icon="content_copy" label="Copiar link" @click="copyLink(invite)" /><q-space /><q-btn flat no-caps icon-right="open_in_new" label="Visualizar" :href="publicUrl(invite)" target="_blank" rel="noopener" /></q-card-actions>
      </q-card>
    </section>

    <q-dialog v-model="dialog" persistent maximized-on-mobile>
      <q-card class="invite-dialog">
        <q-card-section class="row items-center q-px-lg"><div><div class="text-h6 text-weight-bold">{{ editingId ? 'Editar convite' : 'Novo convite' }}</div><div class="text-caption text-muted">A prévia reflete a página pública.</div></div><q-space /><q-btn v-close-popup flat round dense icon="close" /></q-card-section>
        <q-separator />
        <q-form @submit.prevent="save">
          <q-card-section class="invite-builder q-pa-lg">
            <section>
              <div class="form-grid">
                <q-input v-model.trim="form.title" outlined label="Título *" :rules="[(v) => Boolean(v) || 'Informe o título']" @update:model-value="onTitleInput" />
                <q-input v-model.trim="form.slug" outlined label="Slug *" prefix="/invite/" :rules="[(v) => Boolean(v) || 'Informe o slug']" />
                <q-input v-model="form.description" outlined type="textarea" label="Descrição" class="full-span" />
                <q-input v-model="form.gradientStart" outlined label="Cor inicial" type="color" />
                <q-input v-model="form.gradientEnd" outlined label="Cor final" type="color" />
                <q-toggle v-model="form.active" label="Página publicada" class="full-span" />
                <q-select v-model="form.recipientContact" outlined clearable emit-value map-options use-input :options="contactOptions" label="Contato destinatário (opcional)" hint="Gera token individual para atribuir cliques" class="full-span" />
              </div>
              <div class="row items-center q-mt-lg q-mb-sm"><div class="text-weight-bold">Links de ação</div><q-space /><q-btn flat color="primary" no-caps icon="add" label="Adicionar" @click="addLink" /></div>
              <div v-for="(link, index) in form.links" :key="index" class="link-row">
                <q-input v-model.trim="link.label" dense outlined label="Título" />
                <q-input v-model.trim="link.url" dense outlined type="url" label="URL" />
                <q-select v-model="link.channel" dense outlined emit-value map-options :options="[{label:'Telegram',value:'telegram'},{label:'WhatsApp Web',value:'whatsapp_web'},{label:'WhatsApp Cloud',value:'whatsapp_cloud'},{label:'Email',value:'email'},{label:'Outro',value:'other'}]" label="Canal" />
                <q-btn flat round dense color="negative" icon="delete" aria-label="Remover link" @click="removeLink(index)" />
              </div>
            </section>

            <aside class="public-preview" :style="{ background: previewGradient }">
              <div class="preview-logo"><q-icon name="notifications_active" /></div>
              <h2>{{ form.title || 'Seu convite' }}</h2>
              <p>{{ form.description || 'Explique por que a pessoa deve escolher um dos canais abaixo.' }}</p>
              <button v-for="(link, index) in form.links.filter((item) => item.label)" :key="index" type="button">{{ link.label }}</button>
              <small>Ao continuar, você será direcionado para o canal escolhido.</small>
            </aside>
          </q-card-section>
          <q-separator />
          <q-card-actions align="right" class="q-pa-md q-px-lg"><q-btn v-close-popup flat no-caps label="Cancelar" /><q-btn type="submit" color="primary" unelevated no-caps icon="save" label="Salvar convite" :loading="saving" /></q-card-actions>
        </q-form>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<style scoped>
.invite-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}

.invite-card {
  overflow: hidden;
}

.invite-cover {
  display: flex;
  height: 110px;
  align-items: flex-start;
  justify-content: space-between;
  padding: 18px;
  color: #031515;
}

.invite-description {
  min-height: 44px;
  color: #617572;
  font-size: 0.82rem;
  line-height: 1.5;
}

.invite-meta {
  display: flex;
  gap: 18px;
  color: #627673;
  font-size: 0.74rem;
}

.invite-dialog {
  width: min(1180px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  border-radius: 24px;
  background: #f9fffd;
}

.invite-builder {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(330px, 0.85fr);
  gap: 28px;
  max-height: calc(100vh - 185px);
  overflow: auto;
}

.link-row {
  display: grid;
  grid-template-columns: 0.8fr 1.2fr 0.65fr auto;
  gap: 8px;
  margin: 8px 0;
}

.public-preview {
  display: flex;
  min-height: 560px;
  align-items: center;
  flex-direction: column;
  justify-content: center;
  padding: 34px;
  border-radius: 22px;
  color: #031515;
  text-align: center;
}

.preview-logo {
  display: grid;
  width: 58px;
  height: 58px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.72);
  font-size: 27px;
  place-items: center;
}

.public-preview h2 {
  margin: 18px 0 8px;
  font-size: 2rem;
  letter-spacing: -0.05em;
}

.public-preview p {
  max-width: 370px;
  line-height: 1.55;
}

.public-preview button {
  width: min(360px, 100%);
  margin: 5px 0;
  padding: 13px 18px;
  border: 1px solid rgba(3, 21, 21, 0.12);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.84);
  color: #031515;
  font-weight: 750;
}

.public-preview small {
  max-width: 350px;
  margin-top: 18px;
  opacity: 0.7;
}

@media (max-width: 1050px) {
  .invite-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .invite-builder {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 680px) {
  .invite-grid {
    grid-template-columns: 1fr;
  }

  .invite-dialog {
    width: 100%;
    max-height: 100%;
    border-radius: 0;
  }

  .link-row {
    grid-template-columns: 1fr auto;
  }

  .link-row > :nth-child(2),
  .link-row > :nth-child(3) {
    grid-column: 1;
  }
}
</style>
