import {computed,ref,watch,type Ref} from 'vue'
import {rpcCall,type RpcNotification} from '../api/codexRpcClient'
import {previewThreadDeletion,type DeletePreview,type DeleteRequest} from '../api/threadDeletion'
import {nativeWriteError} from '../api/nativeWriteOutcome'
export function createThreadDeletion(deps:{epoch:Ref<number>;selected:Ref<string>;ready:()=>boolean;blocked:()=>boolean},request:DeleteRequest=rpcCall){
 const state=ref<'idle'|'preparing'|'prepared'|'requesting'|'accepted'|'completed'|'rejected'|'unknown'>('idle'),preview=ref<DeletePreview|null>(null),thread=ref(''),status=ref('')
 const busy=computed(()=>state.value==='requesting'||state.value==='accepted'),blocking=computed(()=>busy.value||state.value==='unknown'),selectedBlocking=computed(()=>blocking.value&&thread.value===deps.selected.value)
 let job=0
 const stop=watch(deps.epoch,()=>{job++;preview.value=null;if(blocking.value){state.value='unknown';status.value='Connection changed during permanent deletion. Outcome unknown. No deletion will be replayed.'}else state.value='idle'},{flush:'sync'})
 const stopSelection=watch(deps.selected,()=>{if(!blocking.value&&state.value!=='completed'){job++;preview.value=null;state.value='idle'}},{flush:'sync'})
 function scoped(token:number,id:string):DeleteRequest{return(method,params)=>{if(token!==job||!deps.ready()||deps.selected.value!==id||deps.blocked())throw new Error('Connection, selection or activity changed; no further deletion request sent');return request(method,params)}}
 async function prepare(expectedId=deps.selected.value){if(expectedId!==deps.selected.value||blocking.value||state.value==='preparing'||!deps.ready()||deps.blocked())return;const id=expectedId,token=++job;thread.value=id;preview.value=null;state.value='preparing';status.value='Reading exact native deletion scope…';try{const value=await previewThreadDeletion(id,scoped(token,id));if(token!==job||deps.selected.value!==id)return;preview.value=value;state.value='prepared';status.value='Inspection only. Permanent deletion is unavailable: the native contract cannot atomically exclude descendants.'}catch(e){if(token===job){state.value='rejected';status.value=nativeWriteError(e)}}}
 // Verified 0.169.0 ThreadDeleteParams accepts only threadId and the native
 // processor deletes its current subtree. No execution-time leaf-only condition
 // exists. Keep this controller non-mutating even when called outside the UI.
 async function run(_typedId:string,_confirmed:boolean,_guard:()=>boolean=()=>true){
  status.value='Permanent deletion is unavailable: the native contract cannot atomically exclude descendants. Use archive to hide a conversation.'
 }
 function observe(_event:RpcNotification){}

 return {state,preview,thread,status,busy,blocking,selectedBlocking,prepare,run,observe,dispose:()=>{job++;stop();stopSelection()}}
}
export type ThreadDeletion=ReturnType<typeof createThreadDeletion>
