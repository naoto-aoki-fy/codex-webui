<template>
  <button
    class="skill-card"
    type="button"
    :class="{ 'is-disabled': skill.enabled === false }"
    @click="$emit('select', skill)"
  >
    <div class="skill-card-top">
      <div class="skill-card-info">
        <div class="skill-card-header">
          <span class="skill-card-name">{{ skill.name }}</span>
        </div>
      </div>
    </div>
    <p v-if="skill.description" class="skill-card-desc">{{ skill.description }}</p>
  </button>
</template>

<script setup lang="ts">
import type { LocalSkill } from '../../types/skills'

defineProps<{ skill: LocalSkill }>()
defineEmits<{ select: [skill: LocalSkill] }>()
</script>

<style scoped>
@reference "tailwindcss";

.skill-card {
  @apply flex flex-col gap-1.5 rounded-xl border border-zinc-200 bg-white p-3 text-left transition hover:border-zinc-300 hover:shadow-sm cursor-pointer;
}

.skill-card.is-disabled {
  @apply opacity-50;
}

.skill-card-top {
  @apply flex items-start gap-2.5;
}

.skill-card-info {
  @apply flex flex-col gap-0.5 min-w-0 flex-1;
}

.skill-card-header {
  @apply flex items-center gap-2;
}

.skill-card-name {
  @apply text-sm font-medium text-zinc-900 truncate;
}

.skill-card-desc {
  @apply m-0 text-xs text-zinc-500 line-clamp-2;
}

</style>
