<script setup lang="ts">
import {ref,watch} from 'vue'
import ComposerDropdown from '../content/ComposerDropdown.vue'
import type {NativeAuthentication} from '../../composables/nativeAuthentication'
import type {LoginMethod} from '../../api/nativeAuthentication'
import {nativeWriteError} from '../../api/nativeWriteOutcome'
const props=defineProps<{auth:NativeAuthentication|null;ensureAuth:()=>Promise<NativeAuthentication|null>;blocked:boolean;recoveryRequired:boolean}>()
const open=ref(false),preparing=ref(false),method=ref<LoginMethod>('chatgpt'),confirmed=ref(false),unknownConfirmed=ref(false)
const error=ref('')
watch(()=>[props.auth?.state.value,method.value],()=>{confirmed.value=false;unknownConfirmed.value=false})
async function prepare(){if(preparing.value||props.blocked)return;preparing.value=true;error.value='';try{const auth=await props.ensureAuth();open.value=true;await auth?.prepare()}catch(e){error.value=nativeWriteError(e,'Native sign-in unavailable')}finally{preparing.value=false}}
</script>
<template>
 <details class="feature-panel native-authentication" :open="open" @toggle="open=($event.target as HTMLDetailsElement).open"><summary>Native Codex sign-in</summary>
  <p>Managed ChatGPT sign-in for a signed-out App Server default provider. Other credential/provider methods remain external. WebUI password authentication is separate.</p>
  <button type="button" :disabled="blocked||preparing||auth?.blocking.value||auth?.state.value==='preparing'" @click="prepare">Prepare native sign-in</button>
  <button v-if="!auth&&recoveryRequired" type="button" @click="ensureAuth()">Open native authentication recovery controls</button>
  <div v-if="auth?.preparation.value&&auth.state.value==='prepared'"><p>Connected App Server · Account: {{ auth.preparation.value.account.type }} · Loaded idle threads: {{ auth.preparation.value.loadedCount }} · Checked: {{ auth.preparation.value.checkedAt }}</p><p>Activity/account state is rechecked before starting. The native API provides no cross-client activity lock.</p>
   <ComposerDropdown v-model="method" :options="[{value:'chatgpt',label:'ChatGPT browser sign-in'},{value:'chatgptDeviceCode',label:'ChatGPT device-code sign-in'}]" placeholder="Native sign-in method" :disabled="blocked" />
   <p>Starting replaces any pending native login attempt. Tokens remain on the App Server; no OAuth client or local Codex process is created by WebUI.</p><label><input v-model="confirmed" type="checkbox" :disabled="blocked"> I confirm native sign-in on this App Server and replacement of any pending login attempt.</label>
   <button type="button" :disabled="!confirmed||blocked" @click="auth.start(method,confirmed)">Start confirmed native sign-in</button>
  </div>
  <div v-if="auth?.url.value"><a :href="auth.url.value" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Open native sign-in page</a><p v-if="auth.code.value">Native device code: <code v-text="auth.code.value"></code></p><p>Login URLs/codes are kept in memory. Native expiry is not supplied here; closing this panel does not guarantee cancellation.</p></div>
  <button v-if="auth?.active.value||auth?.loginId.value" type="button" :disabled="!auth.connected.value||auth.state.value==='canceling'||auth.state.value==='settling'" @click="auth.cancel">Cancel identified native sign-in</button>
  <p v-if="auth" role="status">{{ auth.status.value }}</p>
  <p v-if="error" role="alert">{{ error }}</p>
  <div v-if="auth?.needsRefresh.value||auth?.state.value==='unknown'"><button type="button" :disabled="!auth.connected.value||auth.inspecting.value||auth.resetting.value" @click="auth.inspect">Inspect current native account</button><p v-if="auth.account.value">Actual account: {{ auth.account.value.type }} {{ auth.account.value.email??'' }}</p>
   <label v-if="auth.state.value==='unknown'"><input v-model="unknownConfirmed" type="checkbox"> I inspected the account and understand the original login may still be pending; reconnect without replaying it.</label>
   <button type="button" :disabled="!auth.connected.value||!auth.account.value||auth.resetting.value||auth.state.value==='unknown'&&!unknownConfirmed" @click="auth.refreshConnection(unknownConfirmed)">Reconnect and reload account data</button>
  </div>
 </details>
</template>
