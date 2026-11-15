<script setup lang="ts">
import {ref,watch,onBeforeUnmount} from 'vue'
import {readHooks} from '../../api/hooksInspection'
import {readHookPolicy,saveHookPolicy,HookPolicyError,type HookPolicySnapshot} from '../../api/hookPolicy'
import {rpcCall} from '../../api/codexRpcClient'
import type {InspectedHook} from '../../api/hooksInspection'
import {nativeWriteRejected,nativeWriteError} from '../../api/nativeWriteOutcome'
const props=defineProps<{threadId:string;epoch:number;disconnected:boolean;blocked:boolean}>()
const busy=ref(false),error=ref(''),data=ref<Awaited<ReturnType<typeof readHooks>>|null>(null)
let generation=0
const policy=ref<HookPolicySnapshot|null>(null),selected=ref<InspectedHook|null>(null),action=ref<'enable'|'disable'|'trust'>('disable'),confirmed=ref(false),status=ref(''),unknown=ref(false),writing=ref(false)
onBeforeUnmount(()=>{generation++})
watch(()=>[props.threadId,props.epoch],()=>{generation++;if(writing.value){unknown.value=true;status.value='Connection/thread changed; Hook policy outcome may be unknown on the original App Server.'}busy.value=false;writing.value=false;error.value='';data.value=null;policy.value=null;selected.value=null;confirmed.value=false},{flush:'sync'})
function scopedRequest(token:number){const id=props.threadId,epoch=props.epoch;return (method:string,params:unknown,options?:{configWriteErrors?:boolean})=>{if(token!==generation||id!==props.threadId||epoch!==props.epoch||props.disconnected||method==='config/value/write'&&props.blocked)throw new Error('Connection/thread changed or conflicting work started; no further request sent');return rpcCall(method,params,options)}}
async function read(){if(busy.value||props.disconnected)return;const token=++generation;busy.value=true;error.value='';data.value=null;policy.value=null;selected.value=null;confirmed.value=false
 try{const result=await readHooks(props.threadId);if(token===generation)data.value=result}
 catch(e){if(token===generation)error.value=nativeWriteError(e,'Hooks unavailable')}finally{if(token===generation)busy.value=false}}
async function readSaved(){if(busy.value||props.disconnected||!data.value)return;const token=++generation;busy.value=true;error.value='';confirmed.value=false
 try{const value=await readHookPolicy(data.value.groups.flatMap(g=>g.hooks),scopedRequest(token));if(token===generation)policy.value=value}catch(e){if(token===generation)error.value=nativeWriteError(e,'Saved Hook policy unavailable')}finally{if(token===generation)busy.value=false}}
function prepare(hook:InspectedHook,kind:'enable'|'disable'|'trust'){selected.value=hook;action.value=kind;confirmed.value=false}
async function save(){if(busy.value||props.disconnected||props.blocked||!confirmed.value||!policy.value||!selected.value||unknown.value)return;const token=++generation;busy.value=true;writing.value=true;error.value='';confirmed.value=false;status.value='Requesting native Hook policy write…'
 try{await saveHookPolicy(props.threadId,policy.value,selected.value,action.value,scopedRequest(token));if(token===generation){policy.value=null;status.value='Saved Hook policy verified. Loaded-thread enabled/trust state is still the observed snapshot; no reload or Hook execution was requested.';selected.value=null}}
 catch(e){if(token===generation){unknown.value=e instanceof HookPolicyError?e.submitted:!nativeWriteRejected(e);status.value=`Hook policy ${unknown.value?'outcome unknown':'rejected before confirmation of saving'}. ${nativeWriteError(e)} No retry performed.`;policy.value=null}}
 finally{if(token===generation){busy.value=false;writing.value=false}}}
</script>
<template>
 <details class="feature-panel hooks-inspection"><summary>Hooks inspection</summary>
  <p>Loaded thread: {{ threadId }}. Inspection does not execute Hooks or change trust.</p>
  <button type="button" :disabled="busy||disconnected" @click="read">Read Hooks</button>
  <button v-if="data" type="button" :disabled="busy||disconnected" @click="readSaved">Read saved Hook policies</button>
  <p v-if="policy">Policy file: {{ policy.target.filePath }} · Profile: {{ policy.target.profile??'Base user' }} · Version: {{ policy.target.version }}. Overrides affect future native loads using this file; current loaded threads can differ. No automatic reload is performed.</p>
  <p v-if="data&&!data.groups.length">No Hook scopes returned.</p>
  <div v-for="(group,index) in data?.groups" :key="index"><p>Remote scope: {{ group.cwd }}</p>
   <p v-if="!group.hooks.length">No Hooks returned for this scope.</p>
   <ul><li v-for="(hook,i) in group.hooks" :key="i"><p>{{ hook.event }} · {{ hook.key }}</p>
    <p>Enabled: {{ hook.enabled===null?'Unknown':hook.enabled?'Yes':'No' }} · Managed: {{ hook.managed===null?'Unknown':hook.managed?'Yes':'No' }} · Trust: {{ hook.trust }}</p>
    <details><summary>Hook definition and origin</summary><pre v-text="hook.definition"></pre><pre v-text="hook.origin"></pre><p>Current hash: {{ hook.hash }}</p></details>
    <div v-if="policy&&hook.editable"><p>Saved enabled override: {{ policy.states[hook.editable.key]?.enabled??'Inherited / unset' }} · Saved trust hash: {{ policy.states[hook.editable.key]?.trustedHash??'Inherited / unset' }}</p><button type="button" :disabled="busy||blocked||unknown" @click="prepare(hook,'enable')">Prepare enabled Hook policy</button><button type="button" :disabled="busy||blocked||unknown" @click="prepare(hook,'disable')">Prepare disabled Hook policy</button><button type="button" :disabled="busy||blocked||unknown" @click="prepare(hook,'trust')">Review Hook definition trust</button></div>
   </li></ul>
   <p v-for="(warning,i) in group.warnings" :key="'w'+i">{{ warning }}</p>
   <p v-for="(issue,i) in group.errors" :key="'e'+i" role="alert">{{ issue }}</p>
  </div><p v-if="data?.truncated">Display limited to 100 Hooks.</p>
  <p v-if="error" role="alert">{{ error }}</p>
  <div v-if="selected&&policy"><p>Action: {{ action }} · Native Hook: {{ selected.key }} · Definition hash: {{ selected.hash }} · File: {{ policy.target.filePath }}</p><pre v-text="selected.definition"></pre><pre v-text="selected.origin"></pre><p>Trust approves this native definition for future loads. It can execute with the Hook's native permissions. Managed/plugin Hooks and trust revocation are outside this limited policy editor.</p><label><input v-model="confirmed" type="checkbox" :disabled="busy||blocked||unknown"> I reviewed this Hook definition, origin, exact hash and affected configuration scope.</label><button type="button" :disabled="!confirmed||busy||blocked||unknown||disconnected" @click="save">Save confirmed Hook policy</button><button type="button" @click="selected=null;confirmed=false">Cancel Hook policy edit</button></div>
  <p v-if="status" role="status">{{ status }}</p><button v-if="unknown" type="button" :disabled="busy||!policy" @click="unknown=false;selected=null;confirmed=false;status='Unknown Hook policy outcome acknowledged after reading saved native state.'">Acknowledge inspected Hook policy outcome</button>
 </details>
</template>
