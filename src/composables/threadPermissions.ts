import {computed,ref,watch,type Ref} from 'vue'
import {rpcCall,type RpcNotification} from '../api/codexRpcClient'
import type {ThreadSecurity} from '../api/threadSecurity'
import {permissionPatch,type PermissionChoices} from '../api/threadPermissions'
import {nativeWriteRejected,nativeWriteError} from '../api/nativeWriteOutcome'
export function createThreadPermissions(deps:{epoch:Ref<number>;selected:Ref<string>;blocked:()=>boolean;ready:()=>boolean;snapshot:(id:string)=>ThreadSecurity|null},request:typeof rpcCall=rpcCall){
 const thread=ref(''),state=ref<'idle'|'requested'|'accepted'|'completed'|'rejected'|'unknown'>('idle'),status=ref('')
 const busy=computed(()=>state.value==='requested'||state.value==='accepted')
 const blocking=computed(()=>(busy.value||state.value==='unknown')&&thread.value===deps.selected.value)
 let job=0,ack=false,observed=false,approval='',sandbox='',before:ThreadSecurity|null=null
 const canReconcile=computed(()=>['unknown','accepted'].includes(state.value)&&thread.value===deps.selected.value&&!!deps.snapshot(thread.value)&&deps.snapshot(thread.value)!==before)
 watch(deps.epoch,()=>{job++;if(busy.value){state.value='unknown';status.value='Connection changed during permission update. Outcome unknown; inspect fresh native settings. No retry performed.'}},{flush:'sync'})
 function matches(snapshot:ThreadSecurity|null){return !!snapshot&&(!approval||snapshot.approvalMode===approval)&&(!sandbox||snapshot.sandboxChoice===sandbox)}
 function finish(){if(ack&&observed){state.value='completed';status.value='Completed: matching effective native thread settings observed. Other conversations and global defaults were not changed.'}}
 async function run(nextApproval:string,nextSandbox:string,choices:PermissionChoices|null){
  if(busy.value||state.value==='unknown'||deps.blocked()||!deps.ready()||!deps.snapshot(deps.selected.value)||!choices)return
  if(nextApproval&&!choices.approvals.includes(nextApproval)||nextSandbox&&!choices.sandboxes.includes(nextSandbox))return
  const patch=permissionPatch(nextApproval,nextSandbox),token=++job;thread.value=deps.selected.value;before=deps.snapshot(thread.value);approval=nextApproval;sandbox=nextSandbox;ack=false;observed=false;state.value='requested';status.value='Requesting native thread permission update…'
  try{await request('thread/settings/update',{threadId:thread.value,...patch});if(token!==job)return;ack=true;if(state.value==='requested')state.value='accepted';status.value='Accepted; waiting for matching effective native settings.';finish()}
  catch(e){if(token!==job)return;state.value=nativeWriteRejected(e)?'rejected':'unknown';status.value=`Permission update ${state.value}. ${nativeWriteError(e)} No automatic retry.`}
 }
 function observe(event:RpcNotification){const p=event.params as {threadId?:unknown}|null;if(!busy.value||event.method!=='thread/settings/updated'||p?.threadId!==thread.value)return;observed=matches(deps.snapshot(thread.value));finish()}
 function reconcile(){if(!canReconcile.value)return;if(matches(deps.snapshot(thread.value))){state.value='completed';status.value='Reconciled: requested effective native settings are now observed.'}else{state.value='rejected';status.value='Fresh observed settings differ from the request. Review the current state before a new explicit change.'}}
 return {thread,state,status,busy,blocking,canReconcile,run,observe,reconcile}
}
