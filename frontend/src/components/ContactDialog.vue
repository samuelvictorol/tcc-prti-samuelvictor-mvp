<script>
import { identityConsentProvenance } from '../services/contact-identities.js'

export const contactConsentProvenance = identityConsentProvenance

export function contactAuthorizationValidation(value = {}) {
  const consents = value.consents || {}
  if (consents.whatsappCloud && !value.hasPendingWhatsappCloud && !String(value.phone || '').trim()) {
    return 'Informe um telefone antes de autorizar WhatsApp Cloud.'
  }
  return null
}
</script>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useQuasar } from 'quasar'
import ContextHelp from './ContextHelp.vue'
import { errorMessage, http } from '../services/http.js'
import { contactIdentitySummaries, pendingWhatsappConsent } from '../services/contact-identities.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  contact: { type: Object, default: null },
  initial: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:modelValue', 'saved'])
const $q = useQuasar()
const saving = ref(false)
const removingInviteId = ref(null)
const inviteOrigins = ref([])

const emptyForm = () => ({
  displayName: '',
  email: '',
  phone: '',
  telegramUsername: '',
  notes: '',
  tagsText: '',
  consents: { telegram: false, email: false, whatsappCloud: false },
})
const form = reactive(emptyForm())
const originalConsents = reactive(emptyForm().consents)
const authorizationPhoneError = computed(() => contactAuthorizationValidation({
  ...form,
  hasPendingWhatsappCloud: Boolean(pendingWhatsappCloud.value),
}))

function recordId(record) {
  return record?.id || record?._id
}

function identitiesOf(contact = {}) {
  return Array.isArray(contact.channels) ? contact.channels : []
}

function identity(contact, channel) {
  return identitiesOf(contact).find((item) => String(item.channel).replaceAll('-', '_') === channel)
}

const pendingWhatsappCloud = computed(() => pendingWhatsappConsent(props.contact || props.initial, 'whatsapp_cloud'))
const providerIdentitySummaries = computed(() => contactIdentitySummaries(props.contact || props.initial)
  .filter((item) => ['telegram', 'whatsapp_cloud'].includes(item.channel)))
const permissionCards = computed(() => [
  {
    key: 'telegram',
    channel: 'telegram',
    label: 'Telegram',
    icon: 'send',
    color: 'info',
    available: Boolean(identity(props.contact || props.initial, 'telegram')),
    unavailableText: 'O contato precisa iniciar o bot para registrar a identidade do Telegram.',
    identity: identity(props.contact || props.initial, 'telegram'),
    pending: null,
  },
  {
    key: 'whatsappCloud',
    channel: 'whatsapp_cloud',
    label: 'WhatsApp Cloud',
    icon: 'cloud_sync',
    color: 'positive',
    available: Boolean(identity(props.contact || props.initial, 'whatsapp_cloud') || form.phone || pendingWhatsappCloud.value),
    unavailableText: 'Informe um telefone para criar a identidade oficial.',
    identity: identity(props.contact || props.initial, 'whatsapp_cloud'),
    pending: pendingWhatsappCloud.value,
  },
  {
    key: 'email',
    channel: 'email',
    label: 'Email',
    icon: 'mail',
    color: 'grey-7',
    available: Boolean(identity(props.contact || props.initial, 'email') || form.email),
    unavailableText: 'Informe um email para habilitar este canal.',
    identity: identity(props.contact || props.initial, 'email'),
    pending: null,
  },
].map((item) => ({
  ...item,
  provenance: contactConsentProvenance(item.identity || (item.pending ? {
    channel: item.channel,
    consentSource: item.pending.source,
    consentCommand: item.pending.command,
    consentChangedAt: item.pending.createdAt,
    metadata: {
      permissionCommandReceivedVia: item.pending.sourceChannel,
      sharedWhatsappConsent: true,
    },
  } : null)),
})))

