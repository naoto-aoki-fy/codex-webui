<script setup lang="ts">
import {ref,watch,onUnmounted} from 'vue'
import type {ThreadDeletion} from '../../composables/threadDeletion'
import {nativeWriteError} from '../../api/nativeWriteOutcome'
const props=defineProps<{threadId:string;epoch:number;blocked:boolean;deletion:ThreadDeletion|null;ensureDeletion:()=>Promise<ThreadDeletion|null>;hasDraft:()=>boolean}>()
const error=ref('');let alive=true
onUnmounted(()=>{alive=false})
watch(()=>[props.threadId,props.epoch,props.deletion?.state.value],()=>{error.value=''})
async function prepare(){error.value='';if(props.hasDraft()){error.value='Save or clear the editable draft before preparing permanent deletion.';return}const id=props.threadId,epoch=props.epoch;try{const controller=await props.ensureDeletion();if(!alive||id!==props.threadId||epoch!==props.epoch||props.blocked||props.hasDraft())return;await controller?.prepare(id)}catch(e){if(alive&&id===props.threadId&&epoch===props.epoch)error.value=nativeWriteError(e)}}
</script>
<template><details class="feature-panel permanent-deletion"><summary>Permanent native conversation deletion</summary>
 <p role="status">Permanent deletion is unavailable: the native contract cannot atomically exclude descendants. This panel provides read-only inspection. Archive and restore remain available.</p>
 <button type="button" :disabled="blocked||deletion?.blocking.value||deletion?.state.value==='preparing'" @click="prepare">Inspect permanent deletion scope</button>
 <div v-if="deletion?.preview.value&&deletion.state.value==='prepared'&&deletion.thread.value===threadId">
  <p>Conversation: {{ deletion.preview.value.name }} · ID: <code>{{ threadId }}</code></p><p>App Server cwd: {{ deletion.preview.value.cwd }} · Fork origin: {{ deletion.preview.value.forkedFrom??'None supplied' }} · Checked: {{ deletion.preview.value.checkedAt }}</p>

 </div>
 <p v-if="deletion?.thread.value===threadId" role="status">{{ deletion.status.value }}</p><p v-if="error" role="alert">{{ error }}</p>
 <p v-if="deletion?.state.value==='unknown'&&deletion.thread.value===threadId">Inspect the original App Server and reload to reconcile. This uncertain write cannot be retried from these controls.</p>
</details></template>
