import {rpcCall} from './codexRpcClient'
import {hookInspection,type InspectedHook} from './hooksInspection'
import {activeUserConfig,type UserConfigTarget} from './userConfigDefaults'
import {executionText} from './normalizers/executionDetails'
import {nativeWriteRejected,nativeWriteError} from './nativeWriteOutcome'
type Rpc=(method:string,params:unknown,options?:{configWriteErrors?:boolean})=>Promise<unknown>
type HookState={enabled:boolean|null;trustedHash:string|null}
export type HookPolicySnapshot={target:UserConfigTarget;states:Record<string,HookState>}
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}
export function hookPolicy(value:unknown,hooks:InspectedHook[]):HookPolicySnapshot{
 const target=activeUserConfig(value)
 if(!target)throw new Error('Native active user configuration identity unavailable')
 const layers=record(value).layers as unknown[]
 const matches=layers.map(record).filter(layer=>record(layer.name).file===target.filePath&&layer.version===target.version&&record(layer.name).profile===target.profile)
 // Older servers omit null profile fields in base-layer metadata.
 const layer=matches[0]??(target.profile===null?layers.map(record).find(layer=>record(layer.name).file===target.filePath&&layer.version===target.version&&record(layer.name).profile==null):undefined)
 if(!layer)throw new Error('Exact user configuration layer unavailable')
 const raw=record(record(record(layer.config).hooks).state),states:Record<string,HookState>={}
 for(const hook of hooks.slice(0,100)){if(!hook.editable)continue;const row=Object.prototype.hasOwnProperty.call(raw,hook.editable.key)?record(raw[hook.editable.key]):{};states[hook.editable.key]={enabled:typeof row.enabled==='boolean'?row.enabled:null,trustedHash:typeof row.trusted_hash==='string'?executionText(row.trusted_hash.slice(0,2000)):null}}
 return {target,states}
}
export async function readHookPolicy(hooks:InspectedHook[],request:Rpc=rpcCall){return hookPolicy(await request('config/read',{includeLayers:true}),hooks)}
export class HookPolicyError extends Error{constructor(message:string,readonly submitted:boolean){super(message)}}
export async function saveHookPolicy(threadId:string,snapshot:HookPolicySnapshot,hook:InspectedHook,action:'enable'|'disable'|'trust',request:Rpc=rpcCall){
 let submitted=false
 try{
  if(!hook.editable||!snapshot.states[hook.editable.key]||!['enable','disable','trust'].includes(action))throw new Error('This Hook cannot be managed safely here')
  const fresh=hookInspection(await request('hooks/list',{threadId})).groups.flatMap(group=>group.hooks).filter(row=>row.editable?.key===hook.editable!.key)
  if(fresh.length!==1||fresh[0]!.editable!.hash!==hook.editable.hash||fresh[0]!.editable!.source!==hook.editable.source)throw new Error('Loaded Hook definition changed. Read and review it again')
  const field=action==='trust'?'trusted_hash':'enabled',value=action==='trust'?hook.editable.hash:action==='enable'
  submitted=true
  const ack=record(await request('config/value/write',{keyPath:'hooks.state',value:{[hook.editable.key]:{[field]:value}},mergeStrategy:'upsert',filePath:snapshot.target.filePath,expectedVersion:snapshot.target.version},{configWriteErrors:true}))
  if(!['ok','okOverridden'].includes(String(ack.status))||typeof ack.version!=='string'||ack.filePath!==snapshot.target.filePath)throw new Error('Native saved-policy acknowledgment unavailable')
  const result=await readHookPolicy([hook],request),state=result.states[hook.editable.key]
  const expectedHash=hook.editable.hash.split('/')[0]
  if(result.target.filePath!==snapshot.target.filePath||!state||(action==='trust'?state.trustedHash!==expectedHash:state.enabled!==value))throw new Error('Saved Hook policy could not be verified')
  return result
 }catch(e){if(nativeWriteRejected(e))throw e;throw new HookPolicyError(nativeWriteError(e,'Hook policy unavailable'),submitted)}
}