function reset() {
  const source = props.contact || props.initial || {}
  const telegramIdentity = identity(source, 'telegram')
  const emailIdentity = identity(source, 'email')
  const cloudIdentity = identity(source, 'whatsapp_cloud')
  Object.assign(form, emptyForm(), {
    displayName: source.displayName || source.name || source.pushName || '',
    email: source.email || emailIdentity?.address || '',
    phone: source.phone || cloudIdentity?.address || '',
    telegramUsername: source.telegramUsername || source.telegram_username || source.username || '',
    notes: source.metadata?.notes || source.notes || '',
    tagsText: Array.isArray(source.tags) ? source.tags.join(', ') : '',
    consents: {
      telegram: Boolean(telegramIdentity?.authorized && telegramIdentity?.consentStatus === 'granted'),
      email: Boolean(emailIdentity?.authorized && emailIdentity?.consentStatus === 'granted'),
      whatsappCloud: Boolean(cloudIdentity?.authorized && cloudIdentity?.consentStatus === 'granted') || Boolean(pendingWhatsappCloud.value),
    },
  })
  Object.assign(originalConsents, form.consents)
  inviteOrigins.value = Array.isArray(source.inviteOrigins)
    ? source.inviteOrigins.map((origin) => ({ ...origin }))
    : []
}

function upsertIdentity(channels, channel, address) {
  const normalized = channel.replaceAll('-', '_')
  const index = channels.findIndex((item) => String(item.channel).replaceAll('-', '_') === normalized)
  if (!address && index < 0) return
  const existing = index >= 0 ? channels[index] : {}
  const value = {
    ...existing,
    channel: normalized,
    address: address || existing.address,
    authorized: index >= 0 ? Boolean(existing.authorized) : false,
    consentStatus: index >= 0 ? (existing.consentStatus || 'unknown') : 'unknown',
    source: existing.source || 'manual',
  }
  if (index >= 0) channels.splice(index, 1, value)
  else channels.push(value)
}

function buildPayload() {
  // Preserve provider-issued identities (especially Telegram chat_id) while updating manual fields.
  const channels = identitiesOf(props.contact || props.initial).map((item) => ({ ...item }))
  const existingCloudIdentity = channels.find((item) => String(item.channel).replaceAll('-', '_') === 'whatsapp_cloud')
  upsertIdentity(channels, 'email', form.email)
  if ((!pendingWhatsappCloud.value && form.consents.whatsappCloud)
    || channels.some((item) => String(item.channel).replaceAll('-', '_') === 'whatsapp_cloud')) {
    upsertIdentity(channels, 'whatsapp_cloud', existingCloudIdentity?.address || form.phone)
  }

  return {
    displayName: form.displayName,
    email: form.email || null,
    phone: form.phone || null,
    telegramUsername: form.telegramUsername || null,
    channels,
    tags: form.tagsText.split(',').map((tag) => tag.trim()).filter(Boolean),
    metadata: { ...(props.contact?.metadata || {}), notes: form.notes || undefined },
  }
}

function consentChanges() {
  return permissionCards.value
    .filter((item) => Boolean(form.consents[item.key]) !== Boolean(originalConsents[item.key]))
    .map((item) => ({
      ...item,
      granted: Boolean(form.consents[item.key]),
    }))
}

function confirmRemovePermission(item) {
  $q.dialog({
    title: item.pending ? `Cancelar autorização pendente de ${item.label}?` : `Remover permissão de ${item.label}?`,
    message: item.pending
      ? 'Esta autorização pendente será cancelada.'
      : 'Novos disparos neste canal serão bloqueados até que a permissão seja concedida novamente.',
    cancel: { flat: true, label: 'Cancelar' },
    ok: { color: 'negative', label: item.pending ? 'Cancelar autorização pendente' : 'Remover permissão' },
    persistent: true,
  }).onOk(() => {
    form.consents[item.key] = false
  })
}

async function persistConsentChanges(contactId, changes) {
  for (const change of changes) {
    await http.post(`/privacy/contacts/${contactId}/consents`, {
      channel: change.channel,
      status: change.granted ? 'granted' : 'revoked',
      ...(change.granted ? {} : { confirmed: true }),
    })
  }
}

