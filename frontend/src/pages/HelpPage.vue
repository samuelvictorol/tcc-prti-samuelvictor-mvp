<script setup>
import { ref } from 'vue'
import ContextHelp from '../components/ContextHelp.vue'
import PageHeader from '../components/PageHeader.vue'

const profileImageAvailable = ref(true)

const gettingStarted = [
  {
    step: '01',
    icon: 'settings_suggest',
    title: 'Configure os canais',
    text: 'Cadastre cada provedor separadamente. Um canal incompleto não impede o uso dos demais.',
    to: '/',
    action: 'Abrir configurações',
  },
  {
    step: '02',
    icon: 'link',
    title: 'Obtenha consentimento',
    text: 'Compartilhe uma página pública de convite. Nela, a pessoa entende os canais, aceita os termos e inicia a autorização.',
    to: '/invites',
    action: 'Ver convites',
  },
  {
    step: '03',
    icon: 'dashboard_customize',
    title: 'Prepare o conteúdo',
    text: 'Use templates adequados ao canal. No WhatsApp Cloud, selecione somente modelos aprovados pela Meta.',
    to: '/templates',
    action: 'Ver templates',
  },
  {
    step: '04',
    icon: 'send',
    title: 'Envie e acompanhe',
    text: 'Os disparos entram em fila. Cada destinatário recebe seu próprio status de sucesso, falha ou ignorado.',
    to: '/notifications',
    action: 'Abrir notificações',
  },
]

const helpJourney = [
  {
    icon: 'person',
    label: 'Contato',
    tooltip: 'A pessoa chega pela página pública do convite, entende os canais e escolhe como deseja começar.',
  },
  {
    icon: 'verified_user',
    label: 'Permissão',
    tooltip: 'O comando configurado registra o consentimento somente para uma identidade real do provedor.',
  },
  {
    icon: 'queue',
    label: 'Fila',
    tooltip: 'Depois de autorizar, a pessoa pode revisar dados e permissões em /meu-perfil; os envios válidos entram na fila.',
  },
  {
    icon: 'mark_email_read',
    label: 'Entrega',
    tooltip: 'A fila valida o canal e registra o resultado individual de cada entrega.',
  },
]

const channelGuides = [
  {
    icon: 'send_to_mobile',
    name: 'Telegram',
    accent: 'telegram',
    summary: 'Bots, mensagens privadas autorizadas e grupos.',
    points: [
      'A pessoa precisa iniciar o bot para registrar um chat_id válido.',
      'O comando de onboarding apresenta vínculo de telefone, Meu perfil e Ajuda.',
      'Contatos sem autorização são ignorados em campanhas e registrados no log.',
    ],
    to: '/telegram',
  },
  {
    icon: 'cloud_sync',
    name: 'WhatsApp oficial',
    accent: 'whatsapp',
    summary: 'Templates aprovados, consentimento e webhooks da Meta.',
    points: [
      'Envios iniciados pela empresa usam templates oficiais aprovados.',
      'O comando de autorização recebido pela API oficial registra o consentimento sem inventar identidades.',
      'Os chats são construídos com webhooks da Meta e atualizados em tempo real.',
    ],
    to: '/whatsapp-cloud',
  },
  {
    icon: 'mail',
    name: 'Gmail',
    accent: 'email',
    summary: 'Mensagens rápidas, templates e campanhas por grupo.',
    points: [
      'O endereço precisa estar ativo e autorizado para receber notificações.',
      'HTML é permitido somente nos templates de email.',
      'Uma falha individual não interrompe os outros destinatários da fila.',
    ],
    to: '/email',
  },
]

const operationalSignals = [
  { icon: 'schedule_send', title: 'Fila', text: 'Organiza cada entrega individualmente.' },
  { icon: 'replay', title: 'Tentativas', text: 'Falhas transitórias podem ser tentadas novamente.' },
  { icon: 'rule', title: 'Consentimento', text: 'O canal é validado antes de cada envio.' },
  { icon: 'receipt_long', title: 'Logs', text: 'Sucessos, falhas e contatos ignorados ficam rastreáveis.' },
]
</script>

