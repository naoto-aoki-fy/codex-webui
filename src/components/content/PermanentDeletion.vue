<script setup lang="ts">
import {ref,watch,onUnmounted} from 'vue'
import type {ThreadDeletion} from '../../composables/threadDeletion'
import {nativeWriteError} from '../../api/nativeWriteOutcome'
const props=defineProps<{threadId:string;epoch:number;blocked:boolean;deletion:ThreadDeletion|null;ensureDeletion:()=>Promise<ThreadDeletion|null>;hasDraft:()=>boolean}>()
const typed=ref(''),confirmed=ref(false),error=ref('');let alive=true
onUnmounted(()=>{alive=false})
watch(()=>[props.threadId,props.epoch,props.deletion?.state.value],()=>{typed.value='';confirmed.value=false;error.value=''})
async function prepare(){error.value='';if(props.hasDraft()){error.value='Save or clear the editable draft before preparing permanent deletion.';return}try{await(await props.ensureDeletion())?.prepare()}catch(e){error.value=nativeWriteError(e)}}
function run(){if(props.hasDraft()){error.value='Save or clear the editable draft before deleting.';return}const id=props.threadId,epoch=props.epoch;void props.deletion?.run(typed.value,confirmed.value,()=>alive&&id===props.threadId&&epoch===props.epoch&&!props.blocked&&!props.hasDraft())}
</script>
<template><details class="feature-panel permanent-deletion"><summary>Permanent native conversation deletion</summary>
 <p>Irreversible native history deletion, separate from archiving. This limited workflow excludes imported conversations and conversations with listed child agents.</p>
 <button type="button" :disabled="blocked||deletion?.blocking.value||deletion?.state.value==='preparing'" @click="prepare">Inspect permanent deletion scope</button>
 <div v-if="deletion?.preview.value&&deletion.state.value==='prepared'&&deletion.thread.value===threadId">
  <p>Conversation: {{ deletion.preview.value.name }} · ID: <code>{{ threadId }}</code></p><p>App Server cwd: {{ deletion.preview.value.cwd }} · Fork origin: {{ deletion.preview.value.forkedFrom??'None supplied' }} · Checked: {{ deletion.preview.value.checkedAt }}</p>
  <p>Native deletion can stop work and delete owned child-agent conversations. Child lists and idle state are rechecked, but the API has no atomic preview lock: another client may start work or spawn children after these checks. Native Fork history references may reject deletion. Files in the project are not removed by this action.</p>
  <label>Type exact conversation ID<input v-model="typed" aria-label="Type exact conversation ID" maxlength="2000" autocomplete="off" :disabled="blocked"></label>
  <label><input v-model="confirmed" type="checkbox" :disabled="blocked"> I confirm permanent native history deletion and its possible owned-child consequences. There is no WebUI undo.</label>
  <button type="button" :disabled="blocked||typed!==threadId||!confirmed" @click="run">Permanently delete confirmed conversation</button>
 </div>
 <p v-if="deletion?.thread.value===threadId" role="status">{{ deletion.status.value }}</p><p v-if="error" role="alert">{{ error }}</p>
 <p v-if="deletion?.state.value==='unknown'&&deletion.thread.value===threadId">Inspect the original App Server and reload to reconcile. This uncertain write cannot be retried from these controls.</p>
</details></template>