function confirmRemoveInviteOrigin(invite) {
  $q.dialog({
    title: 'Remover vínculo com este convite?',
    message: `O vínculo com "${invite.title}" será removido somente deste contato. Ele também sairá dos grupos sincronizados por esse convite.`,
    cancel: { flat: true, label: 'Cancelar' },
    ok: { color: 'negative', label: 'Remover vínculo' },
    persistent: true,
  }).onOk(async () => {
    const contactId = recordId(props.contact)
    const inviteId = invite.inviteId || invite.id
    if (!contactId || !inviteId) return
    removingInviteId.value = inviteId
    try {
      await http.delete(`/contacts/${contactId}/invites/${inviteId}`, {
        data: { confirmed: true },
      })
      inviteOrigins.value = inviteOrigins.value.filter(
        (origin) => String(origin.inviteId || origin.id) !== String(inviteId),
      )
      const refreshed = (await http.get(`/contacts/${contactId}`)).data?.data
      emit('saved', refreshed)
      $q.notify({
        type: 'positive',
        message: 'Vínculo de convite removido deste contato e dos grupos sincronizados.',
      })
    } catch (error) {
      $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível remover o vínculo do convite.') })
    } finally {
      removingInviteId.value = null
    }
  })
}

async function save() {
  const validationError = contactAuthorizationValidation({
    ...form,
    hasPendingWhatsappCloud: Boolean(pendingWhatsappCloud.value),
  })
  if (validationError) {
    $q.notify({ type: 'warning', message: validationError })
    return
  }
  saving.value = true
  try {
    const id = recordId(props.contact)
    const changes = consentChanges()
    const response = id
      ? await http.put(`/contacts/${id}`, buildPayload())
      : await http.post('/contacts', buildPayload())
    const saved = response.data?.data || response.data
    const savedId = recordId(saved) || id
    if (savedId && changes.length) await persistConsentChanges(savedId, changes)
    const refreshed = savedId ? (await http.get(`/contacts/${savedId}`)).data?.data : saved
    $q.notify({ type: 'positive', message: `Contato ${id ? 'atualizado' : 'cadastrado'} com sucesso.` })
    emit('saved', refreshed || saved)
    emit('update:modelValue', false)
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error) })
  } finally {
    saving.value = false
  }
}

watch(() => props.modelValue, (open) => open && reset())
</script>

