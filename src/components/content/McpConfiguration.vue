<script setup lang="ts">
import {ref,watch} from 'vue'
import {readMcpSwitches,saveMcpSwitch,type McpSwitches} from '../../api/mcpConfiguration'
const props=defineProps<{epoch:number}>()
const data=ref<McpSwitches|null>(null),busy=ref(false),status=ref(''),confirmation=ref<{name:string;enabled:boolean}|null>(null)
let generation=0,saving=false
watch(()=>props.epoch,()=>{generation++;data.value=null;busy.value=false;confirmation.value=null;status.value=saving?'Connection changed during save; outcome unknown. Read configuration before another action.':'Connection changed; read configuration again.';saving=false}, {flush:'sync'})
async function read(){if(busy.value)return;const token=++generation;busy.value=true;data.value=null;status.value='';confirmation.value=null
 try{const value=await readMcpSwitches();if(token===generation)data.value=value}catch(e){if(token===generation)status.value=e instanceof Error?e.message:'Configuration unavailable'}finally{if(token===generation)busy.value=false}
}
async function save(){if(busy.value||!data.value||!confirmation.value)return;const token=++generation,snapshot=data.value,change=confirmation.value;confirmation.value=null;busy.value=true;saving=true
 try{const result=await saveMcpSwitch(snapshot,change.name,change.enabled);if(token!==generation)return
  data.value={...snapshot,version:result.version,servers:snapshot.servers.map(server=>server.name===change.name?{...server,enabled:change.enabled}:server)}
  status.value=result.overridden?'Saved, but overridden by another configuration layer. Effective runtime state is unchanged until verified.':'Saved configuration only. Use the existing MCP Refresh/reload explicitly when safe; runtime state has not been verified.'
 }catch(e){if(token===generation){data.value=null;status.value='Save rejected or outcome uncertain. Read configuration before retrying. '+(e instanceof Error?e.message:'')}}finally{if(token===generation){busy.value=false;saving=false}}
}
</script>
<template>
 <details class="feature-panel mcp-configuration"><summary>MCP configuration switches</summary>
  <p>Partial management: edit only enabled for existing simple-name definitions in the base user configuration. Adding/removing definitions, editing commands/URLs/secrets and profile/project layers remain external.</p>
  <button type="button" :disabled="busy" @click="read">Read MCP configuration</button>
  <p v-if="data">Remote file: {{ data.filePath }}. Version-checked saves; unrelated fields and secrets are never sent.</p>
  <p v-if="data?.servers.length===0">No editable MCP definitions returned.</p>
  <ul v-if="data"><li v-for="server in data.servers" :key="server.name">{{ server.name }} · Saved enabled: {{ server.enabled===null?'Unspecified':server.enabled }}
   <button type="button" :disabled="busy" @click="confirmation={name:server.name,enabled:true}">Save enabled for {{ server.name }}</button>
   <button type="button" :disabled="busy" @click="confirmation={name:server.name,enabled:false}">Save disabled for {{ server.name }}</button>
  </li></ul>
  <div v-if="confirmation"><p>Save {{ confirmation.name }} enabled={{ confirmation.enabled }} in {{ data?.filePath }}? No automatic reload.</p><button type="button" :disabled="busy" @click="save">Confirm MCP setting</button><button type="button" @click="confirmation=null">Cancel MCP setting</button></div>
  <p v-if="status" role="status">{{ status }}</p>
 </details>
</template>
