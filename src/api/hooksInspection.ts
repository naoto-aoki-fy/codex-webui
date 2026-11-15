import {rpcCall} from './codexRpcClient'
import {executionText} from './normalizers/executionDetails'
export type InspectedHook={key:string;event:string;definition:string;origin:string;trust:string;enabled:boolean|null;managed:boolean|null;hash:string;editable:{key:string;hash:string;source:string}|null}
export function hookInspection(value:unknown){
 const result=value as {data?:Record<string,unknown>[]}
 if(!Array.isArray(result?.data)||result.data.length>20)throw new Error('Incompatible native Hooks response')
 let truncated=false,remaining=100
 const groups=result.data.map(entry=>{
  if(!Array.isArray(entry.hooks))throw new Error('Native Hook definitions unavailable')
  if(entry.hooks.length>remaining)truncated=true
  const hooks:InspectedHook[]=entry.hooks.slice(0,remaining).map((value:unknown)=>{
   const row=value as Record<string,unknown>
   if(!row||typeof row.key!=='string')throw new Error('Native Hook identity unavailable')
   const text=(v:unknown)=>executionText(v??'Unavailable')
   const supportedDefinition=row.handlerType==='command'&&typeof row.command==='string'&&row.command.length<=4000||row.handlerType==='mcpTool'&&typeof row.server==='string'&&typeof row.tool==='string'
   const editable=supportedDefinition&&row.isManaged===false&&['user','project'].includes(String(row.source))&&row.key.length<=2000&&/:\w+:\d+:\d+$/.test(row.key)&&typeof row.currentHash==='string'&&!!row.currentHash&&row.currentHash.length<=1000&&text(row.key)===row.key&&text(row.currentHash)===row.currentHash&&!/[\x00-\x1f]/.test(row.key+row.currentHash)?{key:row.key,hash:row.currentHash,source:String(row.source)}:null
   return {key:text(row.key),event:text(row.eventName),definition:executionText({handlerType:row.handlerType,command:typeof row.command==='string'?row.command.slice(0,4000):undefined,async:row.async,server:row.server,tool:row.tool,matcher:row.matcher,timeoutSec:row.timeoutSec,statusMessage:row.statusMessage}),origin:executionText({source:row.source,path:row.sourcePath,plugin:row.pluginId,environment:row.environmentId}),trust:text(row.trustStatus),enabled:typeof row.enabled==='boolean'?row.enabled:null,managed:typeof row.isManaged==='boolean'?row.isManaged:null,hash:text(row.currentHash),editable}
  });remaining-=hooks.length
  const warnings=Array.isArray(entry.warnings)?entry.warnings.slice(0,10).map(v=>executionText(v).slice(0,1000)):[]
  const errors=Array.isArray(entry.errors)?entry.errors.slice(0,10).map(v=>{const row=v as Record<string,unknown>;return executionText({path:row?.path,message:row?.message}).slice(0,1000)}):[]
  return {cwd:executionText(entry.cwd??'Unavailable').slice(0,2000),hooks,warnings,errors}
 })
 return {groups,truncated}
}
export async function readHooks(threadId:string){return hookInspection(await rpcCall('hooks/list',{threadId}))}
