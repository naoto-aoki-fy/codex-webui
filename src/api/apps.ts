import {rpcCall} from './codexRpcClient'
export type AppReference={id:string;name:string}
export type AvailableApp=AppReference&{accessible:boolean;enabled:boolean}
export function appPage(value:unknown):{data:AvailableApp[];nextCursor:string|null}{const row=value as Record<string,unknown>
 if(!Array.isArray(row?.data)||row.data.length>100||(row.nextCursor!=null&&typeof row.nextCursor!=='string'))throw new Error('Incompatible Apps list')
 return {data:row.data.map(v=>{const app=v as Record<string,unknown>;if(typeof app?.id!=='string'||!app.id||app.id.length>512||/[\s\x00-\x1f]/.test(app.id)||typeof app.name!=='string')throw new Error('Invalid App identity');return {id:app.id,name:app.name.slice(0,300),accessible:app.isAccessible===true,enabled:app.isEnabled===true}}),nextCursor:row.nextCursor as string|null??null}
}
export async function listAvailableApps(threadId:string,cursor:string|null){return appPage(await rpcCall('app/list',{threadId,cursor,limit:50,forceRefetch:false}))}
export function nativeAppInputs(apps:AppReference[]){
 if(apps.length>20)throw new Error('At most 20 App references are supported per prompt.')
 return [...new Map(apps.map(app=>[app.id,app])).values()].map(app=>{
  if(!app.id||app.id.length>512||/[\s\x00-\x1f]/.test(app.id)||!app.name)throw new Error('Invalid App reference')
  return {type:'mention',name:app.name,path:`app://${app.id}`}
 })
}
