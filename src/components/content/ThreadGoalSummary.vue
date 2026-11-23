<script setup lang="ts">
import type { ThreadGoalStatus } from '../../api/codexGateway'

defineProps<{ status: ThreadGoalStatus }>()
const emit = defineEmits<{ 'open-settings': [] }>()

const statusLabels: Record<ThreadGoalStatus, string> = {
  active: 'active',
  paused: 'paused',
  blocked: 'blocked',
  usageLimited: 'usage limited',
  budgetLimited: 'budget limited',
  complete: 'completed',
}

function openSettings(event: MouseEvent): void {
  if (event.currentTarget instanceof HTMLButtonElement) {
    event.currentTarget.focus({ preventScroll: true })
  }
  emit('open-settings')
}
</script>

<template>
  <button
    type="button"
    class="thread-goal-summary"
    aria-haspopup="dialog"
    @click="openSettings"
  >
    <strong>Goal:</strong> {{ statusLabels[status] }}
  </button>
</template>
