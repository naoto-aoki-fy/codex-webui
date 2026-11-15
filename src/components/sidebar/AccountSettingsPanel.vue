<script setup lang="ts">
import type { DiagnosticWarning } from '../../diagnostics'
import {defineAsyncComponent} from 'vue'
const RemoteControlStatus = defineAsyncComponent(() => import('./RemoteControlStatus.vue'))
const AuthInspection = defineAsyncComponent(() => import('./AuthInspection.vue'))
const NativeAuthentication = defineAsyncComponent(() => import('./NativeAuthentication.vue'))
import AccountUsage from './AccountUsage.vue'
import ConnectionDiagnostics from './ConnectionDiagnostics.vue'

defineProps<{
  warnings: DiagnosticWarning[]
  epoch: number
  authAvailable: boolean | null
  refreshing: boolean
  changeBlocked: boolean
  error: string
  nativeAuth:import('../../composables/nativeAuthentication').NativeAuthentication|null
  ensureNativeAuth:()=>Promise<import('../../composables/nativeAuthentication').NativeAuthentication|null>
}>()

const emit = defineEmits<{
  refresh: []
  logout: []
}>()

</script>

<template>
  <div class="sidebar-settings-account-section">
    <div class="sidebar-settings-account-header">
      <span class="sidebar-settings-account-title">{{ ('Codex account') }}</span>
      <button class="sidebar-settings-account-refresh" type="button" :disabled="refreshing" @click="emit('refresh')">{{ refreshing ? ('Reloading…') : ('Reload') }}</button>
    </div>
    <p class="sidebar-settings-account-empty">{{ authAvailable === true ? ('Signed in to Codex') : authAvailable === false ? ('Authentication is managed by the external Codex app-server. Sign in there, then reconnect.') : ('External Codex authentication status unavailable. Check the app-server connection.') }}</p>
    <div v-if="error" class="sidebar-settings-account-error">{{ error }}</div>
    <RemoteControlStatus :epoch="epoch" />
    <AuthInspection :epoch="epoch" />
    <NativeAuthentication :auth="nativeAuth" :ensure-auth="ensureNativeAuth" :blocked="changeBlocked" />
    <AccountUsage :epoch="epoch" />
    <ConnectionDiagnostics :epoch="epoch" :warnings="warnings" />
    <div class="sidebar-settings-account-login">
      <button v-if="authAvailable === true" class="sidebar-settings-account-login-button" type="button" :disabled="changeBlocked || refreshing" @click="emit('logout')">{{ ('Logout') }}</button>
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
