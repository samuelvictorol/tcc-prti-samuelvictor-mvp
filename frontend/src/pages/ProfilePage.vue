<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useQuasar } from 'quasar'
import { errorMessage } from '../services/http.js'
import {
  normalizeProfileIdentifierForRequest,
  profileIdentifierRule,
  updateBrazilianProfilePhoneInput,
} from '../services/profile-identifier.js'
import {
  clearProfileSession,
  exchangeProfileLink,
  fetchOwnProfile,
  fetchProfileActivationLinks,
  fetchProfileHistory,
  fetchProfileMemberships,
  fetchOwnGroupDetails,
  getProfileToken,
  leaveOwnContactGroup,
  removeOwnInviteMembership,
  requestProfileLogin,
  revokeOwnConsent,
  setOwnEmailConsent,
  updateOwnProfile,
} from '../services/profile.js'

const $q = useQuasar()
const step = ref(getProfileToken() ? 'profile' : 'identifier')
const loading = ref(false)
const profile = ref(null)
const activationLinks = ref(null)
const identifierType = ref('phone')
const emailIdentifier = ref('')
const phoneIdentifier = ref('')
const loginRequest = reactive({
  deliveryChannel: '',
  expiresAt: '',
  whatsappUrl: '',
  command: '/login',
  message: '',
})
const editMode = ref(false)
const editForm = reactive({ displayName: '', email: '', phone: '', telegramUsername: '' })
const revokeDialog = ref(false)
const revokeChannel = ref(null)
const emailConsentDialog = ref(false)
const emailConsentEnabled = ref(false)
const history = ref([])
const historyLoading = ref(false)
const historyPagination = reactive({ page: 1, rowsPerPage: 10, rowsNumber: 0 })
const memberships = reactive({ invites: [], groups: [] })
const membershipsLoading = ref(false)
const groupDetailsDialog = ref(false)
const groupDetailsLoading = ref(false)
const selectedGroup = ref(null)
const leaveGroupDialog = ref(false)
const leaveGroupTarget = ref(null)
const removeInviteDialog = ref(false)
const removeInviteTarget = ref(null)

const identifierTypeOptions = Object.freeze([
  { label: 'Telefone', value: 'phone', icon: 'phone' },
  { label: 'E-mail', value: 'email', icon: 'alternate_email' },
])

const channelMeta = Object.freeze({
  telegram: { label: 'Telegram', icon: 'send_to_mobile', color: 'info' },
  whatsapp_cloud: { label: 'WhatsApp Cloud', icon: 'cloud_sync', color: 'positive' },
  email: { label: 'Email', icon: 'mail', color: 'deep-purple' },
})

const permissionCards = computed(() => (profile.value?.permissions || [])
  .filter((permission) => Boolean(channelMeta[permission.channel]))
  .map((permission) => ({
    ...permission,
    ...channelMeta[permission.channel],
  })))

const fallbackProfileCommands = Object.freeze({
  whatsapp: [
    { command: '/notify-me', title: 'Autorizar notificações', description: 'Autoriza as notificações pelo WhatsApp oficial.', dynamic: true },
    { command: '/login', title: 'Entrar no Meu perfil', description: 'Gera um link temporário e de uso único.' },
    { command: '/meu-perfil', title: 'Consultar meus dados', description: 'Mostra um resumo do cadastro e das permissões.' },
    { command: '/help', title: 'Ver ajuda', description: 'Lista os comandos disponíveis no WhatsApp.' },
    { command: '/cancelar', title: 'Cancelar alteração de email', description: 'Interrompe uma verificação de email em andamento.' },
  ],
  telegram: [
    { command: '/verify-me', title: 'Autorizar o Telegram', description: 'Autoriza notificações e abre o menu inicial.', dynamic: true },
    { command: '/notify-me', title: 'Autorizar pelo convite', description: 'O comando do WhatsApp também inicia o onboarding no Telegram.', dynamic: true },
    { command: '/start', title: 'Iniciar o bot', description: 'Inicia a conversa; links de convite incluem o vínculo automaticamente.' },
    { command: '/login', title: 'Entrar no Meu perfil', description: 'Gera um link temporário e de uso único.' },
    { command: '/meu-perfil', title: 'Consultar meus dados', description: 'Mostra um resumo do cadastro e das permissões.' },
    { command: '/help', title: 'Ver ajuda', description: 'Lista os comandos disponíveis no Telegram.' },
    { command: '/cancelar', title: 'Cancelar alteração de email', description: 'Interrompe uma verificação de email em andamento.' },
    { command: '/stop', title: 'Revogar o Telegram', description: 'Desativa a permissão do canal até uma nova autorização.' },
  ],
})

const contactCommandGuides = computed(() => [
  {
    channel: 'WhatsApp',
    accent: 'whatsapp',
    icon: 'cloud_sync',
    commands: activationLinks.value?.helpCommands?.whatsapp?.length
      ? activationLinks.value.helpCommands.whatsapp
      : fallbackProfileCommands.whatsapp,
    note: 'Você também pode enviar um email válido para iniciar a confirmação desse endereço diretamente na conversa.',
  },
  {
    channel: 'Telegram',
    accent: 'telegram',
    icon: 'send_to_mobile',
    commands: activationLinks.value?.helpCommands?.telegram?.length
      ? activationLinks.value.helpCommands.telegram
      : fallbackProfileCommands.telegram,
    note: 'Compartilhe o telefone somente pelo botão oficial do bot para vincular Telegram e WhatsApp com segurança.',
  },
])

