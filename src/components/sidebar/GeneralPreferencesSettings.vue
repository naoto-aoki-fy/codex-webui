<script setup lang="ts">
import { t } from '../../composables/useUiLanguage'

defineProps<{
  sendWithEnter: boolean
  darkMode: 'system' | 'light' | 'dark'
  chatWidthLabel: string
  help: { sendWithEnter: string; appearance: string; chatWidth: string }
}>()

const emit = defineEmits<{
  toggleSendWithEnter: []
  cycleDarkMode: []
  cycleChatWidth: []
}>()
</script>

<template>
  <button class="sidebar-settings-row" type="button" :title="help.sendWithEnter" @click="emit('toggleSendWithEnter')">
    <span class="sidebar-settings-label">{{ t('Require ⌘ + enter to send') }}</span>
    <span class="sidebar-settings-toggle" :class="{ 'is-on': !sendWithEnter }" />
  </button>
  <button class="sidebar-settings-row" type="button" :title="help.appearance" @click="emit('cycleDarkMode')">
    <span class="sidebar-settings-label">{{ t('Appearance') }}</span>
    <span class="sidebar-settings-value">{{ darkMode === 'system' ? t('System') : darkMode === 'dark' ? t('Dark') : t('Light') }}</span>
  </button>
  <button class="sidebar-settings-row" type="button" :title="help.chatWidth" @click="emit('cycleChatWidth')">
    <span class="sidebar-settings-label">{{ t('Chat width') }}</span>
    <span class="sidebar-settings-value">{{ chatWidthLabel }}</span>
  </button>
</template>

<style scoped>
@reference "tailwindcss";

.sidebar-settings-row {
  @apply flex items-center justify-between w-full px-3 py-2.5 text-sm text-zinc-700 border-0 bg-transparent transition hover:bg-zinc-50 cursor-pointer;
}

.sidebar-settings-row + .sidebar-settings-row {
  @apply border-t border-zinc-100;
}

.sidebar-settings-label {
  @apply text-left;
}

.sidebar-settings-value {
  @apply text-xs text-zinc-500 bg-zinc-100 rounded px-1.5 py-0.5;
}

.sidebar-settings-toggle {
  @apply relative w-9 h-5 rounded-full bg-zinc-300 transition-colors shrink-0;
}

.sidebar-settings-toggle::after {
  content: '';
  @apply absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm;
}

.sidebar-settings-toggle.is-on {
  @apply bg-zinc-800;
}

.sidebar-settings-toggle.is-on::after {
  transform: translateX(16px);
}

</style>
