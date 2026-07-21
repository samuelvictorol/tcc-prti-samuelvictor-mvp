<script setup>
import { reactive, ref, watch } from 'vue'
import { useQuasar } from 'quasar'
import { errorMessage, http } from '../services/http.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  contact: { type: Object, default: null },
  initial: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:modelValue', 'saved'])
const $q = useQuasar()
const saving = ref(false)

const emptyForm = () => ({
  displayName: '',
  email: '',
  phone: '',
  telegramUsername: '',
  notes: '',
  tagsText: '',
  consents: { email: false, whatsappWeb: false, whatsappCloud: false },
})
const form = reactive(emptyForm())

function recordId(record) {
  return record?.id || record?._id
}

function identitiesOf(contact = {}) {
  return Array.isArray(contact.channels) ? contact.channels : []
}

function identity(contact, channel) {
  return identitiesOf(contact).find((item) => String(item.channel).replaceAll('-', '_') === channel)
}

function reset() {
  const source = props.contact || props.initial || {}
  const emailIdentity = identity(source, 'email')
  const webIdentity = identity(source, 'whatsapp_web')
  const cloudIdentity = identity(source, 'whatsapp_cloud')
  Object.assign(form, emptyForm(), {
    displayName: source.displayName || source.name || source.pushName || '',
    email: source.email || emailIdentity?.address || '',
    phone: source.phone || cloudIdentity?.address || webIdentity?.address || '',
    telegramUsername: source.telegramUsername || source.telegram_username || source.username || '',
    notes: source.metadata?.notes || source.notes || '',
    tagsText: Array.isArray(source.tags) ? source.tags.join(', ') : '',
    consents: {
      email: Boolean(emailIdentity?.authorized || emailIdentity?.consentStatus === 'granted'),
      whatsappWeb: Boolean(webIdentity?.authorized || webIdentity?.consentStatus === 'granted'),
      whatsappCloud: Boolean(cloudIdentity?.authorized || cloudIdentity?.consentStatus === 'granted'),
    },
  })
}

function upsertIdentity(channels, channel, address, authorized) {
  const normalized = channel.replaceAll('-', '_')
  const index = channels.findIndex((item) => String(item.channel).replaceAll('-', '_') === normalized)
  if (!address && index < 0) return
  const existing = index >= 0 ? channels[index] : {}
  const wasAuthorized = Boolean(existing.authorized || existing.consentStatus === 'granted')
  const value = {
    ...existing,
    channel: normalized,
    address: address || existing.address,
    authorized: Boolean(authorized),
    consentStatus: authorized ? 'granted' : (wasAuthorized || existing.consentStatus === 'revoked' ? 'revoked' : 'unknown'),
    source: existing.source || 'manual',
  }
  if (index >= 0) channels.splice(index, 1, value)
  else channels.push(value)
}

function buildPayload() {
  // Preserve provider-issued identities (especially Telegram chat_id) while updating manual fields.
  const channels = identitiesOf(props.contact || props.initial).map((item) => ({ ...item }))
  upsertIdentity(channels, 'email', form.email, form.consents.email)
  if (form.consents.whatsappWeb || channels.some((item) => String(item.channel).replaceAll('-', '_') === 'whatsapp_web')) {
    upsertIdentity(channels, 'whatsapp_web', form.phone, form.consents.whatsappWeb)
  }
  if (form.consents.whatsappCloud || channels.some((item) => String(item.channel).replaceAll('-', '_') === 'whatsapp_cloud')) {
    upsertIdentity(channels, 'whatsapp_cloud', form.phone, form.consents.whatsappCloud)
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

async function save() {
  saving.value = true
  try {
    const id = recordId(props.contact)
    const response = id
      ? await http.put(`/contacts/${id}`, buildPayload())
      : await http.post('/contacts', buildPayload())
    $q.notify({ type: 'positive', message: `Contato ${id ? 'atualizado' : 'cadastrado'} com sucesso.` })
    emit('saved', response.data?.data || response.data)
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
  <q-dialog :model-value="modelValue" persistent @update:model-value="emit('update:modelValue', $event)">
    <q-card class="dialog-card">
      <q-card-section class="row items-center">
        <div>
          <div class="text-h6 text-weight-bold">{{ contact ? 'Editar contato' : 'Novo contato' }}</div>
          <div class="text-caption text-muted">Identidades verificadas do provedor serão preservadas.</div>
        </div>
        <q-space />
        <q-btn flat round dense icon="close" aria-label="Fechar" @click="emit('update:modelValue', false)" />
      </q-card-section>
      <q-separator />
      <q-form @submit.prevent="save">
        <q-card-section class="q-pa-lg">
          <div class="form-grid">
            <q-input v-model.trim="form.displayName" outlined label="Nome de exibição *" :rules="[(value) => Boolean(value) || 'Informe o nome']" />
            <q-input v-model.trim="form.email" outlined type="email" label="Email" />
            <q-input v-model.trim="form.phone" outlined label="Telefone" hint="Inclua o código do país" />
            <q-input v-model.trim="form.telegramUsername" outlined label="Usuário do Telegram" prefix="@" />
            <q-input v-model="form.tagsText" outlined label="Tags" hint="Separe por vírgula" class="full-span" />
            <q-input v-model="form.notes" outlined type="textarea" label="Observações" class="full-span" />
            <div class="full-span telegram-warning">
              <q-icon name="info" color="info" />
              <span>O @username do Telegram é apenas referência. A autorização exige que a pessoa inicie o bot; somente a API pode registrar o chat_id recebido.</span>
            </div>
            <div class="full-span consent-box">
              <div class="text-weight-bold">Autorizações manuais confirmadas</div>
              <div class="text-caption text-muted q-mb-sm">Marque apenas quando houver consentimento comprovável.</div>
              <div class="row q-gutter-md">
                <q-checkbox v-model="form.consents.whatsappWeb" label="WhatsApp Web" />
                <q-checkbox v-model="form.consents.whatsappCloud" label="WhatsApp Cloud" />
                <q-checkbox v-model="form.consents.email" label="Email" />
              </div>
            </div>
          </div>
        </q-card-section>
        <q-separator />
        <q-card-actions align="right" class="q-pa-md">
          <q-btn flat no-caps label="Cancelar" @click="emit('update:modelValue', false)" />
          <q-btn type="submit" color="primary" unelevated no-caps label="Salvar contato" :loading="saving" />
        </q-card-actions>
      </q-form>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.consent-box,
.telegram-warning {
  padding: 15px;
  border-radius: 15px;
}

.consent-box {
  border: 1px solid rgba(53, 188, 164, 0.2);
  background: rgba(130, 248, 230, 0.09);
}

.telegram-warning {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  border: 1px solid rgba(36, 123, 160, 0.18);
  background: rgba(224, 246, 255, 0.52);
  color: #315e70;
  font-size: 0.78rem;
  line-height: 1.45;
}
</style>
