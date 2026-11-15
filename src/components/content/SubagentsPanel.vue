<script setup lang="ts">
import {ref,watch} from 'vue'
import {listChildAgents,readAgent,type AgentThread} from '../../api/subagents'
const props=defineProps<{threadId:string;epoch:number;disconnected:boolean}>()
const busy=ref(false),error=ref(''),loaded=ref(false),archived=ref(false),rows=ref<AgentThread[]>([]),parent=ref<AgentThread|null>(null),detail=ref<AgentThread|null>(null),cursor=ref<string|null>(null)
let generation=0
const seen=new Set<string>()
watch(()=>[props.threadId,props.epoch],()=>{generation++;busy.value=false;error.value='';loaded.value=false;rows.value=[];parent.value=null;detail.value=null;cursor.value=null;seen.clear()}, {flush:'sync'})
async function load(more=false){
 if(busy.value||props.disconnected||more&&(!cursor.value||rows.value.length>=200))return
 const token=++generation,id=props.threadId,next=more?cursor.value:null;busy.value=true;error.value=''
 if(!more){rows.value=[];parent.value=null;detail.value=null;loaded.value=false;seen.clear()}
 try {
  const [page,self]=await Promise.all([listChildAgents(id,archived.value,next??undefined),more?Promise.resolve(null):readAgent(id)])
  if(token!==generation)return
  if(page.cursor&&(page.cursor===next||seen.has(page.cursor)))throw new Error('Repeated native child cursor; refresh the list')
  if(page.cursor)seen.add(page.cursor)
  const byId=new Map(rows.value.map(row=>[row.id,row]));for(const row of page.rows)byId.set(row.id,row)
  rows.value=[...byId.values()].slice(0,200);cursor.value=page.cursor;if(self)parent.value=self;loaded.value=true
 }catch(e){if(token===generation)error.value=e instanceof Error?e.message:'Agent list unavailable'}
 finally{if(token===generation)busy.value=false}
}
async function inspect(id:string){
 if(busy.value||props.disconnected)return
 const token=++generation;busy.value=true;error.value='';detail.value=null
 try{const value=await readAgent(id);if(token===generation){if(value.parent!==props.threadId)throw new Error('Agent parent changed; refresh the list');detail.value=value}}
 catch(e){if(token===generation)error.value=e instanceof Error?e.message:'Agent details unavailable'}
 finally{if(token===generation)busy.value=false}
}
const href=(id:string)=>`#/thread/${encodeURIComponent(id)}`
</script>
<template>
 <details class="feature-panel subagents-panel">
  <summary>Subagents</summary>
  <p>Direct native children of {{ threadId }}. Refresh on demand; no recursive loading or agent control.</p>
  <label><input v-model="archived" type="checkbox" :disabled="busy" @change="loaded=false;rows=[];cursor=null"> Archived children</label>
  <button type="button" :disabled="busy||disconnected" @click="load()">Read subagents</button>
  <p v-if="parent?.parent">Native parent: <a :href="href(parent.parent)">{{ parent.parent }}</a></p>
  <p v-if="loaded&&!rows.length">No {{ archived?'archived':'active' }} direct children returned.</p>
  <ul><li v-for="row in rows" :key="row.id"><a :href="href(row.id)">{{ row.name }} · {{ row.id }}</a><p>{{ row.role }} · {{ row.status }}</p><button type="button" :disabled="busy||disconnected" @click="inspect(row.id)">Inspect {{ row.id }}</button></li></ul>
  <button v-if="cursor" type="button" :disabled="busy||disconnected||rows.length>=200" @click="load(true)">More subagents</button>
  <p v-if="rows.length>=200">Display limited to 200 children.</p>
  <div v-if="detail"><p>Agent {{ detail.id }} · {{ detail.status }} · {{ detail.cwd }}</p><details><summary>Agent preview (bounded)</summary><pre v-text="detail.preview"></pre></details></div>
  <p v-if="error" role="alert">{{ error }}</p>
 </details>
</template>
