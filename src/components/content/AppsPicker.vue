<script setup lang="ts">
import {ref,watch} from 'vue'
import {listAvailableApps,type AvailableApp,type AppReference} from '../../api/apps'
const props=defineProps<{threadId:string;epoch:number;selected:AppReference[];disabled:boolean}>()
const emit=defineEmits<{change:[apps:AppReference[]];unavailable:[value:boolean]}>()
const rows=ref<AvailableApp[]|null>(null),cursor=ref<string|null>(null),busy=ref(false),error=ref('')
let generation=0
watch(()=>[props.threadId,props.epoch],()=>{generation++;rows.value=null;cursor.value=null;busy.value=false;error.value=''}, {flush:'sync'})
watch(()=>[props.selected,rows.value],()=>emit('unavailable',props.selected.some(app=>rows.value?.some(row=>row.id===app.id&&(!row.enabled||!row.accessible)))), {deep:true})
async function refresh(more=false){if(busy.value||props.disabled)return;const token=++generation;busy.value=true;error.value='';if(!more){rows.value=null;cursor.value=null}
 try{const page=await listAvailableApps(props.threadId,more?cursor.value:null);if(token!==generation)return
  if(more&&page.nextCursor&&page.nextCursor===cursor.value)throw new Error('Apps cursor did not advance')
  const merged=[...new Map([...(rows.value??[]),...page.data].map(app=>[app.id,app])).values()];if(merged.length>200)throw new Error('Apps view limited to 200; refresh to restart.')
  rows.value=merged;cursor.value=page.nextCursor
 }catch(e){if(token===generation)error.value=e instanceof Error?e.message:'Apps unavailable'}finally{if(token===generation)busy.value=false}
}
function add(app:AvailableApp){if(props.disabled||!app.accessible||!app.enabled||props.selected.length>=20)return;emit('change',[...props.selected.filter(row=>row.id!==app.id),{id:app.id,name:app.name}])}
</script>
<template>
 <section class="apps-picker-body">
  <p>Native references for this thread. Availability can change; refresh to recheck. Selecting never installs or authenticates an App.</p>
  <button type="button" :disabled="busy||disabled" @click="refresh(false)">Refresh available Apps</button>
  <ul><li v-for="app in selected" :key="app.id">Selected: {{ app.name }} · app://{{ app.id }} <span v-if="rows?.some(row=>row.id===app.id&&(!row.enabled||!row.accessible))"> · No longer available; remove this reference.</span><button type="button" :disabled="disabled" @click="emit('change',selected.filter(row=>row.id!==app.id))">Remove App {{ app.name }}</button></li></ul>
  <p v-if="rows?.length===0">No Apps returned.</p>
  <ul v-if="rows"><li v-for="app in rows" :key="app.id"><button type="button" :disabled="disabled||!app.enabled||!app.accessible||selected.length>=20" @click="add(app)">Reference {{ app.name }}</button> · {{ app.id }} · {{ app.accessible&&app.enabled?'Available':'Unavailable' }}</li></ul>
  <button v-if="cursor" type="button" :disabled="busy||disabled" @click="refresh(true)">Load more Apps</button>
  <p v-if="error" role="alert">{{ error }}</p>
 </section>
</template>
