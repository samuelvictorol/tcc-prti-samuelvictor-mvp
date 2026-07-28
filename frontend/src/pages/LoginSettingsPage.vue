<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useQuasar } from 'quasar'
import ContextHelp from '../components/ContextHelp.vue'
import { errorMessage, http, unwrap } from '../services/http.js'

const $q = useQuasar()
const loading = ref(false)
const configuration = ref({ template: {}, providers: {} })
const rows = ref([])
const pagination = reactive({ page: 1, rowsPerPage: 20, rowsNumber: 0 })

const columns = [
  { name: 'createdAt', label: 'Solicitado em', field: 'createdAt', align: 'left' },
  { name: 'identifierType', label: 'Identificador', field: 'identifierType', align: 'left' },
  { name: 'deliveries', label: 'Entregas do código', field: 'deliveries', align: 'left' },
  { name: 'attempts', label: 'Tentativas', field: 'attempts', align: 'center' },
  { name: 'status', label: 'Situação', field: 'status', align: 'left' },
  { name: 'expiresAt', label: 'Expira em', field: 'expiresAt', align: 'left' },
]

const template = computed(() => configuration.value.template || {})
const providers = computed(() => configuration.value.providers || {})
function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function statusMeta(status) {
  return {
    approved: { label: 'Aprovado', color: 'positive' },
    pending: { label: 'Pendente', color: 'warning' },
    rejected: { label: 'Rejeitado', color: 'negative' },
    absent: { label: 'Não encontrado', color: 'negative' },
    language_missing: { label: `Idioma ${template.value.languageCode || 'pt_BR'} ausente`, color: 'warning' },
    unknown: { label: 'Não confirmado', color: 'grey-7' },
    verified: { label: 'Validado', color: 'positive' },
    revoked: { label: 'Revogado', color: 'grey-7' },
    expired: { label: 'Expirado', color: 'grey-7' },
    blocked: { label: 'Bloqueado', color: 'negative' },
    pending_login: { label: 'Aguardando código', color: 'warning' },
    awaiting_whatsapp: { label: 'Aguardando WhatsApp', color: 'info' },
    active: { label: 'Ativo', color: 'positive' },
    sent: { label: 'Enviado', color: 'positive' },
    failed: { label: 'Falhou', color: 'negative' },
    not_available: { label: 'Indisponível', color: 'grey-7' },
  }[status] || { label: status || '—', color: 'grey-7' }
}

function challengeMeta(status) {
  return statusMeta(status === 'pending' ? 'pending_login' : status)
}

function channelMeta(channel) {
  return {
    email: { label: 'Gmail', icon: 'mail', color: 'red-7' },
    whatsapp_cloud: { label: 'WhatsApp Cloud', icon: 'cloud_sync', color: 'positive' },
    telegram: { label: 'Telegram', icon: 'send', color: 'light-blue-7' },
  }[channel] || { label: channel || 'Canal', icon: 'notifications', color: 'grey-7' }
}

async function load(next = pagination) {
  loading.value = true
  try {
    const result = unwrap(await http.get('/profile-logins', {
      params: { page: next.page, limit: next.rowsPerPage },
    })) || {}
    configuration.value = result.configuration || { template: {}, providers: {} }
    rows.value = result.items || []
    pagination.page = Number(result.page || next.page)
    pagination.rowsPerPage = Number(result.limit || next.rowsPerPage)
    pagination.rowsNumber = Number(result.total || 0)
  } catch (error) {
    $q.notify({ type: 'negative', message: errorMessage(error, 'Não foi possível carregar os logins de perfil.') })
  } finally {
    loading.value = false
  }
}

onMounted(() => load())
</script>

