<script setup>
defineProps({
  eyebrow: { type: String, default: '' },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  icon: { type: String, default: '' },
})
</script>

<template>
  <header class="page-header">
    <div class="page-header__copy">
      <div v-if="eyebrow" class="page-header__eyebrow">{{ eyebrow }}</div>
      <div class="page-header__title-row">
        <q-icon v-if="icon" :name="icon" size="30px" color="primary" aria-hidden="true" />
        <h1>{{ title }}</h1>
      </div>
      <p v-if="description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 24px;
}

.page-header__copy {
  min-width: 0;
}

.page-header__eyebrow {
  margin-bottom: 5px;
  color: #137d6c;
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.page-header__title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

h1 {
  margin: 0;
  color: #031515;
  font-size: clamp(1.65rem, 4vw, 2.45rem);
  font-weight: 820;
  letter-spacing: -0.05em;
  line-height: 1.08;
}

p {
  max-width: 760px;
  margin: 9px 0 0;
  color: #506865;
  font-size: 0.98rem;
  line-height: 1.55;
}

.page-header__actions {
  display: flex;
  flex: none;
  gap: 10px;
}

@media (max-width: 700px) {
  .page-header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
