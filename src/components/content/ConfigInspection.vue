<script setup lang="ts">
import {ref,watch,onBeforeUnmount} from 'vue'
import {readConfiguration,readConfigRestrictions} from '../../api/configInspection'
import ComposerDropdown from './ComposerDropdown.vue'
import {saveUserModelDefault} from '../../api/userConfigDefaults'
import {nativeWriteRejected,nativeWriteError} from '../../api/nativeWriteOutcome'
const props=defineProps<{cwd:string;epoch:number;disconnected:boolean;blocked:boolean}>()
const busy=ref(false),error=ref(''),data=ref<Awaited<ReturnType<typeof readConfiguration>>|null>(null),requirements=ref<Awaited<ReturnType<typeof readConfigRestrictions>>|undefined>(undefined)
let generation=0
onBeforeUnmount(()=>{generation++})
const field=ref('model'),value=ref(''),confirmed=ref(false),writing=ref(false),status=ref(''),unknown=ref(false)
watch(()=>[props.cwd,props.epoch],()=>{generation++;busy.value=false;error.value='';data.value=null;requirements.value=undefined;confirmed.value=false;if(writing.value){status.value='Connection/project changed during configuration write; outcome unknown. Inspect the original App Server.';unknown.value=true}writing.value=false},{flush:'sync'})
watch([field,value],()=>{confirmed.value=false},{flush:'sync'})
async function read(){if(busy.value||writing.value||props.disconnected||!props.cwd)return;const token=++generation;busy.value=true;error.value='';data.value=null;requirements.value=undefined;confirmed.value=false
 const results=await Promise.allSettled([readConfiguration(props.cwd),readConfigRestrictions()]);if(token!==generation)return
 if(results[0].status==='fulfilled')data.value=results[0].value
 if(results[1].status==='fulfilled')requirements.value=results[1].value
 error.value=results.filter(r=>r.status==='rejected').map(r=>r.status==='rejected'?String(nativeWriteError(r.reason,'Configuration unavailable')):'').join('\n').slice(0,2000);busy.value=false}
async function save(){if(writing.value||busy.value||props.blocked||props.disconnected||!confirmed.value||unknown.value||!data.value?.userTarget)return;const token=++generation,target={...data.value.userTarget},key=field.value as 'model'|'model_reasoning_effort',next=value.value;writing.value=true;status.value='Requesting targeted native configuration write…';confirmed.value=false
 try{const ack=await saveUserModelDefault(target,key,next);if(token!==generation)return;status.value=`Saved acknowledged${ack.overridden?' (overridden by another layer)':''}; checking the saved layer and effective project view.`
  const fresh=await readConfiguration(props.cwd);if(token!==generation)return;data.value=fresh
  const saved=fresh.userTarget
  if(!saved||saved.filePath!==target.filePath||(key==='model'?saved.model:saved.effort)!==next)throw new Error('Saved-layer value not confirmed. Inspect native configuration before another write')
  status.value='Completed: saved user-layer value verified. Effective project settings and existing thread overrides may differ; no conversation was changed.'
 }catch(e){if(token===generation){unknown.value=!nativeWriteRejected(e);status.value=`Configuration write ${unknown.value?'outcome unknown':'rejected'}. Read current configuration before another explicit action. ${nativeWriteError(e)}`;data.value=null}}
 finally{if(token===generation)writing.value=false}}
</script>
<template>
 <details class="feature-panel config-inspection"><summary>Configuration inspection</summary>
  <p>Remote project: {{ cwd }}. Selected public settings only; thread overrides can differ.</p>
  <button type="button" :disabled="busy||writing||disconnected||!cwd" @click="read">Read configuration</button>
  <div v-if="data"><p v-if="!data.effective.length">Selected effective settings unavailable.</p>
   <ul><li v-for="row in data.effective" :key="row.key"><p>{{ row.key }}: {{ row.value }}</p><details><summary>Setting origin</summary><pre v-text="row.origin"></pre></details></li></ul>
   <details><summary>Configuration layers</summary><p v-if="!data.layersAvailable">Layers unavailable.</p><p v-else-if="!data.layers.length">No layers returned.</p><div v-for="(layer,i) in data.layers" :key="i"><pre v-text="layer.identity"></pre><p>Version: {{ layer.version }}</p><p v-if="layer.disabled">Disabled: {{ layer.disabled }}</p><pre v-text="JSON.stringify(layer.settings,null,2)"></pre></div><p v-if="data.bounded">First 40 layers shown.</p></details>
   <details><summary>Named profiles (public settings)</summary><p v-if="!data.profiles.length">No named profiles supplied in returned layers.</p><ul><li v-for="profile in data.profiles" :key="profile.name"><p>{{ profile.name }}</p><pre v-text="JSON.stringify(profile.settings,null,2)"></pre></li></ul></details>
   <details v-if="data.userTarget"><summary>Active user configuration model defaults</summary><p>Remote file: {{ data.userTarget.filePath }} · Profile: {{ data.userTarget.profile??'Base user defaults (all projects using them)' }} · Version: {{ data.userTarget.version }}</p><p>Saved model: {{ data.userTarget.model??'Inherited / unset' }} · Saved effort: {{ data.userTarget.effort??'Inherited / unset' }}</p><p>Changes this active user configuration only. Other profile files, secrets and unknown keys are preserved. Current conversations retain native overrides. Model availability/effort support still depends on the native model catalog.</p>
    <ComposerDropdown v-model="field" :options="[{value:'model',label:'Default model identifier'},{value:'model_reasoning_effort',label:'Default reasoning effort'}]" placeholder="Public model default" :disabled="writing||blocked||unknown" />
    <input v-if="field==='model'" v-model="value" aria-label="User configuration model default" maxlength="200" :disabled="writing||blocked||unknown"><ComposerDropdown v-else v-model="value" :options="['low','medium','high'].map(v=>({value:v,label:v}))" placeholder="Saved reasoning default" :disabled="writing||blocked||unknown" />
    <label><input v-model="confirmed" type="checkbox" :disabled="writing||blocked||unknown"> I confirm the shown user configuration file and its effects on future defaults.</label><button type="button" :disabled="!confirmed||!value||writing||blocked||unknown||disconnected" @click="save">Save confirmed model default</button>
   </details><p v-else>Writable active user configuration identity unavailable. No profile or global file is guessed.</p>
  </div>
  <details><summary>Managed restrictions</summary><p v-if="requirements===undefined">Unknown / unavailable.</p><p v-else-if="requirements===null">No managed requirements returned.</p><pre v-else v-text="JSON.stringify(requirements,null,2)"></pre></details>
  <p v-if="error" role="alert">{{ error }}</p>
  <p v-if="status" role="status">{{ status }}</p><button v-if="unknown" type="button" :disabled="busy||writing||!data?.userTarget" @click="unknown=false;confirmed=false;status='Uncertain configuration outcome acknowledged after reading native state. No write was replayed.'">Acknowledge inspected configuration outcome</button>
 </details>
</template>
