<script setup lang="ts">
import {ref,watch} from 'vue'
import {readRemoteStatus,listRemoteClients,type RemoteClient} from '../../api/remoteControl'
const props=defineProps<{epoch:number}>()
const status=ref<Awaited<ReturnType<typeof readRemoteStatus>>|null>(null),clients=ref<RemoteClient[]|null>(null),cursor=ref<string|null>(null),busy=ref(false),error=ref('')
let generation=0
watch(()=>props.epoch,()=>{generation++;status.value=null;clients.value=null;cursor.value=null;busy.value=false;error.value='Connection changed; read status again.'}, {flush:'sync'})
async function refresh(){if(busy.value)return;const token=++generation;busy.value=true;status.value=null;clients.value=null;cursor.value=null;error.value=''
 try{const value=await readRemoteStatus();if(token===generation)status.value=value}catch(e){if(token===generation)error.value=e instanceof Error?e.message:'Remote Control unavailable'}finally{if(token===generation)busy.value=false}
}
async function loadClients(more=false){if(busy.value||!status.value?.environmentId)return;const token=++generation;busy.value=true;error.value='';const previous=more?clients.value??[]:[]
 try{const page=await listRemoteClients(status.value.environmentId,more?cursor.value:null);if(token!==generation)return
  if(more&&page.nextCursor&&page.nextCursor===cursor.value)throw new Error('Client cursor did not advance')
  const merged=[...new Map([...previous,...page.data].map(c=>[c.clientId,c])).values()];if(merged.length>200)throw new Error('Client view limited to 200 entries; refresh to restart.')
  clients.value=merged;cursor.value=page.nextCursor
 }catch(e){if(token===generation)error.value=e instanceof Error?e.message:'Client list unavailable'}finally{if(token===generation)busy.value=false}
}
</script>
<template>
 <details class="feature-panel remote-control-status"><summary>Codex Remote Control status</summary>
  <button type="button" :disabled="busy" @click="refresh">Read Remote Control status</button>
  <p v-if="status">Native service: {{ status.status }} · {{ status.serverName }}</p><p v-else>Service state unknown.</p>
  <p>This view does not enable the service or change WebUI access. Pairing and revocation are managed externally.</p>
  <button v-if="status?.environmentId" type="button" :disabled="busy" @click="loadClients(false)">Read registered clients</button>
  <p v-if="status && !status.environmentId">No environment identity returned; client listing unavailable.</p>
  <p v-if="clients">Registered clients are not proof of an active connection. Last-seen values are returned by the native service.</p>
  <p v-if="clients?.length===0">No registered clients returned.</p>
  <ul v-if="clients"><li v-for="client in clients" :key="client.clientId">{{ client.name }} · {{ client.clientId }} · {{ client.platform }} · Last seen (native): {{ client.lastSeen??'Unavailable' }}</li></ul>
  <button v-if="cursor" type="button" :disabled="busy" @click="loadClients(true)">Load more registered clients</button>
  <p v-if="error" role="alert">{{ error }}</p>
 </details>
</template>
