<template>
  <span class="fork-split-button" :class="{ 'fork-split-sidebar': variant === 'sidebar' }" :title="nativeUnavailableReason || undefined">
    <button
      class="fork-split-main"
      type="button"
      :aria-label="ariaLabel"
      :title="nativeUnavailableReason || ariaLabel"
      :aria-description="nativeUnavailableReason || undefined"
      :disabled="disabled || !nativeAvailable"
      @click="chooseFork('native')"
    >
      <IconTablerGitFork v-if="variant !== 'sidebar'" class="icon-svg fork-split-icon" />
      <span>{{ label }}</span>
    </button>
    <ComposerDropdown model-value="" icon-only placeholder="Fork options" menu-align="end"
      :disabled="disabled" :options="options" @update:model-value="chooseFork" />
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ForkMethod } from '../../types/codex'
import ComposerDropdown from './ComposerDropdown.vue'
import IconTablerGitFork from '../icons/IconTablerGitFork.vue'

const props = withDefaults(defineProps<{
  label?: string
  ariaLabel?: string
  disabled?: boolean
  nativeAvailable?: boolean
  variant?: 'toolbar' | 'sidebar'
}>(), { label: 'Fork', ariaLabel: 'Fork conversation', nativeAvailable: true, variant: 'toolbar' })
const emit = defineEmits<{ fork: [method: ForkMethod] }>()
const nativeUnavailableReason = computed(() => props.nativeAvailable ? '' : 'This imported response has no native turn boundary. Choose Portable Fork.')
const options = computed(() => [
  { value: 'native', label: 'Native Fork', disabled: !props.nativeAvailable, title: nativeUnavailableReason.value || undefined },
  { value: 'portable', label: 'Portable Fork' },
])
function chooseFork(method: string): void {
  if (props.disabled || (method !== 'native' && method !== 'portable') || (method === 'native' && !props.nativeAvailable)) return
  emit('fork', method)
}
</script>

<style scoped>
@reference "../../style.css";
.fork-split-button { @apply inline-flex items-center; }
.fork-split-main { @apply inline-flex items-center gap-0.5 px-0.5 py-0 text-[9px] font-medium leading-none text-slate-500 transition hover:text-slate-900; }
.fork-split-main:disabled { @apply cursor-not-allowed opacity-50; }
.fork-split-icon { @apply text-[10px]; }
.fork-split-sidebar { @apply flex w-full; }
.fork-split-sidebar .fork-split-main { @apply flex-1 rounded px-2 py-1 text-left text-sm font-normal text-zinc-700 hover:bg-zinc-100; }
</style>
