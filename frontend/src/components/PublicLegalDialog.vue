<script setup>
import { computed, ref, watch } from 'vue'
import DOMPurify from 'dompurify'
import { useQuasar } from 'quasar'
import { PUBLIC_LEGAL_TYPES } from '../services/public-invites.js'

const $q = useQuasar()

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  documents: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'accepted'])
const activeType = ref('terms_of_use')

const visibleDocuments = computed(() => PUBLIC_LEGAL_TYPES.map((definition) => {
  const document = props.documents.find((item) => item?.type === definition.type) || {}
  return { ...definition, ...document, title: document.title || definition.title }
}))

function safeContent(document) {
  return DOMPurify.sanitize(document?.content || '<p>Documento indisponível.</p>', { USE_PROFILES: { html: true } })
}

function accept() {
  emit('accepted')
  emit('update:modelValue', false)
}

watch(() => props.modelValue, (open) => {
  if (open) activeType.value = visibleDocuments.value[0]?.type || 'terms_of_use'
})
</script>

<template>
  <q-dialog
    :model-value="modelValue"
    persistent
    no-esc-dismiss
    no-backdrop-dismiss
    :maximized="$q.screen.lt.sm"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <q-card class="public-legal-dialog" role="document" aria-label="Termos e política de privacidade">
      <q-card-section class="public-legal-dialog__header">
        <div class="legal-heading-icon"><q-icon name="verified_user" /></div>
        <div>
          <div class="text-h6 text-weight-bold">Termos e Privacidade</div>
          <div class="text-caption text-muted">Leia os documentos antes de acessar os canais deste convite.</div>
        </div>
      </q-card-section>

      <q-tabs
        v-model="activeType"
        dense
        no-caps
        outside-arrows
        mobile-arrows
        active-color="primary"
        indicator-color="primary"
        class="public-legal-dialog__tabs"
      >
        <q-tab v-for="document in visibleDocuments" :key="document.type" :name="document.type" :label="document.title" />
      </q-tabs>
      <q-separator />

      <div class="public-legal-dialog__scroll">
        <q-inner-loading :showing="loading"><q-spinner color="primary" size="42px" /></q-inner-loading>
        <q-tab-panels v-model="activeType" animated class="transparent">
          <q-tab-panel v-for="document in visibleDocuments" :key="document.type" :name="document.type" class="legal-document-panel">
            <header>
              <div>
                <h2>{{ document.title }}</h2>
                <span>Versão {{ document.version || 'publicada' }}</span>
              </div>
              <q-badge v-if="document.fallback" outline color="warning" label="Aguardando publicação" />
              <q-badge v-else outline color="positive" icon="verified" label="Documento publicado" />
            </header>
            <article class="legal-document-content" v-html="safeContent(document)" />
          </q-tab-panel>
        </q-tab-panels>
      </div>

      <q-separator />
      <q-card-actions class="public-legal-dialog__footer">
        <span>Ao aceitar, você confirma que teve acesso aos documentos apresentados.</span>
        <q-btn color="primary" unelevated no-caps icon="check_circle" label="Aceitar e continuar" :disable="loading" @click="accept" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.public-legal-dialog {
  display: flex;
  width: min(860px, calc(100vw - 32px));
  max-width: 860px !important;
  height: min(760px, calc(100dvh - 32px));
  max-height: calc(100dvh - 32px);
  flex-direction: column;
  overflow: hidden;
  border-radius: 24px;
  background: #f9fffd;
}

.public-legal-dialog__header {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 12px;
  padding: 20px 24px 12px;
}

.legal-heading-icon {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  border-radius: 14px;
  background: rgba(53, 188, 164, 0.14);
  color: #137d6c;
  font-size: 23px;
  place-items: center;
}

.public-legal-dialog__tabs {
  flex: 0 0 auto;
  padding: 0 14px;
}

.public-legal-dialog__scroll {
  position: relative;
  min-height: 0;
  flex: 1 1 auto;
  overflow: auto;
  overscroll-behavior: contain;
}

.legal-document-panel {
  padding: clamp(20px, 4vw, 34px);
}

.legal-document-panel header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 22px;
}

.legal-document-panel h2 {
  margin: 0 0 4px;
  font-size: clamp(1.35rem, 4vw, 1.9rem);
}

.legal-document-panel header span {
  color: #667a77;
  font-size: 0.74rem;
}

.legal-document-content {
  color: #385550;
  font-size: 0.92rem;
  line-height: 1.75;
}

.legal-document-content :deep(a) {
  color: #137d6c;
  overflow-wrap: anywhere;
}

.public-legal-dialog__footer {
  display: flex;
  min-height: 76px;
  align-items: center;
  justify-content: flex-end;
  flex: 0 0 auto;
  gap: 18px;
  padding: 14px 22px;
  background: rgba(249, 255, 253, 0.98);
  box-shadow: 0 -10px 28px rgba(3, 62, 55, 0.06);
}

.public-legal-dialog__footer span {
  max-width: 440px;
  color: #617572;
  font-size: 0.72rem;
  line-height: 1.45;
}

@media (max-width: 600px) {
  .public-legal-dialog {
    width: 100%;
    max-width: 100% !important;
    height: 100%;
    max-height: 100%;
    border-radius: 0;
  }

  .public-legal-dialog__header {
    padding: 16px 16px 10px;
  }

  .public-legal-dialog__footer {
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
    padding: 12px 16px max(12px, env(safe-area-inset-bottom));
  }

  .public-legal-dialog__footer .q-btn {
    width: 100%;
    min-height: 46px;
  }
}
</style>