<template>
  <q-page class="login-settings-page">
    <header class="page-heading">
      <div>
        <div class="eyebrow">ACESSO DO CONTATO</div>
        <h1>Logins do Meu Perfil</h1>
        <p>Códigos temporários de seis dígitos, com validade de 10 minutos e sem armazenamento do valor em texto aberto.</p>
      </div>
      <q-btn outline no-caps icon="refresh" label="Atualizar" :loading="loading" @click="load()" />
    </header>

    <section class="status-grid">
      <q-card flat class="status-card template-card">
        <q-card-section class="status-card__title">
          <q-avatar color="positive" text-color="white" icon="forum" />
          <div><span>FLUXO DE ACESSO</span><strong>{{ template.label || 'Código pela conversa oficial' }}</strong></div>
          <div class="status-card__actions">
            <ContextHelp
              title="Como o código é gerado"
              tooltip="Entenda o login pela conversa oficial"
            >
              <p><strong>{{ template.prerequisite || 'Configure o número público do WhatsApp Cloud.' }}</strong></p>
              <p>Ao solicitar acesso em <code>/meu-perfil</code>, o sistema abre o WhatsApp oficial com o comando <code>{{ template.command || '/gerar-codigo' }}</code>.</p>
              <p>O contato envia o comando, abre a janela oficial de atendimento de 24 horas e recebe uma resposta de texto com um código de seis dígitos.</p>
              <p>O mesmo código também é enviado ao Gmail e Telegram já vinculados, de forma independente. Nenhum template de autenticação da Meta é necessário para este fluxo.</p>
            </ContextHelp>
            <q-badge :color="statusMeta(template.status).color" :label="statusMeta(template.status).label" />
          </div>
        </q-card-section>
        <q-card-section class="template-details">
          <div><small>Comando</small><code>{{ template.command || '/gerar-codigo' }}</code></div>
          <div><small>Canal de início</small><strong>WhatsApp oficial</strong></div>
          <div><small>Validade</small><strong>10 minutos</strong></div>
        </q-card-section>
      </q-card>

      <q-card flat class="status-card">
        <q-card-section class="status-card__title">
          <q-avatar color="deep-purple" text-color="white" icon="mail" />
          <div><span>PROVEDOR</span><strong>Gmail</strong></div>
          <q-badge :color="providers.email?.configured ? 'positive' : 'grey-7'" :label="providers.email?.configured ? 'Configurado' : 'Não configurado'" />
        </q-card-section>
        <q-card-section class="provider-copy">Envia o mesmo código para o email já vinculado ao contato.</q-card-section>
      </q-card>

      <q-card flat class="status-card">
        <q-card-section class="status-card__title">
          <q-avatar color="positive" text-color="white" icon="cloud_sync" />
          <div><span>PROVEDOR</span><strong>WhatsApp Cloud</strong></div>
          <q-badge :color="providers.whatsapp_cloud?.configured ? 'positive' : 'grey-7'" :label="providers.whatsapp_cloud?.configured ? 'Configurado' : 'Não configurado'" />
        </q-card-section>
        <q-card-section class="provider-copy">
          Responde com texto livre porque o próprio contato abre a conversa e inicia a janela oficial de atendimento.
        </q-card-section>
      </q-card>

      <q-card flat class="status-card">
        <q-card-section class="status-card__title">
          <q-avatar color="light-blue-7" text-color="white" icon="send" />
          <div><span>PROVEDOR</span><strong>Telegram</strong></div>
          <q-badge :color="providers.telegram?.configured ? 'positive' : 'grey-7'" :label="providers.telegram?.configured ? 'Configurado' : 'Não configurado'" />
        </q-card-section>
        <q-card-section class="provider-copy">Envia o mesmo código somente ao Telegram já vinculado e autorizado pelo contato.</q-card-section>
      </q-card>
    </section>

    <q-card flat class="logs-card">
      <q-card-section class="logs-heading">
        <div><span>AUDITORIA SEGURA</span><h2>Solicitações e entregas</h2></div>
        <q-icon name="policy" color="primary" size="32px" />
      </q-card-section>
      <q-table
        flat
        row-key="id"
        :rows="rows"
        :columns="columns"
        :loading="loading"
        v-model:pagination="pagination"
        :rows-per-page-options="[10, 20, 50]"
        @request="({ pagination: next }) => load(next)"
      >
        <template #body-cell-createdAt="props"><q-td :props="props">{{ formatDate(props.row.createdAt) }}</q-td></template>
        <template #body-cell-identifierType="props"><q-td :props="props"><q-icon :name="props.row.identifierType === 'email' ? 'alternate_email' : 'phone'" class="q-mr-sm" />{{ props.row.identifierType === 'email' ? 'Email' : 'Telefone' }}</q-td></template>
        <template #body-cell-deliveries="props">
          <q-td :props="props"><div class="delivery-list">
            <q-chip v-for="delivery in props.row.deliveries" :key="delivery.channel" dense outline :color="statusMeta(delivery.status).color" :icon="channelMeta(delivery.channel).icon">
              {{ channelMeta(delivery.channel).label }} · {{ statusMeta(delivery.status).label }}
            </q-chip>
          </div></q-td>
        </template>
        <template #body-cell-attempts="props"><q-td :props="props">{{ props.row.attempts }} / {{ props.row.maxAttempts }}</q-td></template>
        <template #body-cell-status="props"><q-td :props="props"><q-badge :color="challengeMeta(props.row.status).color" :label="challengeMeta(props.row.status).label" /></q-td></template>
        <template #body-cell-expiresAt="props"><q-td :props="props">{{ formatDate(props.row.expiresAt) }}</q-td></template>
        <template #no-data><div class="full-width text-center q-pa-xl text-grey-7">Nenhuma solicitação de acesso registrada.</div></template>
      </q-table>
    </q-card>
  </q-page>
