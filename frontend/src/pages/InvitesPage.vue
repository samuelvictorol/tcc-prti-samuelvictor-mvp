<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useQuasar } from 'quasar'
import PageHeader from '../components/PageHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import { errorMessage, fetchAll, http, unwrap } from '../services/http.js'
import {
  defaultInviteActionLink,
  inviteChannelPresentation,
  safeInviteIconUrl,
  slugifyInviteTitle,
} from '../services/public-invites.js'
import { telegramBotIdentity } from '../services/telegram.js'
import { DEFAULT_WHATSAPP_PERMISSION_COMMAND } from '../services/whatsapp.js'

const $q = useQuasar()
const loading = ref(false)
const saving = ref(false)
const dialog = ref(false)
const editingId = ref(null)
const invites = ref([])
const contacts = ref([])
const previewIconFailed = ref(false)
const failedInviteIcons = ref(new Set())
const inviteActionContext = reactive({
  whatsappPhoneNumber: '',
  whatsappPermissionCommand: DEFAULT_WHATSAPP_PERMISSION_COMMAND,
  telegramBotUsername: '',
})

function defaultLinks() {
  return [
    defaultInviteActionLink('whatsapp_cloud', inviteActionContext),
    defaultInviteActionLink('telegram', inviteActionContext),
  ]
}

const emptyForm = () => ({
  title: '',
  slug: '',
  description: '',
  iconeUrl: '',
  gradientStart: '#82F8E6',
  gradientEnd: '#35BCA4',
  active: true,
  recipientContact: null,
  links: defaultLinks(),
})
const form = reactive(emptyForm())

const previewGradient = computed(() => `linear-gradient(145deg, ${safeColor(form.gradientStart)}, ${safeColor(form.gradientEnd)})`)
const previewIcon = computed(() => previewIconFailed.value ? '' : safeInviteIconUrl(form.iconeUrl))
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

function inviteIcon(invite) {
  return failedInviteIcons.value.has(recordId(invite)) ? '' : safeInviteIconUrl(invite?.iconeUrl)
}

function markInviteIconFailed(invite) {
  failedInviteIcons.value = new Set([...failedInviteIcons.value, recordId(invite)])
}

function onTitleInput(value) {
  form.slug = slugifyInviteTitle(value)
}

function onIconInput() {
  previewIconFailed.value = false
}

function iconUrlRule(value) {
  return !String(value || '').trim() || Boolean(safeInviteIconUrl(value)) || 'Informe uma URL HTTPS pública e segura'
}

function actionLinkHint(link) {
  if (link.channel === 'telegram' && !link.url) return 'Bot não identificado. Configure e valide o token do Telegram na tela Início.'
  if (link._generated && link.channel === 'whatsapp_cloud') {
    return inviteActionContext.whatsappPhoneNumber
      ? 'Gerada com o número público e o comando de autorização atuais; você pode editar.'
      : 'Sem número público configurado: o link abre o seletor do WhatsApp com o comando preenchido.'
  }
  return link._generated ? 'Gerada pelas configurações atuais; você pode editar.' : undefined
}

async function loadInvites() {
  loading.value = true
  const defaultsPromise = loadInviteDefaults()
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
    await defaultsPromise
    loading.value = false
  }
}

function refreshGeneratedLinks() {
  form.links.forEach((link) => {
    if (!link._generated) return
    Object.assign(link, defaultInviteActionLink(link.channel, inviteActionContext))
  })
}