<template>
  <q-dialog :model-value="modelValue" persistent :maximized="$q.screen.lt.sm" @update:model-value="emit('update:modelValue', $event)">
    <q-card class="dialog-card contact-dialog-card">
      <q-card-section class="row items-center contact-dialog__header">
        <div>
          <div class="text-h6 text-weight-bold">{{ contact ? 'Editar contato' : 'Novo contato' }}</div>
          <div class="text-caption text-muted">Identidades verificadas do provedor serão preservadas.</div>
        </div>
        <q-space />
        <q-btn flat round dense icon="close" aria-label="Fechar" @click="emit('update:modelValue', false)" />
      </q-card-section>
      <q-separator />
      <q-form @submit.prevent="save">
        <q-card-section class="q-pa-lg contact-dialog__body">
          <div class="form-grid">
            <q-input v-model.trim="form.displayName" outlined label="Nome de exibição *" :rules="[(value) => Boolean(value) || 'Informe o nome']" />
            <q-input v-model.trim="form.email" outlined type="email" label="Email" />
            <q-input
              v-model.trim="form.phone"
              outlined
              label="Telefone"
              hint="Inclua o código do país"
              :error="Boolean(authorizationPhoneError)"
              :error-message="authorizationPhoneError || undefined"
            />
            <q-input v-model.trim="form.telegramUsername" outlined label="Usuário do Telegram" prefix="@">
              <template #append>
                <ContextHelp
                  title="Identificação no Telegram"
                  tooltip="Entenda username e chat ID"
                  text="O @username do Telegram é apenas referência. A autorização exige que a pessoa inicie o bot; somente a API pode registrar o chat_id recebido."
                />
              </template>
            </q-input>
            <q-input v-model="form.tagsText" outlined label="Tags" hint="Separe por vírgula" class="full-span" />
            <q-input v-model="form.notes" outlined type="textarea" label="Observações" class="full-span" />
            <section v-if="providerIdentitySummaries.length" class="full-span provider-identities" aria-label="Identificadores dos provedores">
              <div class="provider-identities__heading">
                <div>
                  <strong>Vínculos e IDs dos provedores</strong>
                  <span>Dados recebidos automaticamente são somente leitura e permanecem vinculados ao contato.</span>
                </div>
                <q-icon name="verified_user" color="primary" />
              </div>
              <div class="provider-identities__grid">
                <article v-for="summary in providerIdentitySummaries" :key="summary.identity.id || `${summary.channel}:${summary.identity.address}`" class="provider-identity-card">
                  <header>
                    <q-icon :name="summary.icon" :color="summary.color" />
                    <strong>{{ summary.label }}</strong>
                    <q-badge
                      v-if="summary.registration.automatic"
                      outline
                      color="positive"
                      icon="auto_awesome"
                      :label="`Cadastro automático: ${summary.registration.label}`"
                    />
                  </header>
                  <dl>
                    <div v-for="identifier in summary.identifiers" :key="identifier.key">
                      <dt>{{ identifier.label }}</dt>
                      <dd><code>{{ identifier.value }}</code></dd>
                    </div>
                  </dl>
                </article>
              </div>
            </section>
            <section v-if="contact && inviteOrigins.length" class="full-span invite-origins" aria-label="Convites vinculados ao contato">
              <div class="invite-origins__heading">
                <div>
                  <strong>Convites vinculados</strong>
                  <span>Remova apenas o vínculo incorreto deste contato; o convite e os demais participantes serão preservados.</span>
                </div>
                <q-icon name="link" color="primary" />
              </div>
              <div class="invite-origins__list">
                <article v-for="invite in inviteOrigins" :key="invite.inviteId || invite.id">
                  <div>
                    <strong>{{ invite.title }}</strong>
                    <span>/{{ invite.slug }}</span>
                  </div>
                  <q-btn
                    type="button"
                    flat
                    round
                    color="negative"
                    icon="link_off"
                    :loading="removingInviteId === (invite.inviteId || invite.id)"
                    :aria-label="`Remover vínculo com ${invite.title}`"
                    @click="confirmRemoveInviteOrigin(invite)"
                  >
                    <q-tooltip>Remover vínculo deste contato</q-tooltip>
                  </q-btn>
                </article>
              </div>
            </section>
            <section class="full-span consent-box" aria-label="Permissões manuais do contato">
              <div class="row items-center q-mb-md">
                <div class="text-weight-bold">Permissões de envio e resposta</div>
                <ContextHelp
                  title="Permissões dos canais"
                  tooltip="Entenda como as permissões são aplicadas"
                  text="O comando configurado recebido pela API oficial autoriza notificações no WhatsApp Cloud. Telegram, WhatsApp Cloud e Email permanecem separados para ajustes individuais; o Telegram só aparece disponível depois que o contato inicia o bot e toda remoção exige confirmação."
                />
              </div>
              <div class="permission-grid">
                <article
                  v-for="item in permissionCards"
                  :key="item.channel"
                  class="permission-card"
                  :class="{
                    'permission-card--granted': form.consents[item.key] && !item.pending,
                    'permission-card--pending': form.consents[item.key] && item.pending,
                  }"
                >
                  <div class="permission-card__heading">
                    <q-icon :name="item.icon" :color="item.color" size="22px" />
                    <div>
                      <strong>{{ item.label }}</strong>
                      <span>{{ item.pending && form.consents[item.key] ? 'Autorização automática pendente' : form.consents[item.key] ? 'Permitido' : item.available ? 'Não permitido' : 'Identidade indisponível' }}</span>
                    </div>
                    <q-space />
                    <q-checkbox
                      :model-value="form.consents[item.key]"
                      :disable="form.consents[item.key] || !item.available"
                      :aria-label="`Permitir ${item.label}`"
                      @update:model-value="form.consents[item.key] = Boolean($event)"
                    />
                  </div>
                  <div v-if="item.identity || item.pending" class="permission-card__provenance">
                    <q-icon :name="item.provenance.changedByAdmin ? 'manage_accounts' : item.provenance.automaticCommand ? 'how_to_reg' : 'history'" />
                    <span>{{ item.provenance.label }}</span>
                    <time v-if="item.provenance.changedAt">{{ new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.provenance.changedAt)) }}</time>
                  </div>
                  <p v-else>{{ item.unavailableText }}</p>
                  <q-btn
                    v-if="form.consents[item.key]"
                    flat
                    dense
                    no-caps
                    color="negative"
                    icon="remove_circle_outline"
                    :label="item.pending ? 'Cancelar autorização pendente' : 'Remover permissão'"
                    @click="confirmRemovePermission(item)"
                  />
                </article>
              </div>
            </section>
          </div>
        </q-card-section>
        <q-separator />
        <q-card-actions align="right" class="q-pa-md contact-dialog__footer">
          <q-btn flat no-caps label="Cancelar" @click="emit('update:modelValue', false)" />
          <q-btn type="submit" color="primary" unelevated no-caps label="Salvar contato" :loading="saving" />
        </q-card-actions>
      </q-form>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.contact-dialog-card {
  width: min(1040px, calc(100vw - 32px));
  max-width: 1040px !important;
}

