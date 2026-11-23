<script setup lang="ts">
import type { ThreadGoalStatus } from '../../api/codexGateway'

defineProps<{ status: ThreadGoalStatus }>()

const statusLabels: Record<ThreadGoalStatus, string> = {
  active: 'active',
  paused: 'paused',
  blocked: 'blocked',
  usageLimited: 'usage limited',
  budgetLimited: 'budget limited',
  complete: 'completed',
}
</script>

<template>
  <button
    type="button"
    class="thread-goal-summary"
    aria-haspopup="dialog"
  >
    <strong>Goal:</strong> {{ statusLabels[status] }}
  </button>
</template>