async function loadInviteDefaults() {
  const [settingsResult, telegramResult] = await Promise.allSettled([
    http.get('/settings'),
    http.get('/telegram/status', { params: { probe: true } }),
  ])
  if (settingsResult.status === 'fulfilled') {
    const payload = unwrap(settingsResult.value) || {}
    const configuration = payload.configuration || payload.settings || payload
    inviteActionContext.whatsappPhoneNumber = configuration.whatsappCloud?.displayPhoneNumber
      || configuration.whatsapp_cloud?.displayPhoneNumber
      || ''
    inviteActionContext.whatsappPermissionCommand = configuration.whatsappPermission?.command
      || configuration.whatsapp_permission?.command
      || configuration.whatsappCloud?.permissionCommand
      || DEFAULT_WHATSAPP_PERMISSION_COMMAND
  }
  if (telegramResult.status === 'fulfilled') {
    inviteActionContext.telegramBotUsername = telegramBotIdentity(unwrap(telegramResult.value))?.username || ''
  }
  refreshGeneratedLinks()
}

function openInvite(invite) {
  editingId.value = invite ? recordId(invite) : null
  Object.assign(form, emptyForm(), invite ? {
    title: invite.title || '',
    slug: invite.slug || '',
    description: invite.description || '',
    iconeUrl: invite.iconeUrl || '',
    gradientStart: invite.gradientStart || invite.theme?.gradientStart || '#82F8E6',
    gradientEnd: invite.gradientEnd || invite.theme?.gradientEnd || '#35BCA4',
    active: invite.active !== false,
    recipientContact: typeof invite.recipientContact === 'object'
      ? (invite.recipientContact?.id || invite.recipientContact?._id)
      : (invite.recipientContact || null),
    links: (invite.links || []).length ? invite.links.map((link) => ({
      label: link.label || link.title || '',
      url: link.url || link.linkUrl || link.link_url || '',
      channel: link.channel || link.type || 'other',
      active: link.active ?? link.enabled ?? true,
      _generated: false,
    })) : defaultLinks(),
  } : {})
  previewIconFailed.value = false
  dialog.value = true
}

function addLink() {
  form.links.push(defaultInviteActionLink('other', inviteActionContext))
}

function onLinkChannelChange(link, channel) {
  Object.assign(link, defaultInviteActionLink(channel, inviteActionContext))
}

function markLinkEdited(link) {
  link._generated = false
}

function removeLink(index) {
  form.links.splice(index, 1)
}

