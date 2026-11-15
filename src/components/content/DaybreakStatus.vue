<script setup lang="ts">
import {ref,watch} from 'vue'
import {readDaybreakPreference,readAccessPrograms} from '../../api/daybreakStatus'
import {nativeWriteError} from '../../api/nativeWriteOutcome'
const props=defineProps<{threadId:string;epoch:number;disconnected:boolean}>()
const busy=ref(false),preference=ref('unknown'),rows=ref<Awaited<ReturnType<typeof readAccessPrograms>>['rows']>([]),cursor=ref<string|null>(null),loaded=ref(false),error=ref(''),stamp=ref('')
let generation=0
const seen=new Set<string>()
watch(()=>[props.threadId,props.epoch],()=>{generation++;busy.value=false;preference.value='unknown';rows.value=[];cursor.value=null;loaded.value=false;error.value='';stamp.value='';seen.clear()},{flush:'sync'})
async function read(more=false){if(busy.value||props.disconnected||more&&(!cursor.value||rows.value.length>=100))return;const token=++generation,next=more?cursor.value:null;busy.value=true;error.value=''
 if(!more){preference.value='unknown';rows.value=[];loaded.value=false;cursor.value=null;seen.clear()}
 const result=await Promise.allSettled([more?Promise.resolve(null):readDaybreakPreference(props.threadId),readAccessPrograms(next??undefined)]);if(token!==generation)return
 if(result[0].status==='fulfilled'&&result[0].value!==null)preference.value=result[0].value
 if(result[1].status==='fulfilled'){const page=result[1].value;if(page.cursor&&(page.cursor===next||seen.has(page.cursor)))error.value='Repeated model cursor; refresh from the beginning'
  else{if(page.cursor)seen.add(page.cursor);rows.value=[...new Map([...rows.value,...page.rows].map(row=>[row.id,row])).values()].slice(0,100);cursor.value=page.cursor;loaded.value=true;stamp.value=new Date().toISOString()}}
 error.value+=[...result].filter(r=>r.status==='rejected').map(r=>r.status==='rejected'?nativeWriteError(r.reason,'Daybreak status unavailable'):'').join('\n');busy.value=false}
</script>
<template>
 <details class="feature-panel daybreak-status"><summary>Native Daybreak status</summary>
  <button type="button" :disabled="busy||disconnected" @click="read()">Read native Daybreak status</button>
  <p>Thread {{ threadId }} · Saved Daybreak choice: {{ preference }}.</p><p>This saved choice does not grant access or select a turn's cyber program. It is separate from security-scan services.</p>
  <p v-if="stamp">Catalog snapshot: {{ stamp }} · App Server default provider. Current thread/composer models can differ.</p>
  <p v-if="loaded&&!rows.length">No models returned.</p><ul><li v-for="row in rows" :key="row.id"><p>{{ row.id }} · {{ row.programs===null?'Access-program metadata unavailable':row.programs.length?'Advertised explicit cyber programs: '+row.programs.join(', '):'Explicit cyber program list empty' }}</p></li></ul>
  <button v-if="cursor" type="button" :disabled="busy||disconnected||rows.length>=100" @click="read(true)">More access-program models</button><p v-if="rows.length>=100">First 100 models shown.</p>
  <p>Generation authorization remains server-owned. This inspection does not change settings, select a program or start a turn.</p><p v-if="error" role="alert">{{ error }}</p>
 </details>
</template>
