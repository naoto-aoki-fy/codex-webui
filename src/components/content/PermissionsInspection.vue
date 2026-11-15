<script setup lang="ts">
import {ref,watch} from 'vue'
import type {ThreadSecurity} from '../../api/threadSecurity'
import {readConfigRestrictions} from '../../api/configInspection'
import ComposerDropdown from './ComposerDropdown.vue'
import {readPermissionConfiguration,type PermissionChoices} from '../../api/threadPermissions'
import type {createThreadPermissions} from '../../composables/threadPermissions'
const props=defineProps<{threadId:string;epoch:number;disconnected:boolean;security:ThreadSecurity|null;blocked:boolean;changes:ReturnType<typeof createThreadPermissions>}>()
const busy=ref(false),error=ref(''),requirements=ref<Awaited<ReturnType<typeof readConfigRestrictions>>|undefined>(undefined)
const choices=ref<PermissionChoices|null>(null),approval=ref(''),sandbox=ref(''),confirmed=ref(false)
const approvalOptions=[{value:'',label:'Keep approval policy'},{value:'on-request',label:'On request'},{value:'never',label:'Never request approval'}]
const sandboxOptions=[{value:'',label:'Keep sandbox policy'},{value:'readOnly',label:'Read only · no network'},{value:'workspaceWrite',label:'Workspace write · no network or extra temp roots'},{value:'dangerFullAccess',label:'Full access · unrestricted filesystem and network'}]
let generation=0
watch(()=>[props.threadId,props.epoch],()=>{generation++;busy.value=false;error.value='';requirements.value=undefined;choices.value=null;confirmed.value=false;approval.value='';sandbox.value=''},{flush:'sync'})
watch(()=>[props.security,approval.value,sandbox.value],()=>{confirmed.value=false},{flush:'sync'})
async function read(){if(busy.value||props.disconnected)return;const token=++generation;busy.value=true;error.value='';requirements.value=undefined
 choices.value=null;confirmed.value=false;approval.value='';sandbox.value=''
 try{const value=await readPermissionConfiguration();if(token===generation){requirements.value=value.display;choices.value=value.choices}}catch(e){if(token===generation)error.value=e instanceof Error?e.message:'Restrictions unavailable'}finally{if(token===generation)busy.value=false}}
async function apply(){if(!confirmed.value||props.blocked||busy.value||props.disconnected)return;const id=props.threadId,epoch=props.epoch;try{await props.changes.run(approval.value,sandbox.value,choices.value)}catch(e){if(id===props.threadId&&epoch===props.epoch)error.value=e instanceof Error?e.message:'Permission change unavailable'}finally{if(id===props.threadId&&epoch===props.epoch)confirmed.value=false}}
</script>
<template>
 <details class="feature-panel permissions-inspection"><summary>Permissions inspection</summary>
  <p>Thread: {{ threadId }}. Observed from its normal native resume or settings event; no additional resume is performed.</p>
  <p v-if="!security">Effective thread permissions: Unknown. No settings snapshot has been observed on this connection.</p>
  <div v-else><p>Observed: {{ security.observed }} · Remote cwd: {{ security.cwd }}</p><p>Approval policy: {{ security.approval }} · Reviewer: {{ security.reviewer }}</p><details><summary>Sandbox restrictions and writable scope</summary><pre v-text="security.sandbox"></pre></details><details><summary>Active permission profile</summary><pre v-text="security.profile"></pre></details></div>
  <button type="button" :disabled="busy||disconnected" @click="read">Read permission restrictions</button>
  <p v-if="requirements===undefined">Managed restrictions: Unknown.</p><p v-else-if="requirements===null">No managed requirements returned.</p><pre v-else v-text="JSON.stringify(requirements,null,2)"></pre>
  <p v-if="error" role="alert">{{ error }}</p>
  <div v-if="choices&&security"><p>Explicit thread-only changes for subsequent turns. Managed restrictions are enforced by the App Server. No global defaults or other threads are changed.</p>
   <ComposerDropdown v-model="approval" :options="approvalOptions.filter(v=>!v.value||choices?.approvals.includes(v.value))" placeholder="Approval policy" :disabled="blocked||changes.busy.value||disconnected" />
   <ComposerDropdown v-model="sandbox" :options="sandboxOptions.filter(v=>!v.value||choices?.sandboxes.includes(v.value))" placeholder="Sandbox policy" :disabled="blocked||changes.busy.value||disconnected" />
   <p>Workspace write uses the native execution cwd, no additional writable roots, no network and no implicit temporary roots. Full access grants filesystem and network access. Named managed profiles and custom roots are not edited here.</p>
   <label><input v-model="confirmed" type="checkbox" :disabled="blocked||changes.busy.value||disconnected"> I confirm this thread's permission changes, including any broader access or reduced approval oversight.</label>
   <button type="button" :disabled="!confirmed||!approval&&!sandbox||blocked||changes.busy.value||disconnected||changes.state.value==='unknown'" @click="apply">Apply confirmed thread permissions</button>
  </div><p v-else>Permission editing requires observed native settings and known managed constraints.</p>
  <p v-if="changes.thread.value===threadId" role="status">{{ changes.status.value }}</p><button v-if="changes.canReconcile.value" type="button" :disabled="disconnected" @click="changes.reconcile">Reconcile fresh observed permissions</button>
  <p v-if="changes.state.value==='unknown'&&changes.thread.value!==threadId">Permission changes await reconciliation in thread <a :href="`#/thread/${encodeURIComponent(changes.thread.value)}`">{{ changes.thread.value }}</a>.</p>
 </details>
</template>