async function save() {
  saving.value = true
  const payload = {
    title: form.title,
    description: form.description,
    iconeUrl: safeInviteIconUrl(form.iconeUrl) || null,
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
          <div class="invite-cover-icon">
            <img v-if="inviteIcon(invite)" :src="inviteIcon(invite)" :alt="`Ícone de ${invite.title}`" referrerpolicy="no-referrer" @error="markInviteIconFailed(invite)" />
            <q-icon v-else name="notifications_active" size="29px" />
          </div>
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

    <q-dialog v-model="dialog" persistent :maximized="$q.screen.lt.md">
      <q-card class="invite-dialog">
        <q-card-section class="row items-center q-px-lg invite-dialog__header"><div><div class="text-h6 text-weight-bold">{{ editingId ? 'Editar convite' : 'Novo convite' }}</div><div class="text-caption text-muted">A prévia reflete a página pública.</div></div><q-space /><q-btn v-close-popup flat round dense icon="close" /></q-card-section>
        <q-separator />
        <q-form class="invite-dialog__form" @submit.prevent="save">
          <q-card-section class="invite-builder q-pa-lg">
            <section>
              <div class="form-grid">
                <q-input v-model.trim="form.title" outlined label="Título *" :rules="[(v) => Boolean(v) || 'Informe o título']" @update:model-value="onTitleInput" />
                <q-input v-model="form.slug" outlined readonly label="Slug automático" prefix="/invite/" hint="A API adiciona um sufixo automaticamente se este endereço já estiver em uso" />
                <q-input v-model="form.description" outlined type="textarea" label="Descrição" class="full-span" />
                <q-input v-model.trim="form.iconeUrl" outlined type="url" label="URL HTTPS do ícone" hint="Imagem pública usada no lugar do ícone padrão" :rules="[iconUrlRule]" class="full-span" @update:model-value="onIconInput" />
                <q-input v-model="form.gradientStart" outlined label="Cor inicial" type="color" />
                <q-input v-model="form.gradientEnd" outlined label="Cor final" type="color" />
                <q-toggle v-model="form.active" label="Página publicada" class="full-span" />
                <q-select v-model="form.recipientContact" outlined clearable emit-value map-options use-input :options="contactOptions" label="Contato destinatário (opcional)" hint="Gera token individual para atribuir cliques" class="full-span" />
              </div>
              <div class="row items-center q-mt-lg q-mb-sm"><div class="text-weight-bold">Links de ação</div><q-space /><q-btn flat color="primary" no-caps icon="add" label="Adicionar" @click="addLink" /></div>
              <div v-for="(link, index) in form.links" :key="index" class="link-row">
                <q-input v-model.trim="link.label" dense outlined label="Título" @update:model-value="markLinkEdited(link)" />
                <q-input
                  v-model.trim="link.url"
                  dense
                  outlined
                  type="url"
                  label="URL"
                  :hint="actionLinkHint(link)"
                  @update:model-value="markLinkEdited(link)"
                />
                <q-select
                  v-model="link.channel"
                  dense
                  outlined
                  emit-value
                  map-options
                  :options="[{label:'Telegram',value:'telegram'},{label:'WhatsApp Cloud',value:'whatsapp_cloud'},{label:'Email',value:'email'},{label:'Outro',value:'other'}]"
                  label="Canal"
                  @update:model-value="onLinkChannelChange(link, $event)"
                />
                <q-btn flat round dense color="negative" icon="delete" aria-label="Remover link" @click="removeLink(index)" />
              </div>
            </section>

            <aside class="public-preview" :style="{ background: previewGradient }">
              <div class="preview-logo">
                <img v-if="previewIcon" :src="previewIcon" alt="Prévia do ícone" referrerpolicy="no-referrer" @error="previewIconFailed = true" />
                <q-icon v-else name="notifications_active" />
              </div>
              <h2>{{ form.title || 'Seu convite' }}</h2>
              <p>{{ form.description || 'Explique por que a pessoa deve escolher um dos canais abaixo.' }}</p>
              <div class="preview-links">
                <div
                  v-for="(link, index) in form.links.filter((item) => item.label)"
                  :key="index"
                  :class="['preview-action', `preview-action--${inviteChannelPresentation(link.channel).tone}`]"
                  aria-hidden="true"
                >
                  <span class="preview-action__icon"><q-icon :name="inviteChannelPresentation(link.channel).icon" /></span>
                  <span class="preview-action__copy">
                    <strong>{{ link.label }}</strong>
                    <small>{{ inviteChannelPresentation(link.channel).caption }}</small>
                  </span>
                  <q-icon name="arrow_forward" />
                </div>
              </div>
              <div class="preview-profile" aria-hidden="true">
                <span class="preview-profile__icon"><q-icon name="manage_accounts" /></span>
                <span class="preview-profile__copy">
                  <small>Já possui cadastro?</small>
                  <strong>Meu perfil e permissões</strong>
                  <span>Revise seus dados e canais autorizados.</span>
                </span>
                <q-icon name="arrow_forward" />
              </div>
              <small class="preview-footnote">Ao continuar, você será direcionado para o canal escolhido.</small>
            </aside>
          </q-card-section>
          <q-separator />
          <q-card-actions align="right" class="q-pa-md q-px-lg invite-dialog__footer"><q-btn v-close-popup flat no-caps label="Cancelar" /><q-btn type="submit" color="primary" unelevated no-caps icon="save" label="Salvar convite" :loading="saving" /></q-card-actions>
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

.invite-cover-icon {
  display: grid;
  width: 52px;
  height: 52px;
  overflow: hidden;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
  place-items: center;
}

.invite-cover-icon img,
.preview-logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
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
  display: flex;
  width: min(1180px, calc(100vw - 32px));
  max-width: 1180px !important;
  height: min(820px, calc(100dvh - 32px));
  max-height: calc(100dvh - 32px);
  flex-direction: column;
  overflow: hidden;
  border-radius: 24px;
  background: #f9fffd;
}

.invite-dialog__form {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
}

.invite-dialog__header,
.invite-dialog__footer {
  flex: 0 0 auto;
  background: #f9fffd;
}

.invite-dialog__footer {
  flex-wrap: wrap;
}

.invite-builder {
  display: grid;
  min-height: 0;
  grid-template-columns: minmax(0, 1.15fr) minmax(330px, 0.85fr);
  align-content: start;
  flex: 1 1 auto;
  gap: 28px;
  overflow: auto;
  overscroll-behavior: contain;
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
  overflow: hidden;
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

.preview-links {
  display: grid;
  width: min(380px, 100%);
  gap: 9px;
}

.preview-action {
  display: grid;
  width: min(360px, 100%);
  min-height: 60px;
  margin: 0 auto;
  padding: 8px 11px;
  border: 1px solid rgba(255, 255, 255, 0.32);
  border-radius: 17px;
  grid-template-columns: 39px minmax(0, 1fr) 20px;
  align-items: center;
  gap: 10px;
  box-shadow: 0 10px 23px rgba(3, 62, 55, 0.13);
  color: #fff;
  text-align: left;
}

.preview-action--whatsapp {
  background: linear-gradient(135deg, #075e54, #0b7a62);
}

.preview-action--telegram {
  background: linear-gradient(135deg, #0e5d88, #167eaa);
}

.preview-action--email {
  background: linear-gradient(135deg, #8e2531, #b83f4a);
}

.preview-action--default {
  background: linear-gradient(135deg, #075e54, #0b7a62);
}

.preview-action__icon,
.preview-profile__icon {
  display: grid;
  width: 39px;
  height: 39px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.18);
  font-size: 22px;
  place-items: center;
}

.preview-action__copy,
.preview-profile__copy {
  display: grid;
  min-width: 0;
  line-height: 1.18;
}

.preview-action__copy strong {
  font-size: 0.82rem;
}

.preview-action__copy small {
  margin-top: 3px;
  color: rgba(255, 255, 255, 0.82);
  font-size: 0.6rem;
  opacity: 1;
}

.preview-profile {
  display: grid;
  width: min(360px, 100%);
  min-height: 72px;
  margin-top: 13px;
  padding: 9px 11px;
  border: 1px solid rgba(5, 103, 91, 0.23);
  border-radius: 18px;
  grid-template-columns: 39px minmax(0, 1fr) 20px;
  align-items: center;
  gap: 10px;
  background: linear-gradient(135deg, rgba(255,255,255,.95), rgba(222,250,244,.95));
  box-shadow: 0 10px 23px rgba(3, 62, 55, 0.11);
  color: #073b35;
  text-align: left;
}

.preview-profile__icon {
  background: linear-gradient(145deg, #c8f7ec, #83ead7);
  color: #087e73;
}

.preview-profile__copy small {
  color: #168171;
  font-size: 0.55rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  opacity: 1;
  text-transform: uppercase;
}

.preview-profile__copy strong {
  margin-top: 2px;
  font-size: 0.78rem;
}

.preview-profile__copy span {
  margin-top: 3px;
  color: #52716c;
  font-size: 0.6rem;
}

.preview-footnote {
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
    max-width: 100% !important;
    height: 100%;
    max-height: 100%;
    border-radius: 0;
  }

  .invite-dialog__header,
  .invite-builder {
    padding-right: 16px;
    padding-left: 16px;
  }

  .invite-dialog__footer {
    padding-right: 16px;
    padding-bottom: max(12px, env(safe-area-inset-bottom));
    padding-left: 16px;
  }

  .public-preview {
    min-height: 440px;
    padding: 24px 18px;
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
