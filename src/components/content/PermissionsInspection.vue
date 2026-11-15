<script setup lang="ts">
import {ref,watch} from 'vue'
import type {ThreadSecurity} from '../../api/threadSecurity'
import {readConfigRestrictions} from '../../api/configInspection'
const props=defineProps<{threadId:string;epoch:number;disconnected:boolean;security:ThreadSecurity|null}>()
const busy=ref(false),error=ref(''),requirements=ref<Awaited<ReturnType<typeof readConfigRestrictions>>|undefined>(undefined)
let generation=0
watch(()=>[props.threadId,props.epoch],()=>{generation++;busy.value=false;error.value='';requirements.value=undefined},{flush:'sync'})
async function read(){if(busy.value||props.disconnected)return;const token=++generation;busy.value=true;error.value='';requirements.value=undefined
 try{const value=await readConfigRestrictions();if(token===generation)requirements.value=value}catch(e){if(token===generation)error.value=e instanceof Error?e.message:'Restrictions unavailable'}finally{if(token===generation)busy.value=false}}
</script>
<template>
 <details class="feature-panel permissions-inspection"><summary>Permissions inspection</summary>
  <p>Thread: {{ threadId }}. Observed from its normal native resume or settings event; no additional resume is performed.</p>
  <p v-if="!security">Effective thread permissions: Unknown. No settings snapshot has been observed on this connection.</p>
  <div v-else><p>Observed: {{ security.observed }} · Remote cwd: {{ security.cwd }}</p><p>Approval policy: {{ security.approval }} · Reviewer: {{ security.reviewer }}</p><details><summary>Sandbox restrictions and writable scope</summary><pre v-text="security.sandbox"></pre></details><details><summary>Active permission profile</summary><pre v-text="security.profile"></pre></details></div>
  <button type="button" :disabled="busy||disconnected" @click="read">Read permission restrictions</button>
  <p v-if="requirements===undefined">Managed restrictions: Unknown.</p><p v-else-if="requirements===null">No managed requirements returned.</p><pre v-else v-text="JSON.stringify(requirements,null,2)"></pre>
  <p v-if="error" role="alert">{{ error }}</p>
 </details>
</template>