</template>

<style scoped>
.login-settings-page { padding: clamp(24px, 4vw, 48px); background: #f4fbf9; color: #092522; }
.page-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; max-width: 1380px; margin: 0 auto 26px; }
.eyebrow, .status-card__title span, .logs-heading span { color: #137d6c; font-size: .68rem; font-weight: 850; letter-spacing: .14em; }
.page-heading h1 { margin: 6px 0 8px; font-size: clamp(2rem, 4vw, 3.25rem); letter-spacing: -.055em; line-height: 1; }
.page-heading p { max-width: 760px; margin: 0; color: #607572; }
.status-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) repeat(3, minmax(0, .8fr)); gap: 18px; max-width: 1380px; margin: auto; }
.status-card, .logs-card { min-width: 0; border: 1px solid rgba(3,21,21,.08); border-radius: 22px; background: white; box-shadow: 0 14px 40px rgba(17,70,62,.055); }
.status-card__title { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; }
.status-card__actions { display: flex; align-items: center; gap: 6px; }
.status-card__title span, .status-card__title strong { display: block; }
.status-card__title strong { margin-top: 2px; font-size: 1.02rem; }
.template-details { display: grid; grid-template-columns: 1.5fr .7fr 1fr; gap: 10px; padding-top: 4px; }
.template-details > div { padding: 12px; border-radius: 13px; background: #f5fbf9; }
.template-details small, .template-details strong, .template-details code { display: block; }
.template-details small { margin-bottom: 5px; color: #6c817d; }
.template-example { margin-block: 8px !important; padding: 9px 11px; border-radius: 10px; background: rgba(255,255,255,.75); }
.provider-copy { color: #607572; font-size: .82rem; line-height: 1.55; }
.logs-card { max-width: 1380px; margin: 20px auto 0; overflow: hidden; }
.logs-heading { display: flex; align-items: center; justify-content: space-between; padding: 23px 25px 14px; }
.logs-heading h2 { margin: 4px 0 0; font-size: 1.45rem; }
.delivery-list { display: flex; flex-wrap: wrap; gap: 4px; }
@media (max-width: 1400px) { .status-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } .template-card { grid-column: 1 / -1; } }
@media (max-width: 900px) { .status-grid { grid-template-columns: 1fr; } .template-card { grid-column: auto; } }
@media (max-width: 650px) { .login-settings-page { padding: 22px 12px 40px; } .page-heading { display: block; } .page-heading .q-btn { width: 100%; margin-top: 16px; } .status-grid { grid-template-columns: 1fr; } .template-card { grid-column: auto; } .template-details { grid-template-columns: 1fr; } }
</style>
