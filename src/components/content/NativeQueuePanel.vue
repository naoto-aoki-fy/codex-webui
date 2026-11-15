<script setup lang="ts">
import {ref,watch,computed} from 'vue'
import type {createNativeQueue} from '../../composables/nativeQueue'
const props=defineProps<{threadId:string;epoch:number;disconnected:boolean;inProgress:boolean;blocked:boolean;queue:ReturnType<typeof createNativeQueue>}>()
const editing=ref(''),draft=ref(''),confirmId=ref(''),confirmKind=ref<'delete'|'start'>('delete')
const error=ref('')
const disabled=computed(()=>!props.queue.available.value||props.queue.writing.value||props.blocked)
watch(()=>[props.threadId,props.epoch,props.queue.rows.value],()=>{editing.value='';draft.value='';confirmId.value='';error.value=''},{flush:'sync'})
async function run(kind:'update'|'delete'|'start'|'reorder',id:string,text?:string){const owner=props.threadId,epoch=props.epoch;error.value='';try{await props.queue.manage(kind,id,text)}catch(e){if(props.threadId===owner&&props.epoch===epoch)error.value=e instanceof Error?e.message:'Queue action unavailable'}}
</script>
<template>
 <details id="native-prompt-queue" class="feature-panel native-prompt-queue"><summary>Native deferred prompt queue</summary>
  <p>Thread: {{ threadId }}. Native persistence and ordering; this is separate from immediate steering. Queued input uses native settings when executed.</p>
  <button type="button" :disabled="queue.reading.value||disconnected" @click="queue.refresh()">Read native queue</button>
  <p v-if="queue.stale.value">Queue changed. Refresh before acting.</p><p v-if="queue.loaded.value&&!queue.rows.value.length">No pending prompts returned.</p>
  <p v-if="error" role="alert">{{ error }}</p>
  <p v-if="queue.operationThread.value===threadId" role="status">{{ queue.status.value }}</p><p v-if="queue.readError.value" role="alert">{{ queue.readError.value }}</p>
  <p v-if="queue.uncertain.value" role="alert">{{ queue.uncertain.value }}</p><button v-if="queue.uncertain.value" type="button" :disabled="!queue.loaded.value||queue.reading.value||queue.writing.value" @click="queue.acknowledgeUnknown">Acknowledge uncertain queue outcome after inspection</button>
  <ul><li v-for="(row,index) in queue.rows.value" :key="row.id"><p>{{ row.id }} · Client message: {{ row.clientId }}</p><p>Input types: {{ row.types.join(', ') }}</p><details><summary>Pending prompt preview (first 8,000 characters)</summary><pre v-text="row.preview"></pre></details>
   <button type="button" :disabled="disabled||row.text===null" @click="editing=row.id;draft=row.text??''">Edit queued {{ row.id }}</button>
   <button type="button" :disabled="disabled" @click="confirmId=row.id;confirmKind='delete'">Remove queued {{ row.id }}</button>
   <button type="button" :disabled="disabled||index===0||!!queue.cursor.value" @click="run('reorder',row.id)">Move up {{ row.id }}</button>
   <button type="button" :disabled="disabled||inProgress" @click="confirmId=row.id;confirmKind='start'">Start queued {{ row.id }}</button>
   <div v-if="editing===row.id"><textarea v-model="draft" aria-label="Queued prompt text" maxlength="32000"/><p>Edits the first plain-text input; other structured inputs are preserved. Concurrent native changes invalidate this snapshot.</p><button type="button" :disabled="disabled||!draft.trim()" @click="run('update',row.id,draft)">Save queued prompt</button><button type="button" @click="editing=''">Cancel queue edit</button></div>
   <div v-if="confirmId===row.id"><p>{{ confirmKind==='start'?'Start a model turn now using native thread settings?':'Remove this pending input from the native queue? Already executing work is unaffected.' }} Thread: {{ threadId }} · Entry: {{ row.id }}</p><button type="button" :disabled="disabled||confirmKind==='start'&&inProgress" @click="run(confirmKind,row.id);confirmId=''">Confirm {{ confirmKind==='start'?'start':'remove' }} queued {{ row.id }}</button><button type="button" @click="confirmId=''">Cancel queue action</button></div>
  </li></ul>
  <button v-if="queue.cursor.value" type="button" :disabled="queue.reading.value||queue.stale.value||disconnected||queue.rows.value.length>=100" @click="queue.refresh(true)">More queued prompts</button><p v-if="queue.rows.value.length>=100">First 100 queued prompts shown.</p>
 </details>
</template>