<template>
  <q-page class="page-container help-page">
    <PageHeader
      eyebrow="Orientação"
      title="Central de Ajuda"
      description="Entenda o fluxo do Notify Flow sem precisar navegar por textos longos em cada tela."
      icon="help_center"
    />

    <q-card flat class="glass-card help-hero">
      <div class="help-hero__copy">
        <q-badge outline color="primary" label="Visão rápida" />
        <div class="help-hero__title-row">
          <h2>Do convite ao log de entrega</h2>
          <ContextHelp
            title="Como o Notify Flow organiza os envios"
            tooltip="Entenda o fluxo completo"
            text="O Notify Flow centraliza canais diferentes, respeita a permissão de cada contato e processa campanhas sem interromper toda a fila quando uma entrega falha."
          />
        </div>
        <div class="help-hero__actions">
          <q-btn unelevated color="primary" no-caps icon="rocket_launch" label="Começar pela configuração" to="/" />
          <q-btn outline color="primary" no-caps icon="manage_search" label="Ver histórico" to="/notifications" />
        </div>
      </div>
      <div class="help-hero__visual" aria-label="Fluxo resumido: contato, permissão, fila e entrega">
        <template v-for="(item, index) in helpJourney" :key="item.label">
          <span tabindex="0">
            <q-icon :name="item.icon" />
            <small>{{ item.label }}</small>
            <q-tooltip>{{ item.tooltip }}</q-tooltip>
          </span>
          <q-icon v-if="index < helpJourney.length - 1" name="arrow_forward" class="help-hero__arrow" />
        </template>
      </div>
    </q-card>

    <section class="help-section" aria-labelledby="getting-started-title">
      <div class="help-section__heading">
        <div>
          <span>Primeiros passos</span>
          <h2 id="getting-started-title">Um fluxo em quatro etapas</h2>
        </div>
        <p>Comece pela configuração e acompanhe cada destinatário até o resultado final.</p>
      </div>

      <div class="help-steps">
        <q-card v-for="item in gettingStarted" :key="item.step" flat class="glass-card help-step">
          <div class="help-step__top">
            <span class="help-step__number">{{ item.step }}</span>
            <q-icon :name="item.icon" />
          </div>
          <h3>{{ item.title }}</h3>
          <p>{{ item.text }}</p>
          <q-btn flat color="primary" no-caps :label="item.action" icon-right="arrow_forward" :to="item.to" />
        </q-card>
      </div>
    </section>

    <section class="help-section" aria-labelledby="channels-title">
      <div class="help-section__heading">
        <div>
          <span>Canais</span>
          <h2 id="channels-title">O que muda em cada integração</h2>
        </div>
        <p>A autorização continua separada por canal, mesmo quando o contato usa mais de uma identidade.</p>
      </div>

      <div class="channel-help-grid">
        <q-card
          v-for="channel in channelGuides"
          :key="channel.name"
          flat
          :class="['glass-card', 'channel-help', `channel-help--${channel.accent}`]"
        >
          <div class="channel-help__heading">
            <span><q-icon :name="channel.icon" /></span>
            <div>
              <h3>{{ channel.name }}</h3>
              <p>{{ channel.summary }}</p>
            </div>
          </div>
          <ul>
            <li v-for="point in channel.points" :key="point">{{ point }}</li>
          </ul>
          <q-btn outline color="primary" no-caps label="Abrir canal" :to="channel.to" />
        </q-card>
      </div>
    </section>

    <section class="help-section" aria-labelledby="profile-title">
      <q-card flat class="glass-card profile-help">
        <div class="profile-help__preview">
          <img
            v-if="profileImageAvailable"
            src="/meuperfil.png"
            alt="Prévia da tela Meu perfil do Notify Flow"
            width="1456"
            height="1054"
            loading="lazy"
            decoding="async"
            fetchpriority="low"
            @error="profileImageAvailable = false"
          />
          <div v-else class="profile-help__placeholder" role="img" aria-label="Espaço reservado para a imagem da tela Meu perfil">
            <span><q-icon name="image" /></span>
            <strong>Prévia de Meu perfil</strong>
            <small>A imagem meuperfil.png será exibida aqui quando estiver disponível.</small>
          </div>
        </div>
        <div class="profile-help__copy">
          <span class="help-kicker">Área do contato</span>
          <h2 id="profile-title">Meu perfil</h2>
          <p>
            Em <strong>/meu-perfil</strong>, o contato entra com email ou telefone por um link
            pessoal de uso único e acompanha os canais autorizados e as notificações recebidas.
          </p>
          <div class="profile-help__features">
            <div><q-icon name="link" /><span><strong>Acesso seguro</strong><small>Link pessoal, de uso único, enviado pelo canal confirmado.</small></span></div>
            <div><q-icon name="tune" /><span><strong>Preferências</strong><small>Revogação de permissões com confirmação explícita.</small></span></div>
            <div><q-icon name="history" /><span><strong>Histórico individual</strong><small>Somente entregas relacionadas ao próprio contato.</small></span></div>
          </div>
          <q-btn unelevated color="primary" no-caps icon="open_in_new" label="Abrir Meu perfil" to="/meu-perfil" />
        </div>
      </q-card>
    </section>

    <section class="help-section" aria-labelledby="delivery-title">
      <div class="help-section__heading">
        <div>
          <span>Operação segura</span>
          <div class="help-section__title-row">
            <h2 id="delivery-title">O que acontece em um disparo</h2>
            <ContextHelp
              title="Resultados por destinatário"
              tooltip="Entenda os resultados do disparo"
              :text="[
                'Enviado: o provedor confirmou o aceite da entrega.',
                'Falhou: ocorreu um erro permanente ou as novas tentativas se esgotaram.',
                'Ignorado: o contato não possui identidade válida ou autorização para o canal escolhido. O restante da fila continua normalmente.',
              ]"
            />
          </div>
        </div>
        <p>Um destinatário inválido ou sem consentimento não bloqueia os demais.</p>
      </div>
      <q-card flat class="glass-card delivery-flow">
        <div v-for="signal in operationalSignals" :key="signal.title" class="delivery-flow__item">
          <span><q-icon :name="signal.icon" /></span>
          <div><strong>{{ signal.title }}</strong><small>{{ signal.text }}</small></div>
        </div>
      </q-card>
    </section>

    <q-banner rounded class="help-footer-banner">
      <template #avatar><q-icon name="support_agent" color="primary" /></template>
      <strong>Precisa investigar um envio?</strong>
      Consulte o histórico da notificação e os logs por destinatário antes de reenviar.
      <template #action>
        <q-btn flat color="primary" no-caps label="Abrir notificações" to="/notifications" />
      </template>
    </q-banner>
  </q-page>
