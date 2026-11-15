import {computed,ref,watch,type Ref} from 'vue'
import {rpcCall,type RpcNotification} from '../api/codexRpcClient'
import {previewThreadDeletion,type DeletePreview,type DeleteRequest} from '../api/threadDeletion'
import {nativeWriteError,nativeWriteRejected} from '../api/nativeWriteOutcome'
export function createThreadDeletion(deps:{epoch:Ref<number>;selected:Ref<string>;ready:()=>boolean;blocked:()=>boolean},request:DeleteRequest=rpcCall){
 const state=ref<'idle'|'preparing'|'prepared'|'requesting'|'accepted'|'completed'|'rejected'|'unknown'>('idle'),preview=ref<DeletePreview|null>(null),thread=ref(''),status=ref('')
 const busy=computed(()=>state.value==='requesting'||state.value==='accepted'),blocking=computed(()=>busy.value||state.value==='unknown'),selectedBlocking=computed(()=>blocking.value&&thread.value===deps.selected.value)
 let job=0,ack=false,observed=false
 const stop=watch(deps.epoch,()=>{job++;preview.value=null;if(blocking.value){state.value='unknown';status.value='Connection changed during permanent deletion. Outcome unknown. No deletion will be replayed.'}else state.value='idle'},{flush:'sync'})
 const stopSelection=watch(deps.selected,()=>{if(!blocking.value&&state.value!=='completed'){job++;preview.value=null;state.value='idle'}},{flush:'sync'})
 function scoped(token:number,id:string):DeleteRequest{return(method,params)=>{if(token!==job||!deps.ready()||deps.selected.value!==id||deps.blocked())throw new Error('Connection, selection or activity changed; no further deletion request sent');return request(method,params)}}
 async function prepare(){if(blocking.value||state.value==='preparing'||!deps.ready()||deps.blocked())return;const id=deps.selected.value,token=++job;thread.value=id;preview.value=null;state.value='preparing';status.value='Reading exact native deletion scope…';try{const value=await previewThreadDeletion(id,scoped(token,id));if(token!==job||deps.selected.value!==id)return;preview.value=value;state.value='prepared';status.value='Review the irreversible native operation and type the exact conversation ID.'}catch(e){if(token===job){state.value='rejected';status.value=nativeWriteError(e)}}}
 function finish(){if(ack&&observed){state.value='completed';preview.value=null;status.value='Permanent native deletion completed: matching thread/deleted event observed.'}}
 async function run(typedId:string,confirmed:boolean,guard:()=>boolean=()=>true){const value=preview.value;if(!value||state.value!=='prepared'||typedId!==value.id||!confirmed||deps.selected.value!==value.id||deps.blocked()||!deps.ready()||!guard())return
  const id=value.id,token=++job;state.value='requesting';ack=false;observed=false;status.value='Rechecking native identity and child-agent scope…';let submitted=false
  try{const checked=await previewThreadDeletion(id,(method,params)=>{if(!guard())throw new Error('Deletion confirmation is no longer current');return scoped(token,id)(method,params)});if(token!==job)return;if(checked.cwd!==value.cwd||checked.name!==value.name||checked.forkedFrom!==value.forkedFrom)throw new Error('Native conversation identity changed. Inspect and confirm again.')
   if(!guard())throw new Error('Deletion confirmation is no longer current');const pending=scoped(token,id)('thread/delete',{threadId:id});submitted=true;status.value='Permanent native deletion requested…';await pending;if(token!==job)return;ack=true;state.value='accepted';status.value='Native deletion accepted; waiting for the matching thread/deleted event. Acknowledgment alone is not completion.';finish()
  }catch(e){if(token===job){state.value=!submitted||nativeWriteRejected(e)?'rejected':'unknown';status.value=`Permanent deletion ${state.value}. ${nativeWriteError(e)} No automatic retry.`;preview.value=null}}
 }
 function observe(event:RpcNotification){if(!busy.value||event.method!=='thread/deleted'||(event.params as {threadId?:unknown})?.threadId!==thread.value)return;observed=true;finish()}
 return {state,preview,thread,status,busy,blocking,selectedBlocking,prepare,run,observe,dispose:()=>{job++;stop();stopSelection()}}
}
export type ThreadDeletion=ReturnType<typeof createThreadDeletion>
