import {computed,ref,watch,type Ref} from 'vue'
import {rpcCall,type RpcNotification} from '../api/codexRpcClient'
import {prepareAuthentication,readAuthenticationAccount,nativeLogin,type AuthPreparation,type NativeAccount,type LoginMethod,type AuthRequest} from '../api/nativeAuthentication'
import {nativeWriteError,nativeWriteRejected} from '../api/nativeWriteOutcome'
export function createNativeAuthentication(deps:{epoch:Ref<number>;ready:()=>boolean;blocked:()=>boolean;reconnectAndReload:()=>Promise<void>;initiallyUncertain?:boolean;holdAccountState?:()=>void;releaseAccountState?:()=>void},request:AuthRequest=rpcCall){
 const state=ref<'idle'|'preparing'|'prepared'|'starting'|'waiting'|'settling'|'canceling'|'completed'|'canceled'|'failed'|'rejected'|'unknown'>('idle'),status=ref(''),preparation=ref<AuthPreparation|null>(null),account=ref<NativeAccount|null>(null),url=ref(''),code=ref<string|null>(null),loginId=ref(''),needsRefresh=ref(false),resetting=ref(false),inspecting=ref(false)
 const active=computed(()=>['starting','waiting','settling','canceling'].includes(state.value))
 const connected=computed(()=>deps.ready())
 const blocking=computed(()=>active.value||needsRefresh.value||state.value==='unknown'||resetting.value)
 let job=0,cancelRequested=false,settling=false,sessionEpoch=-1
 if(deps.initiallyUncertain){state.value='unknown';needsRefresh.value=true;status.value='An earlier native authentication operation or account change needs reconciliation. Inspect the current account, then reconnect and reload. No login is replayed.'}
 const early=new Map<string,{success:boolean;error:string}>()
 function clearCredentials(){url.value='';code.value=null}
 const stop=watch(deps.epoch,()=>{job++;clearCredentials();preparation.value=null;account.value=null;loginId.value='';early.clear();inspecting.value=false
  if(resetting.value)return
  if(active.value||blocking.value){state.value='unknown';needsRefresh.value=true;status.value='Connection changed during native authentication. Outcome unknown; inspect the original App Server. No login was replayed.'}else state.value='idle'
 },{flush:'sync'})
 function scoped(token:number,checkWork=false):AuthRequest{return (method,params)=>{if(token!==job||!deps.ready()||checkWork&&deps.blocked())throw new Error('Connection changed or work became active; no further authentication request sent');return request(method,params)}}
 async function prepare(){if(blocking.value||state.value==='preparing'||!deps.ready()||deps.blocked())return;const token=++job;state.value='preparing';status.value='Reading native account, login policy and bounded loaded-thread activity…';preparation.value=null;account.value=null;early.clear();clearCredentials();loginId.value=''
  try{const value=await prepareAuthentication(scoped(token,true));if(token!==job)return;preparation.value=value;account.value=value.account;state.value='prepared';status.value='Native signed-out account and idle loaded-thread inventory verified. Review and confirm before sign-in.'}
  catch(e){if(token===job){state.value='rejected';status.value=nativeWriteError(e,'Authentication preparation unavailable')}}
 }
 async function settle(result:{success:boolean;error:string},token:number){
  if(settling||token!==job)return;settling=true;state.value='settling';clearCredentials();status.value='Native login completed; reading actual account state…'
  try{const current=await readAuthenticationAccount(scoped(token));if(token!==job)return;account.value=current;loginId.value='';early.clear();needsRefresh.value=result.success||current.type!=='signedOut'
   state.value=result.success&&current.type==='chatgpt'?'completed':result.success?'unknown':'failed'
   status.value=state.value==='completed'?'Native sign-in completed and ChatGPT account state verified. Reconnect and reload to invalidate account caches.':result.success?'Native completion succeeded but expected account state is unconfirmed. Inspect before continuing.':`Native sign-in failed. ${result.error||'No error detail supplied.'}`
  }catch(e){if(token===job){state.value='unknown';needsRefresh.value=true;status.value=`Native authentication outcome unknown. ${nativeWriteError(e)} Inspect the account; no replay.`}}
  finally{settling=false}
 }
 async function start(method:LoginMethod,confirmed:boolean){
  if(!confirmed||state.value!=='prepared'||!preparation.value||!['chatgpt','chatgptDeviceCode'].includes(method)||deps.blocked()||!deps.ready())return
  const token=++job;state.value='starting';status.value='Rechecking native account/activity before sign-in…';cancelRequested=false;settling=false;needsRefresh.value=false;let submitted=false
  try{await prepareAuthentication(scoped(token,true));if(token!==job)return;deps.holdAccountState?.();status.value='Requesting native App Server sign-in…';const pending=scoped(token,true)('account/login/start',{type:method});submitted=true;const result=await pending;if(token!==job)return
   const row=result as Record<string,unknown>;if(typeof row?.loginId==='string'&&row.loginId.length<=2000){loginId.value=row.loginId;sessionEpoch=deps.epoch.value}
   const completed=early.get(loginId.value);if(completed){await settle(completed,token);return}
   if(cancelRequested&&loginId.value){state.value='waiting';await cancel();return}
   const login=nativeLogin(result,method);loginId.value=login.id;url.value=login.url;code.value=login.code;sessionEpoch=deps.epoch.value;state.value='waiting';status.value='Native sign-in accepted; waiting for its matching completion event. Expiry is controlled by the App Server.'
  }catch(e){if(token===job){clearCredentials();state.value=!submitted||nativeWriteRejected(e)?'rejected':'unknown';needsRefresh.value=state.value==='unknown';if(state.value==='rejected')try{deps.releaseAccountState?.()}catch{state.value='unknown';needsRefresh.value=true}status.value=`Native sign-in ${state.value}. ${nativeWriteError(e)} No automatic retry.`}}
 }
 async function cancel(){
  if(!deps.ready()||state.value==='canceling'||state.value==='settling')return
  if(state.value==='starting'&&!loginId.value){cancelRequested=true;status.value='Cancellation requested; waiting for the native login identity before canceling it.';return}
  if(!loginId.value||sessionEpoch!==deps.epoch.value)return
  const token=++job,id=loginId.value;state.value='canceling';clearCredentials();status.value='Requesting cancellation of this exact native login…'
  try{const result=await scoped(token)('account/login/cancel',{loginId:id}) as {status?:unknown};if(token!==job)return
   const completed=early.get(id);if(completed){await settle(completed,token);return}
   const current=await readAuthenticationAccount(scoped(token));if(token!==job)return;account.value=current;loginId.value='';early.clear();needsRefresh.value=current.type!=='signedOut'||result.status!=='canceled';state.value=result.status==='canceled'?'canceled':'unknown';status.value=result.status==='canceled'?'Native login cancellation acknowledged; actual account state read.':'Native login was not found; cancellation/completion outcome is unknown. Inspect account state.'
   if(current.type!=='signedOut'){state.value='unknown';status.value='Cancellation acknowledged, but native account state changed. Sign-in may have completed; inspect and refresh account data.'}
   if(!needsRefresh.value)deps.releaseAccountState?.()
  }catch(e){if(token===job){state.value='unknown';needsRefresh.value=true;status.value=`Native cancellation outcome unknown. ${nativeWriteError(e)} No automatic retry.`}}
 }
 function observe(event:RpcNotification){
  if(event.method==='account/updated'){
   job++;preparation.value=null;account.value=null;loginId.value='';early.clear();clearCredentials();inspecting.value=false
   state.value='unknown';needsRefresh.value=true;status.value='Native account changed. Earlier account reads and sign-in preparation are invalid. Inspect the current account, then reconnect and reload; no retry performed.'
   try{deps.holdAccountState?.()}catch{status.value+=' Browser recovery storage is unavailable; keep sending paused and reconnect/reload explicitly.'}
   return
  }
  if(event.method!=='account/login/completed'||!active.value)return
  const p=event.params as Record<string,unknown>
  if(typeof p?.loginId!=='string'||p.loginId.length>2000||typeof p.success!=='boolean')return
  const result={success:p.success,error:typeof p.error==='string'?nativeWriteError(new Error(p.error)):''}
  if(!loginId.value){if(early.size===4)early.delete(early.keys().next().value!);early.set(p.loginId,result)}
  else if(p.loginId===loginId.value){if(state.value==='canceling')early.set(p.loginId,result);else void settle(result,job)}
 }
 async function inspect(){if(inspecting.value||!deps.ready())return;const token=job;inspecting.value=true;try{const current=await readAuthenticationAccount(scoped(token));if(token===job)account.value=current}catch(e){if(token===job)status.value=nativeWriteError(e)}finally{if(token===job)inspecting.value=false}}
 async function refreshConnection(acknowledgeUnknown=false){if(resetting.value||!deps.ready()||!account.value||!needsRefresh.value&&state.value!=='unknown'||state.value==='unknown'&&!acknowledgeUnknown)return;resetting.value=true;clearCredentials();try{await deps.reconnectAndReload()}catch(e){resetting.value=false;state.value='unknown';needsRefresh.value=true;status.value=`Connection refresh failed. ${nativeWriteError(e)}`}}
 function dispose(){job++;stop();clearCredentials();loginId.value='';early.clear()}
 return {state,status,preparation,account,url,code,loginId,needsRefresh,resetting,inspecting,active,blocking,connected,prepare,start,cancel,observe,inspect,refreshConnection,dispose}
}
export type NativeAuthentication=ReturnType<typeof createNativeAuthentication>
