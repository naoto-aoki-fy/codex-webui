import {withBrowserStorageLock} from './browserStorageLock'
import {profileStorageKey} from './browserConnectionProfile'

// Recovery markers only: no prompt, attachment, executable input or replay logic.
export function readQueueSubmissionReceipts():Record<string,string>{
 if(typeof window==='undefined')return {}
 const raw=window.localStorage.getItem(profileStorageKey('codex-web-local.queue-submissions.v1'))
 if(raw===null)return {}
 if(raw.length>90_000)throw new Error('Queue recovery markers exceed their bound; inspect native queue/history before clearing browser data')
 const value:unknown=JSON.parse(raw)
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>20||Object.entries(value).some(([id,client])=>!id||id.length>2000||typeof client!=='string'||!client||client.length>2000))throw new Error('Queue recovery markers are unreadable; inspect native queue/history before clearing browser data')
 return value as Record<string,string>
}
export async function writeQueueSubmissionReceipt(threadId:string,clientId:string|null,expectedClientId?:string){
 // Node-only callers have no browser recovery state. Real browsers fail closed
 // if storage or both lock facilities are unavailable.
 if(typeof window==='undefined')return
 return withBrowserStorageLock(profileStorageKey('codex-web-local.queue-submissions.v1'),()=>{
 if(!threadId||threadId.length>2000||clientId!==null&&(!clientId||clientId.length>2000))throw new Error('Queue submission identity unavailable')
 const receipts=readQueueSubmissionReceipts()
 if(clientId!==null&&receipts[threadId])throw new Error('Pending queue submission must be inspected before another submission')
 if(clientId===null&&expectedClientId!==undefined&&receipts[threadId]!==expectedClientId)return
 if(clientId!==null){
  if(Object.keys(receipts).length>=20&&!Object.prototype.hasOwnProperty.call(receipts,threadId))throw new Error('Resolve pending queue submissions before submitting more')
  Object.defineProperty(receipts,threadId,{value:clientId,enumerable:true,configurable:true,writable:true})
 }else delete receipts[threadId]
 if(typeof window!=='undefined')window.localStorage.setItem(profileStorageKey('codex-web-local.queue-submissions.v1'),JSON.stringify(receipts))
 })
}
