import {rpcCall} from './codexRpcClient'
import {executionText} from './normalizers/executionDetails'
import {activeUserConfig} from './userConfigDefaults'
const settings=['model','model_provider','model_reasoning_effort','approval_policy','approvals_reviewer','sandbox_mode','permissions','profile','personality','service_tier','plan_mode_reasoning_effort'] as const
const restrictions=['model_provider','allowed_approval_policies','allowed_approvals_reviewers','allowed_sandbox_modes','allowed_permission_profiles','default_permissions','allowed_login_methods','allow_managed_hooks_only','allow_login_shell'] as const
function record(v:unknown):Record<string,unknown>{return v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}}
function hasOwn(value:object,key:PropertyKey){return Object.prototype.hasOwnProperty.call(value,key)}
function projection(value:unknown,keys:readonly string[]){const row=record(value);return Object.fromEntries(keys.filter(k=>hasOwn(row,k)).map(k=>[k,executionText(row[k])]))}
export function layerIdentity(value:unknown){const row=record(value);return executionText(Object.fromEntries(['type','file','profile','dotCodexFolder','domain','key','id','name'].filter(k=>hasOwn(row,k)).map(k=>[k,row[k]])))}
export function configInspection(value:unknown){
 const result=record(value)
 if(!result.config||typeof result.config!=='object'||Array.isArray(result.config))throw new Error('Effective configuration unavailable')
 if(result.layers!=null&&!Array.isArray(result.layers))throw new Error('Incompatible configuration layers')
 const origins=record(result.origins)
 const effective=Object.entries(projection(result.config,settings)).map(([key,value])=>({key,value,origin:hasOwn(origins,key)?layerIdentity(record(origins[key]).name):'Unavailable'}))
 const profiles=new Map<string,Record<string,string>>()
 let profilesBounded=false
 function addProfile(name:string,value:unknown){
  const key=executionText(name).slice(0,200)
  // Native layers are ordered from highest to lowest priority. Retain the
  // first public definition, and bound the total across all layers.
  if(profiles.has(key))return
  if(profiles.size>=100){profilesBounded=true;return}
  profiles.set(key,projection(value,settings))
 }
 const layers=(Array.isArray(result.layers)?result.layers:[]).slice(0,40).map(value=>{
  const row=record(value),name=record(row.name),config=record(row.config)
  if(name.type==='user'&&name.profile==null){const candidates=record(config.profiles);let count=0;for(const key in candidates){if(!hasOwn(candidates,key))continue;if(++count>100){profilesBounded=true;break}addProfile(key,candidates[key])}}
  if(name.type==='user'&&typeof name.profile==='string')addProfile(name.profile,config)
  return {identity:layerIdentity(name),version:typeof row.version==='string'?row.version.slice(0,1000):'Unavailable',disabled:row.disabledReason==null?null:executionText(row.disabledReason),settings:projection(config,settings)}
 })
 return {effective,layers,layersAvailable:Array.isArray(result.layers),profiles:[...profiles].map(([name,settings])=>({name,settings})),profilesBounded,bounded:Array.isArray(result.layers)&&result.layers.length>40,userTarget:activeUserConfig(value)}
}
export function requirementsInspection(value:unknown){const result=record(value)
 if(!hasOwn(result,'requirements')||result.requirements!=null&&(typeof result.requirements!=='object'||Array.isArray(result.requirements)))throw new Error('Managed restrictions unavailable')
 return result.requirements===null?null:projection(result.requirements,restrictions)
}
export async function readConfiguration(cwd:string){return configInspection(await rpcCall('config/read',{cwd,includeLayers:true}))}
export async function readConfigRestrictions(){return requirementsInspection(await rpcCall('configRequirements/read',{}))}
