import {readBrowserRecord,updateBrowserRecord} from './browserTransactionalRecords'
import {profileStorageKey} from './browserConnectionProfile'
const key=()=>profileStorageKey('codex-web-local.queue-submissions.v1')
function validate(value:unknown):Record<string,string>{
 if(!value||typeof value!=='object'||Array.isArray(value)||JSON.stringify(value).length>90_000||Object.keys(value).length>20||Object.entries(value).some(([id,client])=>!id||id.length>2000||typeof client!=='string'||!client||client.length>2000))throw new Error('Queue recovery markers are unreadable; inspect native queue/history before clearing browser data')
 return value as Record<string,string>
}
function legacyReceipts():Record<string,string>{
 if(typeof window==='undefined')return {}
 const raw=window.localStorage.getItem(key())
 if(raw===null)return {}
 if(raw.length>90_000)throw new Error('Queue recovery markers exceed their bound; inspect native queue/history before clearing browser data')
 return validate(JSON.parse(raw))
}
// Recovery markers only: no prompt, attachment, executable input or replay logic.
export async function readQueueSubmissionReceipts():Promise<Record<string,string>>{
 return validate(await readBrowserRecord(key(),legacyReceipts))
}
export async function writeQueueSubmissionReceipt(threadId:string,clientId:string|null,expectedClientId?:string){
 if(!threadId||threadId.length>2000||clientId!==null&&(!clientId||clientId.length>2000))throw new Error('Queue submission identity unavailable')
 await updateBrowserRecord(key(),legacyReceipts,current=>{
  const receipts=validate(current)
  const own=Object.prototype.hasOwnProperty.call(receipts,threadId)
  if(clientId!==null&&own)throw new Error('Pending queue submission must be inspected before another submission')
  if(clientId===null&&expectedClientId!==undefined&&receipts[threadId]!==expectedClientId)return receipts
  if(clientId!==null){
   if(Object.keys(receipts).length>=20&&!own)throw new Error('Resolve pending queue submissions before submitting more')
   Object.defineProperty(receipts,threadId,{value:clientId,enumerable:true,configurable:true,writable:true})
  }else delete receipts[threadId]
  return receipts
 })
}
