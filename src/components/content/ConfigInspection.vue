<script setup lang="ts">
import {ref,watch} from 'vue'
import {readConfiguration,readConfigRestrictions} from '../../api/configInspection'
const props=defineProps<{cwd:string;epoch:number;disconnected:boolean}>()
const busy=ref(false),error=ref(''),data=ref<Awaited<ReturnType<typeof readConfiguration>>|null>(null),requirements=ref<Awaited<ReturnType<typeof readConfigRestrictions>>|undefined>(undefined)
let generation=0
watch(()=>[props.cwd,props.epoch],()=>{generation++;busy.value=false;error.value='';data.value=null;requirements.value=undefined},{flush:'sync'})
async function read(){if(busy.value||props.disconnected||!props.cwd)return;const token=++generation;busy.value=true;error.value='';data.value=null;requirements.value=undefined
 const results=await Promise.allSettled([readConfiguration(props.cwd),readConfigRestrictions()]);if(token!==generation)return
 if(results[0].status==='fulfilled')data.value=results[0].value
 if(results[1].status==='fulfilled')requirements.value=results[1].value
 error.value=results.filter(r=>r.status==='rejected').map(r=>r.status==='rejected'?String(r.reason instanceof Error?r.reason.message:'Configuration unavailable'):'').join('\n').slice(0,2000);busy.value=false}
</script>
<template>
 <details class="feature-panel config-inspection"><summary>Configuration inspection</summary>
  <p>Remote project: {{ cwd }}. Selected public settings only; thread overrides can differ.</p>
  <button type="button" :disabled="busy||disconnected||!cwd" @click="read">Read configuration</button>
  <div v-if="data"><p v-if="!data.effective.length">Selected effective settings unavailable.</p>
   <ul><li v-for="row in data.effective" :key="row.key"><p>{{ row.key }}: {{ row.value }}</p><details><summary>Setting origin</summary><pre v-text="row.origin"></pre></details></li></ul>
   <details><summary>Configuration layers</summary><p v-if="!data.layersAvailable">Layers unavailable.</p><p v-else-if="!data.layers.length">No layers returned.</p><div v-for="(layer,i) in data.layers" :key="i"><pre v-text="layer.identity"></pre><p>Version: {{ layer.version }}</p><p v-if="layer.disabled">Disabled: {{ layer.disabled }}</p><pre v-text="JSON.stringify(layer.settings,null,2)"></pre></div><p v-if="data.bounded">First 40 layers shown.</p></details>
   <details><summary>Named profiles (public settings)</summary><p v-if="!data.profiles.length">No named profiles supplied in returned layers.</p><ul><li v-for="profile in data.profiles" :key="profile.name"><p>{{ profile.name }}</p><pre v-text="JSON.stringify(profile.settings,null,2)"></pre></li></ul></details>
  </div>
  <details><summary>Managed restrictions</summary><p v-if="requirements===undefined">Unknown / unavailable.</p><p v-else-if="requirements===null">No managed requirements returned.</p><pre v-else v-text="JSON.stringify(requirements,null,2)"></pre></details>
  <p v-if="error" role="alert">{{ error }}</p>
 </details>
</template>
