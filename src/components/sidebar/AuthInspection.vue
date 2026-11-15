<script setup lang="ts">
import {nativeWriteError} from '../../api/nativeWriteOutcome'
import {ref,watch} from 'vue'
import {readNativeAccount,readLoginMethods} from '../../api/authInspection'
const props=defineProps<{epoch:number}>()
const busy=ref(false),error=ref(''),account=ref<Awaited<ReturnType<typeof readNativeAccount>>|null>(null),methods=ref<string[]|null>(null)
let generation=0
watch(()=>props.epoch,()=>{generation++;busy.value=false;error.value='';account.value=null;methods.value=null},{flush:'sync'})
async function read(){if(busy.value)return;const token=++generation;busy.value=true;error.value='';account.value=null;methods.value=null
 const result=await Promise.allSettled([readNativeAccount(),readLoginMethods()]);if(token!==generation)return
 if(result[0].status==='fulfilled')account.value=result[0].value
 if(result[1].status==='fulfilled')methods.value=result[1].value
 error.value=result.filter(r=>r.status==='rejected').map(r=>r.status==='rejected'?(nativeWriteError(r.reason,'Authentication state unavailable')):'').join('\n').slice(0,2000);busy.value=false}
</script>
<template>
 <details class="feature-panel auth-inspection"><summary>Native authentication details</summary>
  <button type="button" :disabled="busy" @click="read">Read authentication details</button>
  <p v-if="!account">Account: Unknown.</p><div v-else><p>Native account: {{ account.type==='signedOut'?'Signed out':account.type }} · Authentication required: {{ account.requiresAuth?'Yes':'No' }}</p><p v-if="account.email">{{ account.email }}</p><p v-if="account.plan">Plan: {{ account.plan }}</p><p v-if="account.workspace">Workspace: {{ account.workspace }}</p></div>
  <p v-if="methods===null">Allowed login methods: Unknown / unavailable.</p><p v-else-if="!methods.length">No login method allowed by current server policy.</p><p v-else>Allowed native login methods: {{ methods.join(', ') }}</p>
  <p v-if="methods?.includes('chatgpt')">Native ChatGPT workflows: browser login and device code. External-token ownership or account policy can further restrict initiation.</p>
  <p>Credentials remain owned by the connected App Server. WebUI password authentication is separate.</p>
  <p v-if="error" role="alert">{{ error }}</p>
 </details>
</template>
