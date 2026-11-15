<script setup lang="ts">
import {ref,watch} from 'vue'
import ComposerDropdown from './ComposerDropdown.vue'
import {detectExternalConfiguration,type ImportSource} from '../../api/importPreview'
const props=defineProps<{cwd:string;epoch:number;disconnected:boolean}>()
const source=ref<ImportSource>('claude-code'),busy=ref(false),error=ref(''),data=ref<Awaited<ReturnType<typeof detectExternalConfiguration>>|null>(null)
const options=[{value:'claude-code',label:'Claude Code'},{value:'cursor',label:'Cursor'}]
let generation=0
watch(()=>[props.cwd,props.epoch,source.value],()=>{generation++;busy.value=false;error.value='';data.value=null},{flush:'sync'})
async function read(){if(busy.value||props.disconnected||!props.cwd)return;const token=++generation;busy.value=true;error.value='';data.value=null
 try{const value=await detectExternalConfiguration(props.cwd,source.value);if(token===generation)data.value=value}
 catch(e){if(token===generation)error.value=e instanceof Error?e.message:'Migration discovery unavailable'}finally{if(token===generation)busy.value=false}}
</script>
<template>
 <details class="feature-panel import-preview"><summary>External-agent import preview</summary>
  <p>Remote project: {{ cwd }}. Project configuration only; home, sessions and connectors are excluded.</p>
  <ComposerDropdown v-model="source" :options="options" placeholder="Import source" />
  <button type="button" :disabled="busy||disconnected||!cwd" @click="read">Discover import candidates</button>
  <p>Native resource manifest only. Exact content changes, destination conflicts and overwrite safety are unavailable. Nothing is imported.</p>
  <p v-if="data&&!data.rows.length">No candidates returned for this project and source.</p>
  <ul><li v-for="(row,i) in data?.rows" :key="i"><p>{{ row.type }} · {{ row.scope }}</p><p>{{ row.description }}</p><p v-if="row.skipped">Skipped: extension outside this approved import scope.</p><p v-else>Preview only; import withheld pending conflict and recovery guarantees.</p><details><summary>Public resource identities</summary><pre v-text="row.details"></pre></details></li></ul>
  <p v-if="data?.bounded">First 100 manifest entries shown.</p><p v-if="error" role="alert">{{ error }}</p>
 </details>
</template>