</template>

<style scoped>
.help-page {
  display: grid;
  gap: 34px;
}

.help-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(380px, 0.95fr);
  align-items: center;
  gap: clamp(24px, 4vw, 60px);
  padding: clamp(24px, 4vw, 48px);
  overflow: hidden;
}

.help-hero h2 {
  max-width: 650px;
  margin: 14px 0 10px;
  color: var(--ink);
  font-size: clamp(1.7rem, 4vw, 3rem);
  letter-spacing: -0.055em;
  line-height: 1.02;
}

.help-hero__title-row {
  display: flex;
  max-width: 680px;
  align-items: center;
  gap: 7px;
}

.help-hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 23px;
}

.help-hero__visual {
  display: grid;
  grid-template-columns: repeat(7, auto);
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-height: 220px;
  padding: 28px 20px;
  border: 1px solid rgba(53, 188, 164, 0.18);
  border-radius: 24px;
  background:
    radial-gradient(circle at 50% 50%, rgba(130, 248, 230, 0.22), transparent 70%),
    rgba(255, 255, 255, 0.46);
}

.help-hero__visual span {
  display: grid;
  width: 78px;
  height: 84px;
  align-content: center;
  justify-items: center;
  gap: 7px;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 12px 30px rgba(3, 62, 55, 0.09);
  color: #137d6c;
}

.help-hero__visual span .q-icon {
  font-size: 28px;
}

.help-hero__visual small {
  color: #526c67;
  font-size: 0.68rem;
  font-weight: 750;
}

.help-hero__arrow {
  color: #79a39c;
}

.help-section {
  display: grid;
  gap: 18px;
}

.help-section__heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
}

.help-section__heading span,
.help-kicker {
  color: #137d6c;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.help-section__heading h2,
.profile-help__copy h2 {
  margin: 5px 0 0;
  color: var(--ink);
  font-size: clamp(1.35rem, 3vw, 2rem);
  letter-spacing: -0.04em;
}

.help-section__title-row {
  display: flex;
  align-items: center;
  gap: 7px;
}

.help-section__heading > p {
  max-width: 560px;
  margin: 0;
  color: var(--muted);
  line-height: 1.5;
  text-align: right;
}

.help-steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.help-step {
  display: flex;
  min-height: 260px;
  flex-direction: column;
  padding: 20px;
}

.help-step__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #137d6c;
  font-size: 25px;
}

.help-step__number {
  font-size: 0.72rem;
  font-weight: 850;
  letter-spacing: 0.1em;
}

.help-step h3,
.channel-help h3 {
  margin: 25px 0 7px;
  color: var(--ink);
  font-size: 1.05rem;
}

.help-step p {
  flex: 1;
  margin: 0 0 13px;
  color: var(--muted);
  font-size: 0.84rem;
  line-height: 1.55;
}

.help-step .q-btn {
  align-self: flex-start;
  margin-left: -12px;
}

.channel-help-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.channel-help {
  display: flex;
  min-height: 360px;
  flex-direction: column;
  padding: 22px;
  border-top: 4px solid #35bca4;
}

.channel-help--telegram {
  border-top-color: #249bd7;
}

.channel-help--whatsapp {
  border-top-color: #1fae74;
}

.channel-help--email {
  border-top-color: #d96a57;
}

.channel-help__heading {
  display: flex;
  align-items: center;
  gap: 13px;
}

