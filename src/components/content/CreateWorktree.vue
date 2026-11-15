<script setup lang="ts">
import {ref,watch,onBeforeUnmount} from 'vue'
import {rpcCall} from '../../api/codexRpcClient'
import {planWorktree,createRemoteWorktree,verifyCreatedWorktree,WorktreeOutcomeError,type WorktreePlan} from '../../api/createWorktree'
const props=defineProps<{cwd:string;epoch:number;blocked:boolean;openProject:(path:string)=>Promise<void>}>()
const destination=ref(''),branch=ref(''),plan=ref<WorktreePlan|null>(null),busy=ref(false),confirmed=ref(false),status=ref(''),created=ref(''),unknown=ref(false)
let generation=0
onBeforeUnmount(()=>{generation++})
function scopedRequest(token:number){const cwd=props.cwd,epoch=props.epoch;return (method:string,params:unknown)=>{if(token!==generation||cwd!==props.cwd||epoch!==props.epoch||props.blocked)throw new Error('Connection/project changed or conflicting work started; no further request was sent');return rpcCall(method,params)}}
watch(()=>[props.cwd,props.epoch],()=>{generation++;plan.value=null;confirmed.value=false;created.value='';status.value=busy.value?'Connection/project changed during the operation. Outcome may be unknown; inspect the original App Server.':'';busy.value=false;unknown.value=false},{flush:'sync'})
watch([destination,branch],()=>{if(!busy.value&&!unknown.value){plan.value=null;confirmed.value=false;created.value='';status.value=''}},{flush:'sync'})
async function preview(){if(busy.value||props.blocked||unknown.value)return;const token=++generation;busy.value=true;status.value='';confirmed.value=false;plan.value=null;created.value=''
 try{const value=await planWorktree(props.cwd,destination.value,branch.value,scopedRequest(token));if(token===generation)plan.value=value}catch(e){if(token===generation)status.value=e instanceof Error?e.message:'Worktree preview unavailable'}finally{if(token===generation)busy.value=false}}
async function create(){if(busy.value||props.blocked||!plan.value||!confirmed.value||unknown.value)return;const token=++generation,p=plan.value;busy.value=true;status.value='Requesting remote worktree creation…'
 try{const path=await createRemoteWorktree(p,scopedRequest(token));if(token===generation){created.value=path;status.value='Completed: native Git path, new branch and commit verified.';confirmed.value=false}}
 catch(e){if(token===generation){unknown.value=e instanceof WorktreeOutcomeError&&e.submitted;status.value=(unknown.value?'Failed or partial/unknown creation. Inspect path and branch before any further action. ':'Rejected before creation. ')+(e instanceof Error?e.message:'Request failed')}}finally{if(token===generation)busy.value=false}}
async function reconcile(){if(busy.value||props.blocked||!plan.value)return;const token=++generation;busy.value=true
 try{const path=await verifyCreatedWorktree(plan.value,scopedRequest(token));if(token===generation){created.value=path;unknown.value=false;status.value='Completed: exact native worktree reconciled.'}}
 catch(e){if(token===generation)status.value=e instanceof Error?e.message:'Reconciliation unavailable'}finally{if(token===generation)busy.value=false}}
async function open(){if(busy.value||props.blocked||!created.value)return;const token=++generation;busy.value=true;try{await props.openProject(created.value)}catch(e){if(token===generation)status.value=e instanceof Error?e.message:'Project registration failed; worktree remains intact'}finally{if(token===generation)busy.value=false}}
</script>
<template>
 <details class="feature-panel create-worktree"><summary>Create remote Git worktree</summary>
  <p>Connected App Server · Remote source: {{ cwd }}. POSIX paths only. Creates a new branch at HEAD in a separate directory; existing conversation and dirty source files stay in place.</p>
  <label>Destination <input v-model="destination" aria-label="Worktree destination" maxlength="2000" placeholder="/remote/project-worktree" :disabled="busy||unknown||!!created"></label><label>New branch <input v-model="branch" aria-label="Worktree new branch" maxlength="100" :disabled="busy||unknown||!!created"></label>
  <button type="button" :disabled="busy||blocked||unknown" @click="preview">Preview worktree creation</button>
  <div v-if="plan"><p>Repository: {{ plan.root }} · Commit: {{ plan.head }} · New branch: {{ plan.branch }} · Destination: {{ plan.destination }}</p><p>Native Git writes a branch/worktree using App Server command permissions. Git Hooks are disabled for creation. No reset, overwrite, fetch, push or automatic cleanup.</p><label v-if="!created"><input v-model="confirmed" type="checkbox" :disabled="busy||unknown"> I confirm this remote repository, new branch and destination.</label><button v-if="!created" type="button" :disabled="busy||blocked||!confirmed||unknown" @click="create">Create confirmed worktree</button></div>
  <p v-if="status" role="status">{{ status }}</p><button v-if="unknown" type="button" :disabled="busy||blocked" @click="reconcile">Reconcile exact worktree</button>
  <button v-if="created" type="button" :disabled="busy||blocked" @click="open">Set up a new conversation in {{ created }}</button><p v-if="created">Uses existing native project registration. No prompt is sent and no existing conversation is moved.</p>
 </details>
</template>