const historyColumns = [
  { name: 'date', label: 'Data', field: 'updatedAt', align: 'left' },
  { name: 'channel', label: 'Canal', field: 'channel', align: 'left' },
  { name: 'template', label: 'Template / origem', field: 'template', align: 'left' },
  { name: 'status', label: 'Status', field: 'status', align: 'left' },
  { name: 'attempts', label: 'Tentativas', field: 'attempts', align: 'center' },
]

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function statusLabel(value) {
  return {
    queued: 'Na fila', processing: 'Processando', sent: 'Enviada', delivered: 'Entregue', read: 'Lida',
    failed: 'Falhou', skipped: 'Ignorada', revoked: 'Revogada', granted: 'Permitida', unknown: 'Não autorizada',
  }[value] || value || '—'
}

function statusColor(value) {
  if (['sent', 'delivered', 'read', 'granted'].includes(value)) return 'positive'
  if (['failed', 'revoked'].includes(value)) return 'negative'
  if (['queued', 'processing'].includes(value)) return 'warning'
  return 'grey-7'
}

function historyAudienceLabel(row) {
  const groupNames = (row.groups || []).map((group) => group.name).join(', ')
  if (row.notification?.scope === 'global') {
    return row.notification?.viaGroup && groupNames ? `Global · via ${groupNames}` : 'Global'
  }
  if (row.notification?.scope === 'group' || groupNames) return `Grupo · ${groupNames}`
  return 'Individual'
}

function onPhoneIdentifierInput(value) {
  phoneIdentifier.value = updateBrazilianProfilePhoneInput(value, phoneIdentifier.value)
}

function resetIdentifier() {
  identifierType.value = 'phone'
  emailIdentifier.value = ''
  phoneIdentifier.value = ''
}

function clearLoadedProfileState() {
  profile.value = null
  activationLinks.value = null
  history.value = []
  historyPagination.page = 1
  historyPagination.rowsNumber = 0
  memberships.invites = []
  memberships.groups = []
  selectedGroup.value = null
  groupDetailsDialog.value = false
  leaveGroupDialog.value = false
  leaveGroupTarget.value = null
  removeInviteDialog.value = false
  removeInviteTarget.value = null
  editMode.value = false
  Object.assign(editForm, {
    displayName: '',
    email: '',
    phone: '',
    telegramUsername: '',
  })
}

function useAnotherIdentifier() {
  Object.assign(loginRequest, {
    deliveryChannel: '',
    expiresAt: '',
    whatsappUrl: '',
    command: '/login',
    message: '',
  })
  clearLoadedProfileState()
  step.value = 'identifier'
}

function syncEditForm() {
  Object.assign(editForm, {
    displayName: profile.value?.displayName || '',
    email: profile.value?.email || '',
    phone: profile.value?.phone || '',
    telegramUsername: profile.value?.telegramUsername || '',
  })
}

async function loadHistory(pagination = historyPagination) {
  historyLoading.value = true
  try {
    const result = await fetchProfileHistory({ page: pagination.page, limit: pagination.rowsPerPage })
    history.value = result.items || []
    historyPagination.page = Number(result.page || pagination.page)
    historyPagination.rowsPerPage = Number(result.limit || pagination.rowsPerPage)
    historyPagination.rowsNumber = Number(result.total || 0)
  } catch (error) {
    $q.notify({ type: 'warning', message: errorMessage(error, 'Não foi possível carregar seu histórico.') })
  } finally {
    historyLoading.value = false
  }
}

async function loadMemberships() {
  membershipsLoading.value = true
  try {
    const result = await fetchProfileMemberships()
    memberships.invites = result.invites || []
    memberships.groups = result.groups || []
  } catch (error) {
    $q.notify({ type: 'warning', message: errorMessage(error, 'Não foi possível carregar seus convites e grupos.') })
  } finally {
    membershipsLoading.value = false
  }
}

async function loadProfile() {
  loading.value = true
  clearLoadedProfileState()
  try {
    profile.value = await fetchOwnProfile()
    syncEditForm()
    step.value = 'profile'
    await Promise.all([
      loadHistory(),
      loadMemberships(),
      fetchProfileActivationLinks().then((value) => { activationLinks.value = value }).catch(() => undefined),
    ])
  } catch (error) {
    clearProfileSession()
    clearLoadedProfileState()
    step.value = 'identifier'
    $q.notify({ type: 'warning', message: errorMessage(error, 'Sua sessão expirou. Solicite um novo link.') })
  } finally {
    loading.value = false
  }
}

async function requestLogin() {
  loading.value = true
  const whatsappWindow = identifierType.value === 'phone' ? window.open('', '_blank') : null
  if (whatsappWindow) whatsappWindow.opener = null
  try {
    const identifier = identifierType.value === 'phone'
      ? phoneIdentifier.value
      : emailIdentifier.value
    const result = await requestProfileLogin(
      normalizeProfileIdentifierForRequest(identifier, identifierType.value),
      identifierType.value,
    )
    Object.assign(loginRequest, {
      deliveryChannel: result.deliveryChannel || identifierType.value,
      expiresAt: result.expiresAt || '',
      whatsappUrl: result.whatsappUrl || '',
      command: result.command || '/login',
      message: result.message || '',
    })
    step.value = 'waiting'
    if (loginRequest.whatsappUrl) {
      if (whatsappWindow) whatsappWindow.location.href = loginRequest.whatsappUrl
      else window.location.href = loginRequest.whatsappUrl
    } else {
      whatsappWindow?.close()
    }
    $q.notify({
      type: 'positive',
      message: identifierType.value === 'phone'
        ? 'Conversa oficial aberta no WhatsApp.'
        : 'Link seguro enviado para seu email.',
      caption: result.message,
    })
  } catch (error) {
    whatsappWindow?.close()
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível solicitar o acesso.') })
  } finally {
    loading.value = false
  }
}