.channel-help__heading > span {
  display: grid;
  width: 46px;
  height: 46px;
  flex: 0 0 46px;
  border-radius: 15px;
  background: rgba(53, 188, 164, 0.13);
  color: #137d6c;
  font-size: 23px;
  place-items: center;
}

.channel-help h3 {
  margin: 0;
}

.channel-help__heading p {
  margin: 3px 0 0;
  color: var(--muted);
  font-size: 0.76rem;
}

.channel-help ul {
  flex: 1;
  margin: 22px 0;
  padding-left: 20px;
  color: #49635f;
  font-size: 0.83rem;
  line-height: 1.55;
}

.channel-help li + li {
  margin-top: 10px;
}

.channel-help .q-btn {
  align-self: flex-start;
}

.profile-help {
  display: grid;
  grid-template-columns: minmax(320px, 0.95fr) minmax(0, 1.05fr);
  gap: clamp(24px, 4vw, 54px);
  padding: clamp(20px, 3vw, 34px);
}

.profile-help__preview {
  min-height: 430px;
  overflow: hidden;
  border: 1px solid rgba(3, 21, 21, 0.09);
  border-radius: 22px;
  background: #eef9f6;
}

.profile-help__preview img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: top center;
}

.profile-help__placeholder {
  display: grid;
  height: 100%;
  min-height: 430px;
  align-content: center;
  justify-items: center;
  gap: 9px;
  padding: 32px;
  color: #5c7772;
  text-align: center;
}

.profile-help__placeholder span {
  display: grid;
  width: 68px;
  height: 68px;
  border-radius: 22px;
  background: rgba(53, 188, 164, 0.14);
  color: #137d6c;
  font-size: 34px;
  place-items: center;
}

.profile-help__placeholder small {
  max-width: 290px;
  line-height: 1.45;
}

.profile-help__copy {
  align-self: center;
}

.profile-help__copy > p {
  margin: 13px 0 22px;
  color: var(--muted);
  line-height: 1.65;
}

.profile-help__features {
  display: grid;
  gap: 11px;
  margin-bottom: 24px;
}

.profile-help__features > div {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 12px;
  border-radius: 14px;
  background: rgba(130, 248, 230, 0.1);
}

.profile-help__features .q-icon {
  margin-top: 2px;
  color: #137d6c;
  font-size: 21px;
}

.profile-help__features strong,
.profile-help__features small {
  display: block;
}

.profile-help__features small {
  margin-top: 2px;
  color: #617773;
  line-height: 1.4;
}

.delivery-flow {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  padding: 22px;
}

.delivery-flow__item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 74px;
  padding: 10px 18px;
  border-right: 1px solid var(--line);
}

.delivery-flow__item:last-child {
  border-right: 0;
}

.delivery-flow__item > span {
  color: #137d6c;
  font-size: 26px;
}

.delivery-flow__item strong,
.delivery-flow__item small {
  display: block;
}

.delivery-flow__item small {
  margin-top: 3px;
  color: var(--muted);
  line-height: 1.35;
}

.help-footer-banner {
  border: 1px solid rgba(53, 188, 164, 0.2);
  background: rgba(130, 248, 230, 0.13);
  color: #365a54;
}

.help-footer-banner strong {
  color: #173f39;
}

@media (max-width: 1200px) {
  .help-steps,
  .delivery-flow {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .delivery-flow__item:nth-child(2) {
    border-right: 0;
  }

  .delivery-flow__item:nth-child(-n + 2) {
    border-bottom: 1px solid var(--line);
  }
}

@media (max-width: 980px) {
  .help-hero,
  .profile-help {
    grid-template-columns: 1fr;
  }

  .channel-help-grid {
    grid-template-columns: 1fr;
  }

  .channel-help {
    min-height: 0;
  }
}

@media (max-width: 700px) {
  .help-page {
    gap: 26px;
  }

  .help-section__heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }

  .help-section__heading > p {
    text-align: left;
  }

  .help-hero__visual {
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    min-height: 0;
    padding: 16px 10px;
  }

  .help-hero__visual span {
    width: 100%;
    min-width: 0;
    height: 74px;
  }

  .help-hero__arrow {
    display: none;
  }

  .profile-help__preview,
  .profile-help__placeholder {
    min-height: 310px;
  }
}

@media (max-width: 520px) {
  .help-steps,
  .delivery-flow {
    grid-template-columns: 1fr;
  }

  .help-step {
    min-height: 230px;
  }

  .delivery-flow__item {
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .delivery-flow__item:nth-child(3) {
    border-bottom: 1px solid var(--line);
  }

  .delivery-flow__item:last-child {
    border-bottom: 0;
  }

  .profile-help__preview,
  .profile-help__placeholder {
    min-height: 250px;
  }
}
</style>
