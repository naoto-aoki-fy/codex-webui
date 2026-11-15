<script setup lang="ts">
import {ref,watch} from 'vue'
import {readMemoryStatus,readThreadMemory} from '../../api/memoryStatus'
const props=defineProps<{threadId:string;epoch:number;disconnected:boolean}>()
const busy=ref(false),readiness=ref<{ready:boolean;count:number}|null>(null),summary=ref<string|null|undefined>(undefined),error=ref('')
let generation=0
watch(()=>[props.threadId,props.epoch],()=>{generation++;busy.value=false;readiness.value=null;summary.value=undefined;error.value=''}, {flush:'sync'})
async function refresh(){
 if(busy.value||props.disconnected)return
 const token=++generation;busy.value=true;readiness.value=null;summary.value=undefined;error.value=''
 const results=await Promise.allSettled([readMemoryStatus(),readThreadMemory(props.threadId)])
 if(token!==generation)return
 if(results[0].status==='fulfilled')readiness.value=results[0].value
 if(results[1].status==='fulfilled')summary.value=results[1].value
 error.value=results.filter(r=>r.status==='rejected').map(r=>r.status==='rejected'?(r.reason instanceof Error?r.reason.message:'Memory state unavailable'):'').join('\n').slice(0,2000)
 busy.value=false
}
</script>
<template>
 <details class="feature-panel memory-status">
  <summary>Memory status</summary>
  <button type="button" :disabled="busy || disconnected" @click="refresh">Read memory status</button>
  <p>Thread: {{ threadId }}. Readiness is server-wide; the summary is selected by this loaded thread.</p>
  <p v-if="readiness">V2 readiness: {{ readiness.ready?'Ready':'Not ready' }} · Consolidated threads: {{ readiness.count }}</p>
  <p v-else>Memory readiness: Unknown</p>
  <p>Contribution to future memory generation: Unknown. This runtime provides a setter but no effective-mode read in thread settings; no preference is changed here.</p>
  <p v-if="summary===null">Selected summary unavailable: memory use may be disabled, or its summary missing, unreadable or blank.</p>
  <details v-else-if="summary!==undefined"><summary>Selected thread memory summary (first 8,000 characters)</summary><pre v-text="summary"></pre></details>
  <p v-if="error" role="alert">{{ error }}</p>
 </details>
</template>