.contact-dialog__header,
.contact-dialog__footer {
  flex: 0 0 auto;
}

.contact-dialog__body {
  scrollbar-gutter: stable;
}

.consent-box {
  padding: 15px;
  border-radius: 15px;
}

.consent-box {
  border: 1px solid rgba(53, 188, 164, 0.2);
  background: rgba(130, 248, 230, 0.09);
}

.permission-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
}

.permission-card {
  display: grid;
  min-width: 0;
  align-content: start;
  gap: 10px;
  padding: 13px;
  border: 1px solid rgba(3, 21, 21, 0.09);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.76);
}

.permission-card--granted {
  border-color: rgba(39, 183, 159, 0.32);
  background: rgba(224, 255, 248, 0.76);
}

.permission-card--pending {
  border-color: rgba(199, 125, 23, 0.34);
  background: rgba(255, 246, 224, 0.82);
}

.permission-card__heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.permission-card__heading strong,
.permission-card__heading span {
  display: block;
}

.permission-card__heading span,
.permission-card p,
.permission-card__provenance {
  color: #667a77;
  font-size: 0.7rem;
}

.permission-card p {
  margin: 0;
  line-height: 1.45;
}

.permission-card__provenance {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 3px 6px;
  line-height: 1.4;
}

.permission-card__provenance time {
  grid-column: 2;
}

.provider-identities {
  padding: 16px;
  border: 1px solid rgba(53, 188, 164, 0.2);
  border-radius: 16px;
  background: rgba(247, 254, 252, 0.76);
}

.provider-identities__heading,
.provider-identity-card header {
  display: flex;
  align-items: center;
  gap: 9px;
}

.provider-identities__heading {
  justify-content: space-between;
  margin-bottom: 12px;
}

.provider-identities__heading strong,
.provider-identities__heading span {
  display: block;
}

.provider-identities__heading span {
  margin-top: 2px;
  color: #657976;
  font-size: 0.73rem;
}

.provider-identities__grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.provider-identity-card {
  min-width: 0;
  padding: 12px;
  border: 1px solid rgba(3, 21, 21, 0.08);
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.82);
}

.provider-identity-card header {
  flex-wrap: wrap;
}

.provider-identity-card dl {
  display: grid;
  gap: 6px;
  margin: 11px 0 0;
}

.provider-identity-card dl > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.provider-identity-card dt {
  color: #6b7f7c;
  font-size: 0.66rem;
}

.provider-identity-card dd {
  min-width: 0;
  margin: 0;
}

.provider-identity-card code {
  display: block;
  overflow: hidden;
  color: #214b45;
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.invite-origins {
  padding: 16px;
  border: 1px solid rgba(53, 188, 164, 0.2);
  border-radius: 16px;
  background: rgba(247, 254, 252, 0.76);
}

.invite-origins__heading,
.invite-origins__list article {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.invite-origins__heading {
  margin-bottom: 10px;
}

.invite-origins__heading strong,
.invite-origins__heading span,
.invite-origins__list strong,
.invite-origins__list span {
  display: block;
}

.invite-origins__heading span,
.invite-origins__list span {
  margin-top: 2px;
  color: #657976;
  font-size: 0.72rem;
}

.invite-origins__list {
  display: grid;
  gap: 7px;
}

.invite-origins__list article {
  padding: 9px 10px 9px 12px;
  border: 1px solid rgba(3, 21, 21, 0.07);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.86);
}

@media (max-width: 560px) {
  .contact-dialog-card {
    width: 100%;
    max-width: 100% !important;
    max-height: 100dvh;
    border-radius: 0;
  }

  .contact-dialog__header,
  .contact-dialog__body {
    padding-right: 16px;
    padding-left: 16px;
  }

  .contact-dialog__footer {
    padding-bottom: max(12px, env(safe-area-inset-bottom));
  }

  .provider-identities {
    padding: 12px;
  }

  .provider-identities__grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .permission-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
