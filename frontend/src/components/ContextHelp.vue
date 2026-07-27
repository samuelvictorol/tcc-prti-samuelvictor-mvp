<script setup>
import { computed, ref, useId } from 'vue'
import { useQuasar } from 'quasar'

const props = defineProps({
  title: { type: String, required: true },
  text: { type: [String, Array], default: '' },
  tooltip: { type: String, default: 'Ver explicação' },
  ariaLabel: { type: String, default: '' },
  icon: { type: String, default: 'help_outline' },
  persistent: { type: Boolean, default: false },
})

const $q = useQuasar()
const isOpen = ref(false)
const titleId = `context-help-${useId()}`
const copyBlocks = computed(() => {
  const values = Array.isArray(props.text) ? props.text : [props.text]
  return values.map((value) => String(value || '').trim()).filter(Boolean)
})
const triggerLabel = computed(() => props.ariaLabel || `${props.tooltip}: ${props.title}`)

function open() {
  isOpen.value = true
}

defineExpose({ open })
</script>

<template>
  <span class="context-help">
    <q-btn
      flat
      round
      dense
      color="primary"
      :icon="icon"
      :aria-label="triggerLabel"
      aria-haspopup="dialog"
      :aria-expanded="String(isOpen)"
      class="context-help__trigger"
      @click="open"
    >
      <q-tooltip :delay="350">{{ tooltip }}</q-tooltip>
    </q-btn>

    <q-dialog
      v-model="isOpen"
      :persistent="persistent"
      :maximized="$q.screen.lt.sm"
      transition-show="scale"
      transition-hide="scale"
    >
      <q-card class="context-help__dialog" :aria-labelledby="titleId">
        <q-card-section class="context-help__header">
          <div class="context-help__heading">
            <span class="context-help__icon" aria-hidden="true">
              <q-icon :name="icon" />
            </span>
            <div>
              <div class="context-help__eyebrow">Como funciona</div>
              <h2 :id="titleId">{{ title }}</h2>
            </div>
          </div>
          <q-btn
            v-if="!persistent"
            v-close-popup
            flat
            round
            dense
            icon="close"
            aria-label="Fechar ajuda"
          />
        </q-card-section>

        <q-separator />

        <q-card-section class="context-help__body">
          <slot>
            <p v-for="(block, index) in copyBlocks" :key="index">{{ block }}</p>
          </slot>
        </q-card-section>

        <q-separator />

        <q-card-actions align="right" class="context-help__actions">
          <slot name="actions">
            <q-btn v-close-popup unelevated color="primary" no-caps label="Entendi" />
          </slot>
        </q-card-actions>
      </q-card>
    </q-dialog>
  </span>
</template>

<style scoped>
.context-help {
  display: inline-flex;
  vertical-align: middle;
}

.context-help__trigger {
  min-width: 34px;
  min-height: 34px;
}

.context-help__dialog {
  display: flex;
  width: min(680px, calc(100vw - 32px));
  max-width: 680px !important;
  max-height: calc(100dvh - 32px);
  flex-direction: column;
  overflow: hidden;
  border-radius: 24px;
  background: #f9fffd;
}

.context-help__header {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 22px;
}

.context-help__heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 13px;
}

.context-help__icon {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  border-radius: 15px;
  background: rgba(53, 188, 164, 0.14);
  color: #137d6c;
  font-size: 24px;
  place-items: center;
}

.context-help__eyebrow {
  margin-bottom: 3px;
  color: #137d6c;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.11em;
  text-transform: uppercase;
}

h2 {
  margin: 0;
  color: #031515;
  font-size: clamp(1.15rem, 3vw, 1.45rem);
  letter-spacing: -0.03em;
  line-height: 1.2;
}

.context-help__body {
  min-height: 0;
  flex: 1 1 auto;
  padding: 22px;
  overflow-y: auto;
  overscroll-behavior: contain;
  color: #49635f;
  line-height: 1.65;
}

.context-help__body p {
  margin: 0;
  white-space: pre-line;
}

.context-help__body p + p {
  margin-top: 14px;
}

.context-help__actions {
  flex: 0 0 auto;
  padding: 13px 18px;
  background: rgba(249, 255, 253, 0.96);
}

@media (max-width: 599px) {
  .context-help__dialog {
    width: 100%;
    max-width: none !important;
    max-height: 100dvh;
    border-radius: 0;
  }

  .context-help__header {
    padding: 16px;
  }

  .context-help__body {
    padding: 18px 16px;
  }

  .context-help__actions {
    padding-bottom: max(13px, env(safe-area-inset-bottom));
  }
}
</style>
