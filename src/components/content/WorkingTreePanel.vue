<script setup lang="ts">
import { ref, watch } from 'vue'
import { readWorkingTree, readWorkingTreePatch, type GitRow } from '../../api/workingTree'
const props=defineProps<{cwd:string;epoch:number}>()
const rows=ref<GitRow[]|null>(null), busy=ref(false), error=ref(''), stamp=ref(''), patch=ref(''), selected=ref('')
let generation=0
watch(()=>[props.cwd,props.epoch],()=>{generation++;rows.value=null;busy.value=false;error.value='';stamp.value='';patch.value='';selected.value=''}, {flush:'sync'})
async function refresh() {
 if(busy.value)return
 const job=++generation;busy.value=true;error.value='';rows.value=null;patch.value='';selected.value=''
 try{const result=await readWorkingTree(props.cwd);if(job===generation){rows.value=result.rows;stamp.value=result.refreshedAt}}
 catch(e){if(job===generation)error.value=e instanceof Error?e.message:'Working tree unavailable'}
 finally{if(job===generation)busy.value=false}
}
async function preview(row:GitRow,staged:boolean) {
 if(busy.value)return
 const job=++generation;busy.value=true;patch.value='';error.value='';selected.value=`${row.path} · ${row.untracked?'untracked':staged?'staged':'unstaged'}`
 try{const result=await readWorkingTreePatch(props.cwd,row,staged);if(job===generation)patch.value=(result.text||'No patch returned (file may have changed since refresh).')+(result.bounded?'\n[Preview reached 64 KiB; may be truncated]':'')}
 catch(e){if(job===generation)error.value=e instanceof Error?e.message:'Preview unavailable'}
 finally{if(job===generation)busy.value=false}
}
</script>
<template>
 <details id="current-working-tree" class="feature-panel working-tree-panel">
  <summary>Current Git working tree</summary>
  <p>Remote project: {{ cwd || 'Unavailable' }}</p>
  <p v-if="stamp">Refreshed: {{ stamp }}. Snapshot; refresh after external changes.</p>
  <button type="button" :disabled="busy || !cwd" @click="refresh">{{ busy?'Reading…':'Refresh working tree' }}</button>
  <p v-if="error" role="alert">{{ error }}</p>
  <p v-if="rows?.length===0">Working tree clean.</p>
  <ul v-if="rows"><li v-for="row in rows" :key="row.path">
   <span>{{ row.oldPath ? row.oldPath+' → ' : '' }}{{ row.path }}</span>
   <span v-if="row.untracked"> · Untracked </span>
   <button v-if="row.untracked" type="button" :disabled="busy" @click="preview(row,false)">Preview untracked {{ row.path }}</button>
   <button v-if="!row.untracked && row.index!==' '" type="button" :disabled="busy" @click="preview(row,true)">Staged {{ row.index }} · {{ row.path }}</button>
   <button v-if="!row.untracked && row.worktree!==' '" type="button" :disabled="busy" @click="preview(row,false)">Unstaged {{ row.worktree }} · {{ row.path }}</button>
  </li></ul>
  <details v-if="selected" open><summary>{{ selected }} (bounded text patch)</summary><pre v-text="patch"></pre></details>
 </details>
</template>
