import {rpcCall} from './codexRpcClient'
import {buildTurnInput} from './turnInput'
import {nativeAppInputs} from './apps'
import type {SubmitPayload} from '../components/content/composerContracts'
export type QueueEntry={id:string;clientId:string;preview:string;input:Record<string,unknown>[]|null;text:string|null;types:string[]}
export function queueEntry(value:unknown):QueueEntry {
 const row=value as Record<string,unknown>
 if(!row||typeof row.id!=='string'||!row.id||row.id.length>2000||typeof row.clientUserMessageId!=='string'||!Array.isArray(row.input))throw new Error('Incompatible native queued submission')
 let size=0
 const input=row.input as Record<string,unknown>[]
 const safe=input.length<=64&&input.every(part=>{
  if(!part||typeof part!=='object'||!['text','image','localImage','skill','mention'].includes(String(part.type)))return false
  return Object.keys(part).length<=10&&Object.values(part).every(v=>{if(typeof v==='string'){size+=v.length;return v.length<=2_000_000&&size<=2_000_000}return v==null||typeof v==='boolean'||typeof v==='number'||Array.isArray(v)&&v.length===0})
 })
 const text=typeof input[0]?.text==='string'&&input[0]?.type==='text'&&(!Array.isArray(input[0].textElements)||input[0].textElements.length===0)&&(!Array.isArray(input[0].text_elements)||input[0].text_elements.length===0)?input[0].text:null
 return {id:row.id,clientId:row.clientUserMessageId.slice(0,2000),preview:(typeof text==='string'?text:'Text unavailable; structured input retained on server').slice(0,8000),input:safe?input:null,text:safe&&text!==null&&text.length<=32000?text:null,types:input.slice(0,64).map(p=>typeof p?.type==='string'?p.type.slice(0,80):'unknown')}
}
export function queuePage(value:unknown){const page=value as {data?:unknown[];nextCursor?:unknown}
 if(!Array.isArray(page?.data)||page.data.length>20||page.nextCursor!=null&&(typeof page.nextCursor!=='string'||page.nextCursor.length>4000))throw new Error('Incompatible native queue page')
 const rows=page.data.map(queueEntry)
 // Keep large attachments native; bounded previews remain useful without retaining their bytes.
 let retained=0
 for(const row of rows){if(row.input){for(const part of row.input)for(const v of Object.values(part))if(typeof v==='string')retained+=v.length;if(retained>2_000_000){row.input=null;row.text=null}}}
 return {rows,cursor:typeof page.nextCursor==='string'?page.nextCursor:null}
}
export function queuedInput(payload:SubmitPayload){const {input}=buildTurnInput(payload.text,payload.imageUrls,payload.skills,payload.fileAttachments);if(payload.apps?.length)input.push(...nativeAppInputs(payload.apps));return input}
export async function readQueue(threadId:string,cursor?:string){return queuePage(await rpcCall('thread/queue/list',{threadId,limit:20,...(cursor?{cursor}:{})}))}
