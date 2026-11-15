import { computed, ref, watch, type Ref } from 'vue'
import { rpcCall, type RpcNotification } from '../api/codexRpcClient'
export function createThreadCompaction(deps:{epoch:Ref<number>;selected:Ref<string>;blocked:()=>boolean;ready:()=>boolean;refresh:(id:string)=>Promise<void>},request:(method:string,params:unknown)=>Promise<unknown>=rpcCall) {
 const thread=ref(''), state=ref<'idle'|'pending'|'completed'|'failed'|'unknown'|'unsupported'>('idle'), status=ref('')
 let job=0, itemId='', turnId=''
 const busy=computed(()=>state.value==='pending')
 const selectedBusy=computed(()=>busy.value&&thread.value===deps.selected.value)
 watch(deps.epoch,()=>{job++;if(busy.value){state.value='unknown';status.value='Connection changed; compaction outcome unknown. Inspect native history before requesting again.'}}, {flush:'sync'})
 async function run() {
  if(busy.value||!deps.selected.value||deps.blocked()||!deps.ready())return
  const id=deps.selected.value, token=++job;thread.value=id;state.value='pending';itemId='';turnId='';status.value='Requesting native compaction…'
  try{await request('thread/compact/start',{threadId:id});if(token===job&&busy.value)status.value='Compaction requested; waiting for the native completion event.'}
  catch(e){if(token!==job||!busy.value)return
   const code=(e as {rpcCode?:number})?.rpcCode
   state.value=code===-32601?'unsupported':typeof code==='number'?'failed':'unknown'
   status.value=state.value==='unsupported'?'Manual compaction is unsupported by this App Server.':`${state.value==='unknown'?'Compaction outcome unknown; inspect history before retrying.':'Compaction rejected.'} ${e instanceof Error?e.message:'Request failed'}`
  }
 }
 function observe(event:RpcNotification) {
  if(!busy.value)return
  const params=event.params as Record<string,any>|null
  if(params?.threadId!==thread.value)return
  if(event.method==='item/started'&&params.item?.type==='contextCompaction'){itemId=params.item.id;turnId=typeof params.turnId==='string'?params.turnId:''}
  if(event.method==='item/completed'&&params.item?.type==='contextCompaction'&&itemId&&params.item.id===itemId){
   state.value='completed';status.value='Native compaction completed. Context usage follows server observations; visible history is retained.'
   const token=job
   void deps.refresh(thread.value).catch(()=>{if(token===job)status.value+=' History refresh failed; refresh manually.'})
  }
  if(event.method==='turn/completed'&&turnId&&params.turn?.id===turnId&&params.turn?.status==='failed'){
   state.value='failed';status.value='Native compaction failed. '+String(params.turn?.error?.message||'No error detail supplied.').slice(0,1000)
  }
 }
 return {thread,state,status,busy,selectedBusy,run,observe}
}
