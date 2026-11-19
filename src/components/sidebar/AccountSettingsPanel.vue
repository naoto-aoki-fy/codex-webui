<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { createAccountSettings } from '../../composables/accountSettings'
import type { LoginMethod } from '../../api/nativeAuthentication'
import ComposerDropdown from '../content/ComposerDropdown.vue'
import AccountUsage from './AccountUsage.vue'

const props = defineProps<{
  epoch: number
  auth: ReturnType<typeof createAccountSettings>
  changeBlocked?: boolean
}>()

const account = computed(() => props.auth.status.value?.account)
const busy = computed(() => props.auth.busy.value || props.auth.loading.value)
const method = ref<LoginMethod>('chatgpt')
const confirmed = ref(false)
watch([account, props.auth.challenge], () => { confirmed.value = false })
</script>

<template>
  <div class="sidebar-settings-account-section">
    <div class="sidebar-settings-account-header">
      <span class="sidebar-settings-account-title">Codex account</span>
      <button class="sidebar-settings-account-refresh" type="button" :disabled="busy" @click="auth.refresh">
        Reload
      </button>
    </div>
    <p class="sidebar-settings-account-empty" role="status">
      {{ account ? 'Signed in to Codex' : auth.loading.value ? 'Loading account details…' : 'Authentication is managed by the App Server.' }}
    </p>
    <div v-if="account" class="sidebar-settings-account-empty">
      <p>{{ account.email || account.type }}</p>
      <p v-if="account.workspaceName">{{ account.workspaceName }}</p>
      <p v-if="account.planType">{{ account.planType }}</p>
    </div>
    <div v-if="auth.readError.value" class="sidebar-settings-account-error" role="alert">{{ auth.readError.value }}</div>
    <div v-if="auth.actionError.value" class="sidebar-settings-account-error" role="alert">{{ auth.actionError.value }}</div>
    <div v-if="auth.challenge.value" class="feature-panel native-authentication">
      <a :href="auth.challenge.value.url" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Open native sign-in page</a>
      <p v-if="auth.challenge.value.code">Device code <code>{{ auth.challenge.value.code }}</code></p>
      <button type="button" :disabled="busy" @click="auth.cancelLogin">Cancel native sign-in</button>
    </div>
    <div v-else-if="auth.status.value?.requiresOpenaiAuth && account === null" class="feature-panel native-authentication">
      <ComposerDropdown v-model="method" :options="[
        { value: 'chatgpt', label: 'ChatGPT browser sign-in' },
        { value: 'chatgptDeviceCode', label: 'ChatGPT device-code sign-in' },
      ]" placeholder="Native sign-in method" :disabled="busy || changeBlocked" />
      <label><input v-model="confirmed" type="checkbox" :disabled="busy || changeBlocked"> I confirm sign-in on this App Server.</label>
      <button type="button" :disabled="!confirmed || busy || changeBlocked" @click="auth.startLogin(method, () => !changeBlocked)">
        Start native sign-in
      </button>
    </div>
    <div v-else-if="account" class="sidebar-settings-account-login">
      <button class="sidebar-settings-account-login-button" type="button" :disabled="busy || changeBlocked" @click="auth.logout">
        Logout
      </button>
    </div>
    <AccountUsage :epoch="epoch" />
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
