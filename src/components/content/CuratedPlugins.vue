<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {readCuratedPlugins,type CuratedPlugin} from '../../api/curatedPlugins'
const props=defineProps<{epoch:number}>()
const plugins=ref<CuratedPlugin[]|null>(null),warnings=ref<string[]>([]),busy=ref(false),error=ref(''),query=ref(''),limit=ref(40)
let generation=0
const filtered=computed(()=>(plugins.value??[]).filter(p=>`${p.name} ${p.description} ${p.marketplace}`.toLowerCase().includes(query.value.toLowerCase())))
watch(()=>props.epoch,()=>{generation++;plugins.value=null;warnings.value=[];busy.value=false;error.value='Connection changed; read collection again.'}, {flush:'sync'})
watch(query,()=>{limit.value=40})
async function read(){if(busy.value)return;const token=++generation;busy.value=true;error.value='';plugins.value=null;warnings.value=[];limit.value=40
 try{const result=await readCuratedPlugins();if(token===generation){plugins.value=result.plugins;warnings.value=result.warnings}}catch(e){if(token===generation)error.value=e instanceof Error?e.message:'Collection unavailable'}finally{if(token===generation)busy.value=false}
}
</script>
<template>
 <details class="feature-panel curated-plugins"><summary>Curated plugin collection</summary>
  <p>Partial read-only browser of the native vertical collection. Local/default Marketplace lists can synchronize installed bundles, so they are not requested here. Some runtime feature configurations return no vertical collection. No flags or installations are changed.</p>
  <button type="button" :disabled="busy" @click="read">Read curated plugins</button>
  <input v-model="query" aria-label="Filter curated plugins" maxlength="100" placeholder="Filter returned collection" />
  <p v-if="plugins?.length===0">No curated plugins returned for this runtime/account configuration.</p>
  <p v-if="plugins">{{ filtered.length }} matching returned plugins</p>
  <ul v-if="plugins"><li v-for="plugin in filtered.slice(0,limit)" :key="plugin.marketplace+plugin.id"><details><summary>{{ plugin.name }} · {{ plugin.marketplace }}</summary>
   <p>ID: {{ plugin.id }}</p><p>Advertised version: {{ plugin.version }} · Local version: {{ plugin.localVersion }}</p>
   <p>Installed: {{ plugin.installed??'Unknown' }} · Enabled: {{ plugin.enabled??'Unknown' }}</p>
   <p>Developer: {{ plugin.developer }}</p><pre v-text="plugin.source"></pre><p>{{ plugin.description }}</p>
  </details></li></ul>
  <button v-if="filtered.length>limit" type="button" @click="limit+=40">Show more curated plugins</button>
  <p v-for="(warning,i) in warnings" :key="i" role="status">{{ warning }}</p><p v-if="error" role="alert">{{ error }}</p>
 </details>
</template>
