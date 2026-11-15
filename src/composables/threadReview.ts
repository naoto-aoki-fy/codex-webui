import { computed, ref, watch, type Ref } from 'vue'
import { rpcCall, type RpcNotification } from '../api/codexRpcClient'
export type ReviewKind='uncommittedChanges'|'baseBranch'|'commit'|'custom'
export function reviewTarget(kind:ReviewKind,value:string) {
 const text=value.trim()
 if(kind==='uncommittedChanges')return {type:kind}
 if(!text || text.length>8000)throw new Error('Enter a review target (at most 8,000 characters).')
 if(kind==='baseBranch')return {type:kind,branch:text}
 if(kind==='commit')return {type:kind,sha:text}
 return {type:kind,instructions:text}
}
export function createThreadReview(deps:{epoch:Ref<number>;selected:Ref<string>;blocked:()=>boolean;ready:()=>boolean;interrupt:()=>Promise<void>},request:(method:string,params:unknown)=>Promise<unknown>=rpcCall) {
 const kind=ref<ReviewKind>('uncommittedChanges'),value=ref(''),thread=ref(''),turn=ref(''),busy=ref(false),status=ref('')
 let job=0
 const selectedBusy=computed(()=>busy.value&&thread.value===deps.selected.value)
 watch(deps.epoch,()=>{job++;if(busy.value){busy.value=false;status.value='Connection changed; review outcome unknown. Inspect native history before retrying.'}}, {flush:'sync'})
 async function run(){
  if(busy.value||!deps.selected.value||deps.blocked()||!deps.ready())return
  let target;try{target=reviewTarget(kind.value,value.value)}catch(e){status.value=(e as Error).message;return}
  const token=++job;thread.value=deps.selected.value;turn.value='';busy.value=true;status.value='Requesting native inline review…'
  try{const result=await request('review/start',{threadId:thread.value,delivery:'inline',target}) as {reviewThreadId?:unknown;turn?:{id?:unknown}}
   if(token!==job||!busy.value)return
   if(result?.reviewThreadId!==thread.value||typeof result.turn?.id!=='string'||!result.turn.id)throw new Error('Unrecognized review acknowledgment; inspect native history.')
   turn.value=result.turn.id;status.value='Native review started. Results appear in the conversation.'
  }catch(e){if(token!==job)return;busy.value=false;const code=(e as {rpcCode?:number})?.rpcCode;status.value=code===-32601?'Dedicated review is unsupported by this App Server.':`${typeof code==='number'?'Review rejected.':'Review outcome unknown; inspect history before retrying.'} ${e instanceof Error?e.message:'Request failed'}`}
 }
 function observe(event:RpcNotification){
  if(!busy.value)return
  const params=event.params as Record<string,any>|null
  if(params?.threadId!==thread.value)return
  // The native entry marker supplies turn identity if it arrives before the reply.
  if(event.method==='item/started'&&params.item?.type==='enteredReviewMode'&&!turn.value)turn.value=String(params.turnId||'')
  if(event.method==='turn/completed'&&turn.value&&params.turn?.id===turn.value){busy.value=false;status.value=`Native review ${params.turn.status==='failed'?'failed':params.turn.status==='interrupted'?'interrupted':'completed'}.`}
 }
 async function cancel(){if(!selectedBusy.value||!turn.value)return;try{await deps.interrupt();status.value='Review interruption requested; waiting for native turn completion.'}catch(e){status.value='Interruption outcome unknown. '+(e instanceof Error?e.message:'Inspect native history.')}}
 return {kind,value,thread,turn,busy,selectedBusy,status,run,observe,cancel}
}
