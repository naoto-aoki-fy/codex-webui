<script setup lang="ts">
import type { ThreadGoal } from '../../api/codexGateway'

defineProps<{ goal: ThreadGoal }>()
</script>

<template>
  <button
    type="button"
    class="thread-goal-summary"
    :title="goal.objective"
    :aria-label="`Edit goal: ${goal.objective}`"
    aria-haspopup="dialog"
  >
    <strong>Goal</strong>
    <span class="thread-goal-preview">· {{ goal.status }} — {{ goal.objective }}</span>
  </button>
</template>
