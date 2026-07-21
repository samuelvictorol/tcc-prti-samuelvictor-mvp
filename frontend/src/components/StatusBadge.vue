<script setup>
import { computed } from 'vue'

const props = defineProps({
  value: { type: [Boolean, String, Object], default: false },
  activeLabel: { type: String, default: 'Disponível' },
  inactiveLabel: { type: String, default: 'Indisponível' },
})

const active = computed(() => {
  if (typeof props.value === 'boolean') return props.value
  if (typeof props.value === 'string') return ['ready', 'active', 'connected', 'configured', 'enabled'].includes(props.value)
  const value = props.value || {}
  return Boolean(value.connected || value.authenticated || value.configured || value.enabled || value.ready || value.status === 'ready')
})
</script>

<template>
  <q-badge
    rounded
    :color="active ? 'positive' : 'grey-6'"
    :label="active ? activeLabel : inactiveLabel"
    class="q-px-sm q-py-xs"
  />
</template>
