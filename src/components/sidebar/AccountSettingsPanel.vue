<script setup lang="ts">
import ConnectionDiagnostics from './ConnectionDiagnostics.vue'
import { useUiLanguage } from '../../composables/useUiLanguage'

defineProps<{
  authAvailable: boolean | null
  refreshing: boolean
  changeBlocked: boolean
  error: string
}>()

const emit = defineEmits<{
  refresh: []
  logout: []
}>()

const { t } = useUiLanguage()
</script>

<template>
  <div class="sidebar-settings-account-section">
    <div class="sidebar-settings-account-header">
      <span class="sidebar-settings-account-title">{{ t('Codex account') }}</span>
      <button class="sidebar-settings-account-refresh" type="button" :disabled="refreshing" @click="emit('refresh')">{{ refreshing ? t('Reloading…') : t('Reload') }}</button>
    </div>
    <p class="sidebar-settings-account-empty">{{ authAvailable === true ? t('Signed in to Codex') : authAvailable === false ? t('Authentication is managed by the external Codex app-server. Sign in there, then reconnect.') : t('External Codex authentication status unavailable. Check the app-server connection.') }}</p>
    <div v-if="error" class="sidebar-settings-account-error">{{ error }}</div>
    <ConnectionDiagnostics />
    <div class="sidebar-settings-account-login">
      <button v-if="authAvailable === true" class="sidebar-settings-account-login-button" type="button" :disabled="changeBlocked || refreshing" @click="emit('logout')">{{ t('Logout') }}</button>
    </div>
  </div>
</template>

<style scoped>
@reference "tailwindcss";

.sidebar-settings-account-section {
  @apply border-t border-zinc-100 bg-zinc-50/60 px-3 py-3;
}

.sidebar-settings-account-header {
  @apply mb-2 flex items-center justify-between gap-2;
}

.sidebar-settings-account-title {
  @apply text-sm font-medium text-zinc-800;
}

.sidebar-settings-account-error {
  @apply mb-2 rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-700;
}

.sidebar-settings-account-refresh {
  @apply shrink-0 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-default disabled:opacity-60;
}

.sidebar-settings-account-login {
  @apply mb-2 flex items-center gap-2;
}

.sidebar-settings-account-login-button {
  @apply shrink-0 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-default disabled:opacity-60;
}

.sidebar-settings-account-empty {
  @apply text-xs text-zinc-500;
}
</style>
