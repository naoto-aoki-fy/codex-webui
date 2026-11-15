<script setup lang="ts">
import {ref,watch} from 'vue'
import {readHooks} from '../../api/hooksInspection'
const props=defineProps<{threadId:string;epoch:number;disconnected:boolean}>()
const busy=ref(false),error=ref(''),data=ref<Awaited<ReturnType<typeof readHooks>>|null>(null)
let generation=0
watch(()=>[props.threadId,props.epoch],()=>{generation++;busy.value=false;error.value='';data.value=null},{flush:'sync'})
async function read(){if(busy.value||props.disconnected)return;const token=++generation;busy.value=true;error.value='';data.value=null
 try{const result=await readHooks(props.threadId);if(token===generation)data.value=result}
 catch(e){if(token===generation)error.value=e instanceof Error?e.message:'Hooks unavailable'}finally{if(token===generation)busy.value=false}}
</script>
<template>
 <details class="feature-panel hooks-inspection"><summary>Hooks inspection</summary>
  <p>Loaded thread: {{ threadId }}. Inspection does not execute Hooks or change trust.</p>
  <button type="button" :disabled="busy||disconnected" @click="read">Read Hooks</button>
  <p v-if="data&&!data.groups.length">No Hook scopes returned.</p>
  <div v-for="(group,index) in data?.groups" :key="index"><p>Remote scope: {{ group.cwd }}</p>
   <p v-if="!group.hooks.length">No Hooks returned for this scope.</p>
   <ul><li v-for="(hook,i) in group.hooks" :key="i"><p>{{ hook.event }} · {{ hook.key }}</p>
    <p>Enabled: {{ hook.enabled===null?'Unknown':hook.enabled?'Yes':'No' }} · Managed: {{ hook.managed===null?'Unknown':hook.managed?'Yes':'No' }} · Trust: {{ hook.trust }}</p>
    <details><summary>Hook definition and origin</summary><pre v-text="hook.definition"></pre><pre v-text="hook.origin"></pre><p>Current hash: {{ hook.hash }}</p></details>
   </li></ul>
   <p v-for="(warning,i) in group.warnings" :key="'w'+i">{{ warning }}</p>
   <p v-for="(issue,i) in group.errors" :key="'e'+i" role="alert">{{ issue }}</p>
  </div><p v-if="data?.truncated">Display limited to 100 Hooks.</p>
  <p v-if="error" role="alert">{{ error }}</p>
 </details>
</template>
