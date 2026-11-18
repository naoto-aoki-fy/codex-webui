<script setup lang="ts">
import {ref,watch} from 'vue'
import {listBackgroundTerminals,terminateBackgroundTerminal,type BackgroundTerminal} from '../../api/backgroundTerminals'
import type {UiMessage} from '../../types/codex'
const props=defineProps<{threadId:string;epoch:number;messages:UiMessage[];disconnected:boolean}>()
const rows=ref<BackgroundTerminal[]|null>(null),cursor=ref<string|null>(null),busy=ref(false),status=ref(''),stamp=ref(''),confirmId=ref('')
let generation=0,terminating=false
watch(()=>[props.threadId,props.epoch],()=>{generation++;rows.value=null;cursor.value=null;busy.value=false;status.value=terminating?'Connection changed during termination; outcome unknown. Refresh before another action.':'';terminating=false;stamp.value='';confirmId.value=''}, {flush:'sync'})
async function refresh(more=false){
 if(busy.value||props.disconnected)return
 const token=++generation;busy.value=true;status.value='';confirmId.value=''
 if(!more){rows.value=null;cursor.value=null}
 try{const page=await listBackgroundTerminals(props.threadId,more?cursor.value:null);if(token!==generation)return
  if(more&&page.nextCursor&&page.nextCursor===cursor.value)throw new Error('Terminal cursor did not advance')
  const merged=[...new Map([...(rows.value||[]),...page.data].map(row=>[row.processId,row])).values()]
  if(merged.length>200)throw new Error('Terminal view limited to 200 processes. Refresh to inspect current state.')
  rows.value=merged;cursor.value=page.nextCursor;stamp.value=new Date().toISOString()
 }catch(e){if(token===generation)status.value=e instanceof Error?e.message:'Terminal list unavailable'}
 finally{if(token===generation)busy.value=false}
}
async function terminate(row:BackgroundTerminal){
 if(busy.value||props.disconnected||confirmId.value!==row.processId)return
 const token=++generation;busy.value=true;confirmId.value='';terminating=true
 try{const terminated=await terminateBackgroundTerminal(props.threadId,row.processId);if(token!==generation)return
  rows.value=rows.value?.filter(item=>item.processId!==row.processId)??null
  status.value=terminated?'Process termination acknowledged. Refresh to inspect current processes.':'Process already exited or is no longer manageable. Refresh the list.'
 }catch(e){if(token===generation){rows.value=null;cursor.value=null;status.value='Termination failed or outcome unknown; refresh before retrying. '+(e instanceof Error?e.message:'')}}
 finally{if(token===generation){busy.value=false;terminating=false}}
}
function output(row:BackgroundTerminal){const message=props.messages.find(message=>message.id===row.itemId&&message.commandExecution);return message?.commandExecution?(message.commandExecution.aggregatedOutput.slice(-6000)||'No output captured in loaded history.'):'Recent output unavailable in loaded history.'}
</script>
<template>
 <details class="feature-panel background-terminals">
  <summary>Background processes</summary>
  <p>Native thread {{ threadId }}. Terminating a process does not interrupt the model turn.</p>
  <button type="button" :disabled="busy || disconnected" @click="refresh(false)">Refresh background processes</button>
  <p v-if="stamp">Snapshot: {{ stamp }}</p><p v-if="status" role="status">{{ status }}</p>
  <p v-if="rows?.length===0">No background processes returned.</p>
  <ul v-if="rows"><li v-for="row in rows" :key="row.processId">
   <strong>{{ row.processId }}</strong> · {{ row.command }} · {{ row.cwd }} · Listed as running at snapshot
   <details><summary>Recent captured output · {{ row.processId }}</summary><pre v-text="output(row)"></pre></details>
   <button type="button" :disabled="busy || disconnected" @click="confirmId=row.processId">Terminate process {{ row.processId }}</button>
   <div v-if="confirmId===row.processId"><p>Terminate this exact native background process?</p><button type="button" :disabled="busy" @click="terminate(row)">Confirm termination {{ row.processId }}</button><button type="button" @click="confirmId=''">Cancel termination</button></div>
  </li></ul>
  <button v-if="cursor" type="button" :disabled="busy || disconnected" @click="refresh(true)">Load more background processes</button>
 </details>
</template>
