import {rpcCall} from './codexRpcClient'
import {executionText} from './normalizers/executionDetails'
export function daybreakPreference(value:unknown,id:string){const row=(value as {thread?:Record<string,unknown>})?.thread
 if(row?.id!==id)throw new Error('Native Daybreak thread identity unavailable')
 if(!Object.prototype.hasOwnProperty.call(row,'daybreakEnabled'))return 'unavailable' as const
 if(row.daybreakEnabled===null)return 'unset' as const
 if(typeof row.daybreakEnabled!=='boolean')throw new Error('Incompatible native Daybreak preference')
 return row.daybreakEnabled?'enabled' as const:'disabled' as const
}
export function accessProgramPage(value:unknown){const result=value as {data?:Record<string,unknown>[];nextCursor?:unknown}
 if(!Array.isArray(result?.data)||result.data.length>20||result.nextCursor!=null&&(typeof result.nextCursor!=='string'||result.nextCursor.length>4000))throw new Error('Incompatible native access-program catalog')
 const rows=result.data.map(row=>{
  if(typeof row?.id!=='string'||!row.id||row.id.length>1000)throw new Error('Native model identity unavailable')
  const programs=(row.availableAccessPrograms as {cyber?:unknown}|null)?.cyber
  if(programs!=null&&(!Array.isArray(programs)||programs.length>20||programs.some(p=>typeof p!=='string'||p.length>100)))throw new Error('Incompatible native cyber programs')
  return {id:executionText(row.id),programs:Array.isArray(programs)?programs.map(v=>executionText(v)):null}
 })
 return {rows,cursor:typeof result.nextCursor==='string'?result.nextCursor:null}
}
export async function readDaybreakPreference(id:string){return daybreakPreference(await rpcCall('thread/read',{threadId:id,includeTurns:false}),id)}
export async function readAccessPrograms(cursor?:string){return accessProgramPage(await rpcCall('model/list',{includeHidden:false,limit:20,...(cursor?{cursor}:{})}))}
