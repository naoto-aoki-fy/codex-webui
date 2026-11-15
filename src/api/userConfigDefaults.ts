import {rpcCall} from './codexRpcClient'
export type UserConfigTarget={filePath:string;version:string;profile:string|null;model:string|null;effort:string|null}
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}
export function activeUserConfig(value:unknown):UserConfigTarget|null{
 const layers=record(value).layers
 if(!Array.isArray(layers)||layers.length>100)return null
 const users=layers.map(record).filter(layer=>record(layer.name).type==='user'&&!layer.disabledReason)
 const profiles=users.filter(layer=>typeof record(layer.name).profile==='string')
 const candidates=profiles.length?profiles:users.filter(layer=>record(layer.name).profile==null)
 if(candidates.length!==1)return null
 const layer=candidates[0]!,name=record(layer.name),config=record(layer.config)
 if(typeof name.file!=='string'||!name.file||name.file.length>4000||typeof layer.version!=='string'||!layer.version||layer.version.length>4000)return null
 return {filePath:name.file,version:layer.version,profile:typeof name.profile==='string'?name.profile:null,model:typeof config.model==='string'?config.model.slice(0,200):null,effort:typeof config.model_reasoning_effort==='string'?config.model_reasoning_effort.slice(0,100):null}
}
export async function saveUserModelDefault(target:UserConfigTarget,field:'model'|'model_reasoning_effort',value:string){
 if(!target.filePath||!target.version||!['model','model_reasoning_effort'].includes(field))throw new Error('Read the exact active user configuration before editing')
 if(field==='model'?!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value):!['low','medium','high'].includes(value))throw new Error('Select a supported model identifier or reasoning default')
 const result=await rpcCall<{status?:unknown;version?:unknown;filePath?:unknown}>('config/value/write',{keyPath:field,value,mergeStrategy:'upsert',filePath:target.filePath,expectedVersion:target.version},{configWriteErrors:true})
 if(!['ok','okOverridden'].includes(String(result?.status))||typeof result.version!=='string'||!result.version||result.filePath!==target.filePath)throw new Error('Configuration acknowledgment identity unavailable; saved outcome unknown. Read before retrying.')
 return {version:result.version,overridden:result.status==='okOverridden'}
}
