<script setup lang="ts">
import {ref,watch,onUnmounted} from 'vue'
import ComposerDropdown from './ComposerDropdown.vue'
import type {ShellAccess} from '../../api/nativeShell'
import type {NativeShell} from '../../composables/nativeShell'
import {nativeWriteError} from '../../api/nativeWriteOutcome'
const props=defineProps<{threadId:string;epoch:number;blocked:boolean;shell:NativeShell|null;ensureShell:()=>Promise<NativeShell|null>}>()
const text=ref(''),confirmed=ref(false),error=ref(''),access=ref<ShellAccess>('readOnly'),typedCwd=ref('');let alive=true
onUnmounted(()=>{alive=false})
watch(()=>[props.threadId,props.epoch,props.shell?.state.value],()=>{confirmed.value=false;typedCwd.value='';error.value='';if(props.shell?.state.value==='prepared')access.value='readOnly';if(props.threadId!==props.shell?.thread.value)text.value=''} )
watch([text,access,typedCwd],()=>confirmed.value=false,{flush:'sync'})
async function inspect(){const id=props.threadId,epoch=props.epoch;try{const shell=await props.ensureShell();if(alive&&id===props.threadId&&epoch===props.epoch&&!props.blocked)await shell?.inspect(id)}catch(e){if(alive)error.value=nativeWriteError(e)}}
function run(){const id=props.threadId,epoch=props.epoch;void props.shell?.run(text.value,confirmed.value,()=>alive&&id===props.threadId&&epoch===props.epoch&&!props.blocked,access.value,typedCwd.value)}
</script>
<template><details class="feature-panel native-shell"><summary>Standalone native command</summary>
 <p>Runs a deliberate command in the connected App Server's local POSIX shell, separate from chat and model turns. No WebUI-host execution, PTY, stdin session or prompt is used. Read-only is the default. Results are not saved in conversation history and clear on subsequent selection/connection changes. Navigation does not terminate a running command.</p>
 <button type="button" :disabled="blocked||shell?.blocking.value||shell?.state.value==='inspecting'" @click="inspect">Inspect native command context</button>
 <div v-if="shell?.context.value&&shell.thread.value===threadId&&shell.sameConnection.value"><p>Target: connected App Server local environment · Cwd: {{ shell.context.value.cwd }} · Shell: {{ shell.context.value.path }} ({{ shell.context.value.shell }}) · Checked: {{ shell.context.value.checkedAt }}</p>
  <p>Requested process policy: {{ (shell.state.value==='prepared'?access:shell.policyUsed.value)==='dangerFullAccess'?'Full access under the App Server user, subject to managed/OS restrictions':'Read-only filesystem, network disabled' }}. 30-second timeout, 64 KiB capture per stream. Native managed restrictions and platform sandbox availability are enforced by the server. This is independent of the thread's sandbox/approval policy and sends no approval request. Another client can change activity after the idle check.</p>
  <div v-if="shell.state.value==='prepared'"><ComposerDropdown v-model="access" :options="[{value:'readOnly',label:'Read-only · no network'},...(shell.context.value.allowFullAccess?[{value:'dangerFullAccess',label:'Full access request · App Server filesystem/network'}]:[])]" placeholder="Native command permissions" :disabled="blocked" />
  <p v-if="!shell.context.value.allowFullAccess">Broader permissions are unavailable or managed policy is unknown.</p>
  <div v-if="access==='dangerFullAccess'"><p>Full access can modify or delete any resource accessible to the App Server user and use its network. Changes may be irreversible. Timeout/termination does not roll back effects. No thread/global permission default is changed.</p><label>Type exact App Server cwd<input v-model="typedCwd" aria-label="Type exact App Server cwd" maxlength="4000" :disabled="blocked"></label></div>
  <label>Command<textarea v-model="text" aria-label="Standalone native shell command" maxlength="8000" :disabled="blocked" placeholder="pwd" /></label>
  <label><input v-model="confirmed" type="checkbox" :disabled="blocked"> I confirm this command, local App Server target, cwd and selected permissions.</label><button type="button" :disabled="blocked||!confirmed||!text.trim()||access==='dangerFullAccess'&&typedCwd!==shell.context.value.cwd" @click="run">Execute confirmed native command</button></div>
 </div>
 <div v-if="shell?.thread.value===threadId&&shell.sameConnection.value"><pre v-if="shell.commandPreview.value" v-text="shell.commandPreview.value"/><p role="status">{{ shell.status.value }}</p><p v-if="shell.processId.value">Native process ID: {{ shell.processId.value }}</p><button v-if="shell.running.value&&shell.processId.value" type="button" :disabled="shell.terminating.value" @click="shell.terminate">Terminate this standalone native process</button>
 <div v-if="shell.output.value"><p>Exit code: {{ shell.output.value.exitCode }} · Output previews are redacted and limited to 12,000 characters per stream.</p><details><summary>Native stdout preview</summary><pre v-text="shell.output.value.stdout||'(empty stdout)'" /></details><details><summary>Native stderr preview</summary><pre v-text="shell.output.value.stderr||'(empty stderr)'" /></details><p v-if="shell.output.value.bounded">Output reached a capture or display bound; this is not the complete output.</p></div>
 <p v-if="shell.state.value==='unknown'">Inspect the original App Server externally, then reload to reset these local controls. No native process-status getter is available and no completion is inferred.</p></div>
 <p v-else-if="shell?.blocking.value&&shell.sameConnection.value">A standalone command awaits completion or inspection in <a :href="`#/thread/${encodeURIComponent(shell.thread.value)}`">{{ shell.thread.value }}</a>.</p><p v-if="shell?.state.value==='unknown'&&!shell.sameConnection.value">Original-connection command outcome unknown. Inspect that App Server externally; reload these controls for the replacement connection. No cross-connection action or link is used.</p><p v-if="error" role="alert">{{ error }}</p>
</details></template>
