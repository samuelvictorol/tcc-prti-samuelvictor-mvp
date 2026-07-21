<script setup>
defineProps({
  icon: { type: String, default: 'inbox' },
  title: { type: String, default: 'Nada por aqui ainda' },
  description: { type: String, default: 'Os registros aparecerão aqui quando forem adicionados.' },
})
</script>

<template>
  <div class="empty-state">
    <div>
      <q-icon :name="icon" size="44px" color="primary" aria-hidden="true" />
      <div class="text-weight-bold text-dark q-mt-md">{{ title }}</div>
      <div class="q-mt-xs">{{ description }}</div>
      <div v-if="$slots.default" class="q-mt-md"><slot /></div>
    </div>
  </div>
</template>
