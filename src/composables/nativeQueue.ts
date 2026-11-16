import {computed,ref,watch,type Ref} from 'vue'
import {rpcCall,type RpcNotification} from '../api/codexRpcClient'
import {queueEntry,queuePage,queuedInput,type QueueEntry} from '../api/nativeQueue'
import type {SubmitPayload} from '../components/content/composerContracts'
import {nativeWriteRejected,nativeWriteError} from '../api/nativeWriteOutcome'
import {clientMessageId} from '../utils/clientMessageId'
import {readQueueSubmissionReceipts,writeQueueSubmissionReceipt} from '../utils/queueSubmissionReceipts'
export function createNativeQueue(deps:{selected:Ref<string>;epoch:Ref<number>;ready:()=>boolean;blocked:()=>boolean;active?:()=>boolean;refreshHistory?:(id:string)=>Promise<void>},request:typeof rpcCall=rpcCall){
 const rows=ref<QueueEntry[]>([]),cursor=ref<string|null>(null),loaded=ref(false),stale=ref(false),reading=ref(false),writing=ref(false),status=ref(''),readError=ref(''),operationThread=ref(''),uncertainByThread=ref<Record<string,string>>({})
 const uncertain=computed(()=>uncertainByThread.value[deps.selected.value]??'')
 const recoveryError=ref('Reading queue recovery markers…')
 async function recoverSubmissions(){try{for(const [id,clientId]of Object.entries(await readQueueSubmissionReceipts()))uncertainByThread.value={...uncertainByThread.value,[id]:`Queue submission may already have been registered or executed. Client message: ${clientId}. Inspect native queue and history; submitting again is not an idempotent retry.`};recoveryError.value=''}catch(e){recoveryError.value=nativeWriteError(e,'Queue recovery storage unavailable')}}
 void recoverSubmissions()
 const available=computed(()=>loaded.value&&!stale.value&&!uncertain.value&&!recoveryError.value&&deps.ready())
 let readJob=0,writeJob=0
 const seen=new Set<string>()
 function reset(){readJob++;rows.value=[];cursor.value=null;loaded.value=false;stale.value=false;reading.value=false;readError.value='';seen.clear()}
 watch(deps.selected,reset,{flush:'sync'})
 watch(deps.epoch,()=>{reset();if(writing.value){uncertainByThread.value={...uncertainByThread.value,[operationThread.value]:'Connection changed during a queue write. Outcome unknown; inspect the native queue and history. No replay is performed.'}}writeJob++;writing.value=false},{flush:'sync'})
 async function refresh(more=false){
  if(reading.value||!deps.ready()||!deps.selected.value||more&&(!cursor.value||stale.value||rows.value.length>=100))return
  const token=++readJob,id=deps.selected.value,next=more?cursor.value:null;reading.value=true;readError.value=''
  if(!more){rows.value=[];cursor.value=null;loaded.value=false;seen.clear()}
  try{const page=queuePage(await request('thread/queue/list',{threadId:id,limit:20,...(next?{cursor:next}:{})}));if(token!==readJob)return
   if(page.cursor&&(page.cursor===next||seen.has(page.cursor)))throw new Error('Repeated queue cursor; refresh from the beginning')
   if(page.cursor)seen.add(page.cursor)
   rows.value=[...new Map([...rows.value,...page.rows].map(row=>[row.id,row])).values()].slice(0,100);cursor.value=page.cursor;loaded.value=true;stale.value=false
  }catch(e){if(token===readJob){loaded.value=false;readError.value=nativeWriteError(e,'Native queue unavailable')}}finally{if(token===readJob)reading.value=false}
 }
 async function add(payload:SubmitPayload){
  if(writing.value)throw new Error('Read the native queue and resolve pending actions before queuing')
  const selected=deps.selected.value,epoch=deps.epoch.value,job=writeJob
  await recoverSubmissions()
  if(selected!==deps.selected.value||epoch!==deps.epoch.value||job!==writeJob||writing.value||!available.value||deps.blocked())throw new Error('Read the native queue and resolve pending actions before queuing')
  if(Object.keys(uncertainByThread.value).length>=20)throw new Error('Resolve uncertain queue operations before submitting more')
  const id=deps.selected.value,token=++writeJob,clientId=clientMessageId(),input=queuedInput(payload)
  // Persist identity before sending. A lost reply or document reload must not
  // turn the retained draft into an unguarded second native registration.
  writing.value=true;operationThread.value=id
  try { await writeQueueSubmissionReceipt(id,clientId) } catch(e) { if(token===writeJob)writing.value=false; throw e }
  if(token!==writeJob){throw new Error('Queue outcome unknown after connection change; recovery marker retained')}
  status.value='Requesting native queue submission…'
  try{const result=await request<{queuedSubmission:unknown}>('thread/queue/add',{threadId:id,input,clientUserMessageId:clientId});if(token!==writeJob)throw new Error('Queue outcome unknown after connection change')
   const row=queueEntry(result?.queuedSubmission);if(row.clientId!==clientId)throw new Error('Queue acknowledgment identity mismatch')
   await writeQueueSubmissionReceipt(id,null,clientId)
   status.value=`Accepted by native queue: ${row.id}. Native settings apply when it runs.`
   if(deps.selected.value===id){stale.value=true;await refresh()}
   return true
  }catch(e){if(token===writeJob){if(nativeWriteRejected(e)){try{await writeQueueSubmissionReceipt(id,null,clientId)}catch{/* Retain a conservative recovery marker if storage failed. */}status.value=`Native queue rejected the submission. ${nativeWriteError(e)}`}
   else{uncertainByThread.value={...uncertainByThread.value,[id]:`Queue outcome unknown. Client message: ${clientId}. Inspect queue and history before another submission. ${nativeWriteError(e)}`};status.value=uncertainByThread.value[id]!}}throw new Error(nativeWriteError(e))}
  finally{if(token===writeJob)writing.value=false}
 }
 function observe(event:RpcNotification){const p=event.params as {threadId?:unknown}|null;if(event.method==='thread/queue/changed'&&p?.threadId===deps.selected.value){readJob++;reading.value=false;stale.value=true}}
 async function manage(kind:'update'|'delete'|'reorder'|'start',rowId:string,text?:string){
  if(writing.value||!available.value||deps.blocked()||kind==='start'&&deps.active?.())throw new Error('Refresh the queue and wait for conflicting work before acting')
  const row=rows.value.find(r=>r.id===rowId)
  if(!row)throw new Error('Queued identity is no longer in this snapshot')
  const id=deps.selected.value,token=++writeJob
  let params:Record<string,unknown>={threadId:id,queuedSubmissionId:row.id}
  if(kind==='update'){
   if(!row.input||row.text===null||typeof text!=='string'||!text.trim()||text.length>32000)throw new Error('This structured prompt cannot be safely edited here')
   params.input=row.input.map((part,index)=>index===0?{...part,text}:part)
  }
  if(kind==='reorder'){
   const index=rows.value.indexOf(row)
   if(cursor.value||index<=0)throw new Error('Load the entire bounded queue before reordering')
   const ids=rows.value.map(row=>row.id);[ids[index-1],ids[index]]=[ids[index]!,ids[index-1]!]
   params={threadId:id,queuedSubmissionIds:ids}
  }
  writing.value=true;operationThread.value=id;status.value=`Requesting native queue ${kind}…`
  try{
   const result=await request<Record<string,unknown>>(`thread/queue/${kind}`,params)
   if(token!==writeJob)return
   if(kind==='update'){const updated=queueEntry(result?.queuedSubmission);if(updated.id!==row.id||updated.clientId!==row.clientId)throw new Error('Queue update identity mismatch')}
   if(kind==='delete'&&typeof result?.deleted!=='boolean')throw new Error('Queue removal outcome unavailable')
   if(kind==='start'){
    const turn=result?.turn as Record<string,unknown>
    if(typeof turn?.id!=='string'||!turn.id)throw new Error('Native queue start identity unavailable')
    status.value=`Native turn accepted: ${turn.id}. Completion follows normal thread events.`
    try{await deps.refreshHistory?.(id)}catch{status.value+=' History reconciliation failed; inspect the conversation.'}
   }else status.value=kind==='delete'&&!result.deleted?'Native entry was already absent; it may have run.':`Native queue ${kind} acknowledged. Refreshing persisted state.`
   if(deps.selected.value===id){stale.value=true;await refresh()}
  }catch(e){if(token===writeJob){if(nativeWriteRejected(e)){status.value=`Native queue ${kind} rejected. Refresh before acting again. ${nativeWriteError(e)}`;stale.value=true}
   else{uncertainByThread.value={...uncertainByThread.value,[id]:`Queue ${kind} outcome unknown for ${row.id}; inspect native queue and history. ${nativeWriteError(e)}`};status.value=uncertainByThread.value[id]!}}}
  finally{if(token===writeJob)writing.value=false}
 }
 async function acknowledgeUnknown(){if(!loaded.value||stale.value||reading.value||writing.value)return;const id=deps.selected.value;writing.value=true;try{const expected=(await readQueueSubmissionReceipts())[id];if(expected)await writeQueueSubmissionReceipt(id,null,expected)}catch(e){recoveryError.value=nativeWriteError(e,'Queue recovery storage unavailable');return}finally{writing.value=false}const next={...uncertainByThread.value};delete next[id];uncertainByThread.value=next;status.value='Uncertain result acknowledged. This does not prove non-execution: an absent entry may already have run. Submitting the retained draft again can duplicate execution; no idempotent retry is available.';operationThread.value=id}
 return {rows,cursor,loaded,stale,reading,writing,status,readError,recoveryError,operationThread,uncertain,available,refresh,add,manage,observe,acknowledgeUnknown}
}