async function exchangeLinkToken(token) {
  loading.value = true
  clearLoadedProfileState()
  step.value = 'identifier'
  try {
    const result = await exchangeProfileLink(token)
    profile.value = result.profile
    syncEditForm()
    step.value = 'profile'
    await Promise.all([
      loadHistory(),
      loadMemberships(),
      fetchProfileActivationLinks().then((value) => { activationLinks.value = value }).catch(() => undefined),
    ])
  } catch (error) {
    clearProfileSession()
    step.value = 'identifier'
    $q.notify({ type: 'negative', message: errorMessage(error, 'Link de acesso inválido, expirado ou já utilizado.') })
  } finally {
    loading.value = false
  }
}

function profileLinkTokenFromFragment() {
  const token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('acesso')
  if (!token) return null
  // Limpa o segredo antes de qualquer chamada de rede, render ou navegação.
  window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`)
  return token
}

async function saveProfile() {
  loading.value = true
  try {
    profile.value = await updateOwnProfile({
      displayName: editForm.displayName,
      email: editForm.email || null,
      phone: editForm.phone || null,
      telegramUsername: editForm.telegramUsername || null,
    })
    syncEditForm()
    editMode.value = false
    $q.notify({ type: 'positive', message: 'Seus dados foram atualizados.' })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível atualizar seus dados.') })
  } finally {
    loading.value = false
  }
}

function confirmRevoke(channel) {
  revokeChannel.value = channel
  revokeDialog.value = true
}

async function revokePermission() {
  loading.value = true
  try {
    profile.value = await revokeOwnConsent(revokeChannel.value)
    revokeDialog.value = false
    $q.notify({ type: 'positive', message: `Permissão de ${channelMeta[revokeChannel.value]?.label || revokeChannel.value} revogada.` })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível revogar a permissão.') })
  } finally {
    loading.value = false
  }
}

function confirmEmailConsent(enabled) {
  emailConsentEnabled.value = enabled
  emailConsentDialog.value = true
}

async function saveEmailConsent() {
  loading.value = true
  try {
    profile.value = await setOwnEmailConsent(emailConsentEnabled.value)
    emailConsentDialog.value = false
    $q.notify({
      type: 'positive',
      message: emailConsentEnabled.value
        ? 'Permissão de email ativada.'
        : 'Permissão de email revogada.',
    })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível alterar a permissão de email.') })
  } finally {
    loading.value = false
  }
}

async function openGroupDetails(group) {
  groupDetailsDialog.value = true
  groupDetailsLoading.value = true
  selectedGroup.value = { ...group, members: [] }
  try {
    selectedGroup.value = await fetchOwnGroupDetails(group.id)
  } catch (error) {
    groupDetailsDialog.value = false
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível abrir este grupo.') })
  } finally {
    groupDetailsLoading.value = false
  }
}

function confirmLeaveGroup(group = selectedGroup.value) {
  leaveGroupTarget.value = group
  leaveGroupDialog.value = true
}

async function leaveGroup() {
  if (!leaveGroupTarget.value?.id) return
  loading.value = true
  try {
    await leaveOwnContactGroup(leaveGroupTarget.value.id)
    memberships.groups = memberships.groups.filter((group) => group.id !== leaveGroupTarget.value.id)
    leaveGroupDialog.value = false
    groupDetailsDialog.value = false
    selectedGroup.value = null
    $q.notify({ type: 'positive', message: 'Seu contato foi removido do grupo.' })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível sair do grupo.') })
  } finally {
    loading.value = false
  }
}

function confirmRemoveInvite(invite) {
  removeInviteTarget.value = invite
  removeInviteDialog.value = true
}

async function removeInvite() {
  if (!removeInviteTarget.value?.id) return
  loading.value = true
  try {
    await removeOwnInviteMembership(removeInviteTarget.value.id)
    const inviteId = removeInviteTarget.value.id
    memberships.invites = memberships.invites.filter((invite) => invite.id !== inviteId)
    await loadMemberships()
    removeInviteDialog.value = false
    $q.notify({
      type: 'positive',
      message: 'O convite foi removido do seu perfil e dos grupos sincronizados.',
    })
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível remover o convite.') })
  } finally {
    loading.value = false
  }
}

function activationFor(channel) {
  if (channel === 'telegram') return activationLinks.value?.telegram
  if (channel === 'whatsapp_cloud') return activationLinks.value?.whatsapp
  return null
}

function logout() {
  clearProfileSession()
  clearLoadedProfileState()
  resetIdentifier()
  step.value = 'identifier'
}

function onProfileSessionExpired() {
  clearLoadedProfileState()
  step.value = 'identifier'
  $q.notify({ type: 'warning', message: 'Sua sessão de perfil expirou. Solicite um novo link.' })
}

onMounted(() => {
  window.addEventListener('notify:profile-session-expired', onProfileSessionExpired)
  const linkToken = profileLinkTokenFromFragment()
  if (linkToken) exchangeLinkToken(linkToken)
  else if (getProfileToken()) loadProfile()
})

onBeforeUnmount(() => window.removeEventListener('notify:profile-session-expired', onProfileSessionExpired))
</script>

<template>
  <q-layout view="hHh lpR fFf" class="profile-shell">
    <q-header class="profile-header">
      <q-toolbar class="profile-toolbar">
        <router-link to="/meu-perfil" class="profile-brand">
          <span><q-icon name="notifications_active" /></span>
          Notify <strong>Flow</strong>
        </router-link>
        <q-space />
        <q-btn v-if="step === 'profile'" flat no-caps icon="logout" label="Sair" @click="logout" />
      </q-toolbar>
    </q-header>

    <q-page-container>
      <q-page class="profile-page">
        <section v-if="step !== 'profile'" class="profile-auth-wrap">
          <q-card flat class="profile-auth-card">
            <q-card-section>
              <div class="auth-icon"><q-icon name="login" /></div>
              <div class="eyebrow">MEU PERFIL</div>
              <h1>Seus dados e permissões, sob seu controle.</h1>
              <p v-if="step === 'identifier'">
                Entre com seu telefone pelo WhatsApp oficial ou receba um link seguro no email já cadastrado.
              </p>
              <p v-else>
                {{ loginRequest.message }}
              </p>
            </q-card-section>

            <q-card-section v-if="step === 'identifier'">
              <q-form @submit.prevent="requestLogin">
                <q-select
                  v-model="identifierType"
                  outlined
                  emit-value
                  map-options
                  label="Entrar usando"
                  :options="identifierTypeOptions"
                  class="identifier-type-select"
                >
                  <template #prepend>
                    <q-icon :name="identifierType === 'phone' ? 'phone' : 'alternate_email'" />
                  </template>
                  <template #option="scope">
                    <q-item v-bind="scope.itemProps">
                      <q-item-section avatar><q-icon :name="scope.opt.icon" /></q-item-section>
                      <q-item-section><q-item-label>{{ scope.opt.label }}</q-item-label></q-item-section>
                    </q-item>
                  </template>
                </q-select>

                <q-slide-transition>
                  <div :key="identifierType" class="identifier-input-wrap">
                    <q-input
                      v-if="identifierType === 'email'"
                      v-model.trim="emailIdentifier"
                      outlined
                      label="E-mail"
                      type="email"
                      inputmode="email"
                      autocomplete="email"
                      hint="Digite seu e-mail completo"
                      :rules="[(value) => profileIdentifierRule(value, 'email')]"
                    >
                      <template #prepend><q-icon name="alternate_email" /></template>
                    </q-input>
                    <q-input
                      v-else
                      :model-value="phoneIdentifier"
                      @update:model-value="onPhoneIdentifierInput"
                      outlined
                      label="Telefone"
                      type="tel"
                      inputmode="tel"
                      autocomplete="tel-national"
                      maxlength="16"
                      hint="Use o DDD e o número, sem o código +55"
                      :rules="[(value) => profileIdentifierRule(value, 'phone')]"
                    >
                      <template #prepend><q-icon name="phone" /></template>
                    </q-input>
                  </div>
                </q-slide-transition>
                <q-btn
                  type="submit"
                  color="dark"
                  unelevated
                  no-caps
                  size="lg"
                  class="full-width"
                  icon-right="arrow_forward"
                  :label="identifierType === 'phone' ? 'Continuar pelo WhatsApp' : 'Receber link por email'"
                  :loading="loading"
                />
              </q-form>
              <q-banner rounded class="neutral-note q-mt-lg">
                Se não houver um cadastro único para o identificador informado, avisaremos antes de tentar o envio.
              </q-banner>
            </q-card-section>

            <q-card-section v-else>
              <q-banner rounded class="activation-note q-mb-md">
                <template v-if="loginRequest.deliveryChannel === 'whatsapp_cloud'">
                  Envie a mensagem <strong>{{ loginRequest.command }}</strong> que já está pronta na conversa.
                  O WhatsApp responderá com um link de uso único.
                  <a v-if="loginRequest.whatsappUrl" :href="loginRequest.whatsappUrl" target="_blank" rel="noopener noreferrer">Abrir novamente</a>.
                </template>
                <template v-else>
                  Verifique sua caixa de entrada e abra o link de uso único enviado ao email cadastrado.
                </template>
              </q-banner>
              <q-btn flat no-caps class="full-width q-mt-sm" label="Usar outro email ou telefone" @click="useAnotherIdentifier" />
            </q-card-section>
          </q-card>
        </section>

        <main v-else class="profile-content">
          <section class="profile-hero">
            <div>
              <div class="eyebrow">ÁREA DO CONTATO</div>
              <h1>Olá, {{ profile?.displayName }}.</h1>
              <p>Revise seus dados, controle cada canal e acompanhe somente as entregas associadas ao seu cadastro.</p>
            </div>
            <q-avatar size="82px" color="primary" text-color="dark">
              <img v-if="profile?.avatarUrl" :src="profile.avatarUrl" alt="Foto do perfil">
              <q-icon v-else name="person" size="42px" />
            </q-avatar>
          </section>

          <section class="profile-grid">
            <q-card flat class="profile-card profile-card--data">
              <q-card-section class="card-heading">
                <div><span>DADOS PESSOAIS</span><h2>Identificação</h2></div>
                <q-btn v-if="!editMode" flat round icon="edit" aria-label="Editar dados" @click="editMode = true" />
              </q-card-section>
              <q-card-section v-if="!editMode" class="data-list">
                <div><q-icon name="badge" /><span><small>Nome</small>{{ profile?.displayName || '—' }}</span></div>
                <div><q-icon name="mail" /><span><small>Email</small>{{ profile?.email || 'Não informado' }}</span></div>
                <div>
                  <q-icon name="phone" />
                  <span>
                    <small>Telefone</small>{{ profile?.phone || 'Não informado' }}
                    <em v-if="profile?.phoneUnavailableReason">O identificador interno do WhatsApp não é usado como telefone.</em>
                  </span>
                </div>
                <div><q-icon name="alternate_email" /><span><small>Telegram</small>{{ profile?.telegramUsername ? `@${profile.telegramUsername}` : 'Não informado' }}</span></div>
              </q-card-section>
              <q-card-section v-else>
                <q-form class="edit-grid" @submit.prevent="saveProfile">
                  <q-input v-model.trim="editForm.displayName" outlined label="Nome" />
                  <q-input v-model.trim="editForm.email" outlined type="email" label="Email" />
                  <q-input v-model.trim="editForm.phone" outlined label="Telefone" />
                  <q-input v-model.trim="editForm.telegramUsername" outlined label="Usuário Telegram" />
                  <div class="edit-actions">
                    <q-btn flat no-caps label="Cancelar" @click="editMode = false; syncEditForm()" />
                    <q-btn type="submit" color="primary" text-color="dark" unelevated no-caps icon="save" label="Salvar" :loading="loading" />
                  </div>
                </q-form>
              </q-card-section>
            </q-card>

            <q-card flat class="profile-card profile-card--permissions">
              <q-card-section class="card-heading">
                <div><span>PRIVACIDADE</span><h2>Permissões por canal</h2></div>
                <q-icon name="verified_user" color="primary" size="30px" />
              </q-card-section>
              <q-card-section class="permission-list">
                <article v-for="permission in permissionCards" :key="permission.channel" class="permission-row">
                  <q-avatar :color="permission.authorized ? permission.color : 'grey-3'" :text-color="permission.authorized ? 'white' : 'grey-7'" :icon="permission.icon" />
                  <div class="permission-copy">
                    <strong>{{ permission.label }}</strong>
                    <span v-if="permission.pending">Autorização aguardando identidade real do provedor</span>
                    <span v-else>{{ permission.authorized ? 'Envios autorizados' : statusLabel(permission.consentStatus) }}</span>
                    <small v-if="!permission.authorized && activationFor(permission.channel)">
                      {{ activationFor(permission.channel).explanation || `Ative enviando ${activationFor(permission.channel).command}` }}
                    </small>
                  </div>
                  <q-badge :color="permission.authorized || permission.pending ? 'positive' : 'grey-6'" :label="permission.pending ? 'Pendente' : permission.authorized ? 'Ativo' : 'Inativo'" />
                  <q-btn
                    v-if="permission.channel === 'email'"
                    flat round :color="permission.authorized ? 'negative' : 'primary'"
                    :icon="permission.authorized ? 'remove_circle_outline' : 'add_circle_outline'"
                    :aria-label="permission.authorized ? 'Revogar Email' : 'Ativar Email'"
                    @click="confirmEmailConsent(!permission.authorized)"
                  />
                  <q-btn
                    v-else-if="permission.authorized || permission.pending"
                    flat round color="negative" icon="remove_circle_outline"
                    :aria-label="`Revogar ${permission.label}`"
                    @click="confirmRevoke(permission.channel)"
                  />
                  <q-btn
                    v-else-if="activationFor(permission.channel)"
                    flat round color="primary" icon="add_link"
                    :href="activationFor(permission.channel).url || undefined"
                    target="_blank"
                    :disable="!activationFor(permission.channel).url"
                    :title="activationFor(permission.channel).unavailableReason || 'Ativar canal'"
                  />
                </article>
                <q-banner rounded class="activation-note">
                  O email pode ser ativado ou revogado aqui com confirmação. Telegram e WhatsApp exigem interação pelo canal. No Telegram, o link adapta o comando configurado ao formato seguro <code>/start ...</code> aceito pelo bot.
                </q-banner>
              </q-card-section>
            </q-card>
          </section>

          <q-card flat class="profile-card profile-commands-card">
            <q-card-section class="card-heading">
              <div><span>AJUDA RÁPIDA</span><h2>Comandos das suas conversas</h2></div>
              <q-icon name="support_agent" color="primary" size="30px" />
            </q-card-section>
            <q-card-section class="profile-command-grid">
              <section
                v-for="guide in contactCommandGuides"
                :key="guide.channel"
                :class="['profile-command-channel', `profile-command-channel--${guide.accent}`]"
              >
                <header>
                  <q-avatar :icon="guide.icon" />
                  <div>
                    <strong>{{ guide.channel }}</strong>
                    <span>Envie os comandos no chat com o Notify Flow.</span>
                  </div>
                </header>
                <div class="profile-command-list">
                  <article v-for="command in guide.commands" :key="`${guide.channel}:${command.command}`">
                    <div>
                      <code>{{ command.command }}</code>
                      <q-badge v-if="command.dynamic" outline color="primary" label="Configurável" />
                    </div>
                    <strong>{{ command.title }}</strong>
                    <p>{{ command.description }}</p>
                  </article>
                </div>
                <q-banner rounded class="profile-command-note">
                  <template #avatar><q-icon name="info" /></template>
                  {{ guide.note }}
                </q-banner>
              </section>
            </q-card-section>
          </q-card>

          <q-card flat class="profile-card memberships-card">
            <q-card-section class="card-heading">
              <div><span>VÍNCULOS</span><h2>Convites e grupos</h2></div>
              <q-icon name="hub" color="primary" size="30px" />
            </q-card-section>
            <q-inner-loading :showing="membershipsLoading">
              <q-spinner color="primary" size="34px" />
            </q-inner-loading>
            <q-card-section class="memberships-grid">
              <section class="membership-column">
                <header>
                  <q-icon name="link" />
                  <div>
                    <strong>Convites utilizados</strong>
                    <span>Você pode remover apenas os vínculos do seu próprio cadastro.</span>
                  </div>
                </header>
                <div v-if="memberships.invites.length" class="membership-list">
                  <article v-for="invite in memberships.invites" :key="invite.id" class="membership-item">
                    <div>
                      <strong>{{ invite.title }}</strong>
                      <span>/{{ invite.slug }}</span>
                      <small v-if="invite.channels?.length">{{ invite.channels.join(' · ') }}</small>
                    </div>
                    <q-btn
                      flat
                      round
                      color="negative"
                      icon="link_off"
                      :aria-label="`Remover vínculo com ${invite.title}`"
                      @click="confirmRemoveInvite(invite)"
                    >
                      <q-tooltip>Remover este convite do meu perfil</q-tooltip>
                    </q-btn>
                  </article>
                </div>
                <div v-else class="membership-empty">Nenhum convite associado ao seu perfil.</div>
              </section>

              <section class="membership-column">
                <header>
                  <q-icon name="groups" />
                  <div>
                    <strong>Grupos de contatos</strong>
                    <span>Consulte os participantes ou retire somente o seu contato.</span>
                  </div>
                </header>
                <div v-if="memberships.groups.length" class="membership-list">
                  <article v-for="group in memberships.groups" :key="group.id" class="membership-item">
                    <div>
                      <strong>{{ group.name }}</strong>
                      <span>{{ group.memberCount }} participante(s)</span>
                      <small v-if="group.sourceInvite">Convite: {{ group.sourceInvite.title }}</small>
                    </div>
                    <q-btn
                      flat
                      round
                      color="primary"
                      icon="visibility"
                      :aria-label="`Ver grupo ${group.name}`"
                      @click="openGroupDetails(group)"
                    >
                      <q-tooltip>Ver participantes e opções</q-tooltip>
                    </q-btn>
                  </article>
                </div>
                <div v-else class="membership-empty">Seu contato não participa de nenhum grupo.</div>
              </section>
            </q-card-section>
          </q-card>

          <q-card flat class="profile-card history-card">
            <q-card-section class="card-heading">
              <div><span>TRANSPARÊNCIA</span><h2>Histórico de entregas</h2></div>
              <q-icon name="receipt_long" color="primary" size="30px" />
            </q-card-section>
            <q-table
              flat
              :rows="history"
              :columns="historyColumns"
              row-key="id"
              :loading="historyLoading"
              v-model:pagination="historyPagination"
              :rows-per-page-options="[10, 20, 50]"
              @request="({ pagination }) => loadHistory(pagination)"
            >
              <template #body-cell-date="props"><q-td :props="props">{{ formatDate(props.row.updatedAt || props.row.createdAt) }}</q-td></template>
              <template #body-cell-channel="props">
                <q-td :props="props"><q-icon :name="channelMeta[props.row.channel]?.icon || 'notifications'" class="q-mr-sm" />{{ channelMeta[props.row.channel]?.label || props.row.channel }}</q-td>
              </template>
              <template #body-cell-template="props">
                <q-td :props="props">
                  <strong>{{ props.row.template?.name || 'Envio direto' }}</strong>
                  <div class="text-caption text-grey-7">
                    {{ historyAudienceLabel(props.row) }}
                  </div>
                </q-td>
              </template>
              <template #body-cell-status="props"><q-td :props="props"><q-badge :color="statusColor(props.row.status)" :label="statusLabel(props.row.status)" /></q-td></template>
              <template #no-data><div class="full-width text-center q-pa-xl text-grey-7">Nenhuma entrega registrada para este perfil.</div></template>
            </q-table>
          </q-card>
        </main>
      </q-page>
    </q-page-container>

    <q-dialog v-model="groupDetailsDialog">
      <q-card class="membership-dialog">
        <q-card-section class="membership-dialog__header">
          <div>
            <div class="text-caption text-primary text-weight-bold">GRUPO DE CONTATOS</div>
            <div class="text-h6 text-weight-bold">{{ selectedGroup?.name || 'Grupo' }}</div>
            <div class="text-caption text-grey-7">
              Somente o início dos telefones é exibido; os demais dígitos permanecem protegidos.
            </div>
          </div>
          <q-space />
          <q-btn flat round dense icon="close" aria-label="Fechar" v-close-popup />
        </q-card-section>
        <q-separator />
        <q-card-section class="membership-dialog__body">
          <q-inner-loading :showing="groupDetailsLoading">
            <q-spinner color="primary" size="34px" />
          </q-inner-loading>
          <q-list v-if="selectedGroup?.members?.length" separator>
            <q-item v-for="(member, index) in selectedGroup.members" :key="`${member.displayName}:${index}`">
              <q-item-section avatar>
                <q-avatar color="primary" text-color="dark" icon="person" />
              </q-item-section>
              <q-item-section>
                <q-item-label>
                  {{ member.displayName }}
                  <q-badge v-if="member.isSelf" color="positive" label="Você" class="q-ml-xs" />
                </q-item-label>
                <q-item-label caption>{{ member.phoneMasked }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
          <div v-else-if="!groupDetailsLoading" class="membership-empty">Nenhum participante ativo.</div>
        </q-card-section>
        <q-separator />
        <q-card-actions align="between" class="membership-dialog__actions">
          <q-btn
            flat
            no-caps
            color="negative"
            icon="group_remove"
            label="Remover meu contato"
            @click="confirmLeaveGroup()"
          />
          <q-btn flat no-caps label="Fechar" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="leaveGroupDialog" persistent>
      <q-card class="revoke-card">
        <q-card-section class="row items-center q-gutter-sm">
          <q-icon name="warning" color="negative" size="30px" />
          <div class="text-h6">Sair deste grupo?</div>
        </q-card-section>
        <q-card-section>
          Somente o seu contato será removido de <strong>{{ leaveGroupTarget?.name }}</strong>.
          Os demais participantes e o grupo não serão alterados.
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Cancelar" v-close-popup />
          <q-btn color="negative" unelevated no-caps label="Sim, remover meu contato" :loading="loading" @click="leaveGroup" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="removeInviteDialog" persistent>
      <q-card class="revoke-card">
        <q-card-section class="row items-center q-gutter-sm">
          <q-icon name="link_off" color="negative" size="30px" />
          <div class="text-h6">Remover este convite?</div>
        </q-card-section>
        <q-card-section>
          O vínculo com <strong>{{ removeInviteTarget?.title }}</strong> será retirado do seu perfil.
          Seu contato também sairá dos grupos sincronizados por esse convite, evitando novos disparos por essa origem.
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Cancelar" v-close-popup />
          <q-btn color="negative" unelevated no-caps label="Sim, remover convite" :loading="loading" @click="removeInvite" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="revokeDialog" persistent>
      <q-card class="revoke-card">
        <q-card-section class="row items-center q-gutter-sm"><q-icon name="warning" color="negative" size="30px" /><div class="text-h6">Remover permissão?</div></q-card-section>
        <q-card-section>
          Os envios por <strong>{{ channelMeta[revokeChannel]?.label || revokeChannel }}</strong> serão bloqueados imediatamente. Para reativar, você precisará iniciar uma nova conversa pelo canal.
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Cancelar" v-close-popup />
          <q-btn color="negative" unelevated no-caps label="Sim, remover" :loading="loading" @click="revokePermission" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="emailConsentDialog" persistent>
      <q-card class="revoke-card">
        <q-card-section class="row items-center q-gutter-sm">
          <q-icon :name="emailConsentEnabled ? 'mark_email_read' : 'unsubscribe'" :color="emailConsentEnabled ? 'positive' : 'negative'" size="30px" />
          <div class="text-h6">{{ emailConsentEnabled ? 'Permitir notificações por email?' : 'Remover permissão de email?' }}</div>
        </q-card-section>
        <q-card-section>
          {{ emailConsentEnabled
            ? 'O endereço cadastrado poderá receber notificações. Esta decisão ficará registrada na auditoria.'
            : 'Novos envios por email serão bloqueados imediatamente. Você poderá reativar depois nesta página.' }}
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Cancelar" v-close-popup />
          <q-btn :color="emailConsentEnabled ? 'positive' : 'negative'" unelevated no-caps label="Confirmar" :loading="loading" @click="saveEmailConsent" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-layout>
</template>

<style scoped>
.profile-shell { background: #f3fbf8; color: #092522; }
.profile-header { border-bottom: 1px solid rgba(3, 21, 21, .08); background: rgba(249, 255, 253, .92); color: #092522; backdrop-filter: blur(20px); }
.profile-toolbar { width: min(1240px, 100%); min-height: 70px; margin: auto; padding: 0 24px; }
.profile-brand { display: flex; align-items: center; gap: 9px; color: inherit; font-size: 1.1rem; text-decoration: none; }
.profile-brand > span { display: grid; width: 38px; height: 38px; border-radius: 13px; background: linear-gradient(135deg, #82f8e6, #35bca4); place-items: center; }
.profile-brand strong { color: #137d6c; }
.profile-page { min-height: calc(100vh - 70px); }
.profile-auth-wrap { display: grid; min-height: calc(100vh - 70px); padding: 30px 18px; background: radial-gradient(circle at 15% 15%, rgba(130,248,230,.3), transparent 35%), linear-gradient(145deg, #effaf7, #f9fffd); place-items: center; }
.profile-auth-card { width: min(520px, 100%); padding: clamp(24px, 4vw, 42px); border: 1px solid rgba(53,188,164,.18); border-radius: 28px; box-shadow: 0 24px 70px rgba(12,66,58,.1); }
.auth-icon { display: grid; width: 58px; height: 58px; margin-bottom: 24px; border-radius: 19px; background: #d8fff7; color: #137d6c; font-size: 30px; place-items: center; }
.eyebrow, .card-heading span { color: #137d6c; font-size: .68rem; font-weight: 850; letter-spacing: .14em; }
.profile-auth-card h1, .profile-hero h1 { margin: 8px 0 10px; font-size: clamp(2rem, 5vw, 3.4rem); font-weight: 830; letter-spacing: -.055em; line-height: 1; }
.profile-auth-card p, .profile-hero p { color: #607572; line-height: 1.6; }
.neutral-note, .activation-note { background: rgba(53,188,164,.1); color: #315c55; font-size: .8rem; }
.identifier-type-select { margin-bottom: 14px; }
.identifier-input-wrap { min-height: 98px; }
:deep(.code-input) { font-size: 1.7rem; font-weight: 800; letter-spacing: .25em; text-align: center; }
.profile-content { width: min(1240px, calc(100% - 36px)); margin: auto; padding: 46px 0 70px; }
.profile-hero { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 30px; }
.profile-hero p { max-width: 700px; margin: 0; }
.profile-grid { display: grid; grid-template-columns: 1fr 1.08fr; gap: 22px; }
.profile-card { border: 1px solid rgba(3,21,21,.075); border-radius: 24px; background: rgba(255,255,255,.94); box-shadow: 0 15px 45px rgba(17,70,62,.06); }
.card-heading { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 24px 26px 16px; }
.card-heading h2 { margin: 4px 0 0; font-size: 1.45rem; letter-spacing: -.035em; }
.data-list { display: grid; gap: 12px; padding: 8px 26px 28px; }
.data-list > div { display: flex; align-items: center; gap: 14px; padding: 13px 15px; border-radius: 15px; background: #f6fbf9; }
.data-list .q-icon { color: #268f7d; font-size: 21px; }
.data-list span, .data-list small { display: block; }
.data-list small { margin-bottom: 2px; color: #718480; font-size: .68rem; }
.data-list em { display: block; margin-top: 3px; color: #9a6a19; font-size: .68rem; font-style: normal; }
.edit-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.edit-actions { display: flex; justify-content: flex-end; grid-column: 1 / -1; gap: 8px; }
.permission-list { display: grid; gap: 10px; padding: 8px 26px 28px; }
.permission-row { display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; gap: 12px; padding: 12px; border: 1px solid rgba(3,21,21,.07); border-radius: 17px; }
.permission-copy strong, .permission-copy span { display: block; }
.permission-copy span { margin-top: 2px; color: #718480; font-size: .73rem; }
.permission-copy small { display: block; max-width: 430px; margin-top: 4px; color: #4f706a; font-size: .68rem; line-height: 1.35; }
.profile-commands-card { margin-top: 22px; overflow: hidden; }
.profile-command-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; padding: 8px 26px 28px; }
.profile-command-channel { min-width: 0; padding: 16px; border: 1px solid rgba(3,21,21,.07); border-top: 3px solid #1fae74; border-radius: 18px; background: #f7fcfa; }
.profile-command-channel--telegram { border-top-color: #249bd7; }
.profile-command-channel > header { display: flex; align-items: center; gap: 11px; margin-bottom: 14px; }
.profile-command-channel > header .q-avatar { background: rgba(31,174,116,.12); color: #16895b; }
.profile-command-channel--telegram > header .q-avatar { background: rgba(36,155,215,.12); color: #167caf; }
.profile-command-channel header strong, .profile-command-channel header span { display: block; }
.profile-command-channel header span { margin-top: 2px; color: #6a7d79; font-size: .7rem; }
.profile-command-list { display: grid; gap: 8px; }
.profile-command-list article { min-width: 0; padding: 11px 12px; border-radius: 14px; background: #fff; }
.profile-command-list article > div { display: flex; min-width: 0; align-items: center; flex-wrap: wrap; gap: 7px; margin-bottom: 5px; }
.profile-command-list code { max-width: 100%; overflow-wrap: anywhere; color: #137d6c; font-size: .76rem; font-weight: 800; }
.profile-command-list strong, .profile-command-list p { display: block; }
.profile-command-list strong { color: #234b44; font-size: .78rem; }
.profile-command-list p { margin: 2px 0 0; color: #6a7d79; font-size: .7rem; line-height: 1.42; }
.profile-command-note { margin-top: 12px; background: rgba(53,188,164,.09); color: #456660; font-size: .72rem; line-height: 1.42; }
.memberships-card { position: relative; margin-top: 22px; overflow: hidden; }
.memberships-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; padding: 8px 26px 28px; }
.membership-column { min-width: 0; padding: 16px; border: 1px solid rgba(3,21,21,.07); border-radius: 18px; background: #f7fcfa; }
.membership-column > header { display: flex; align-items: flex-start; gap: 11px; margin-bottom: 13px; }
.membership-column > header > .q-icon { display: grid; flex: 0 0 38px; width: 38px; height: 38px; border-radius: 13px; background: rgba(53,188,164,.13); color: #137d6c; font-size: 21px; place-items: center; }
.membership-column header strong, .membership-column header span { display: block; }
.membership-column header span { margin-top: 3px; color: #6a7d79; font-size: .7rem; line-height: 1.4; }
.membership-list { display: grid; gap: 8px; }
.membership-item { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 12px; border-radius: 14px; background: #fff; }
.membership-item > div { min-width: 0; }
.membership-item strong, .membership-item span, .membership-item small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.membership-item span { margin-top: 2px; color: #617570; font-size: .72rem; }
.membership-item small { margin-top: 3px; color: #78908b; font-size: .65rem; }
.membership-empty { padding: 22px 12px; color: #758984; font-size: .78rem; text-align: center; }
.membership-dialog { display: flex; width: min(640px, calc(100vw - 28px)); max-height: min(760px, calc(100dvh - 28px)); flex-direction: column; border-radius: 22px; }
.membership-dialog__header { display: flex; flex: 0 0 auto; align-items: flex-start; gap: 12px; }
.membership-dialog__body { position: relative; min-height: 150px; overflow: auto; }
.membership-dialog__actions { flex: 0 0 auto; padding: 12px 18px; }
.history-card { margin-top: 22px; overflow: hidden; }
.revoke-card { width: min(480px, calc(100vw - 30px)); border-radius: 22px; }
@media (max-width: 850px) { .profile-grid, .memberships-grid, .profile-command-grid { grid-template-columns: 1fr; } .profile-hero { align-items: flex-start; } }
@media (max-width: 560px) { .profile-toolbar { padding: 0 12px; } .profile-toolbar .q-btn :deep(.q-btn__content span) { display: none; } .profile-content { width: min(100% - 22px, 1240px); padding-top: 28px; } .profile-hero .q-avatar { display: none; } .edit-grid { grid-template-columns: 1fr; } .permission-row { grid-template-columns: auto 1fr auto; } .permission-row > .q-badge { display: none; } .memberships-grid, .profile-command-grid { padding: 6px 12px 18px; } .membership-column, .profile-command-channel { padding: 12px; } .membership-dialog { width: 100%; max-height: 100dvh; border-radius: 0; } .membership-dialog__actions { align-items: stretch; flex-direction: column; } }
</style>
