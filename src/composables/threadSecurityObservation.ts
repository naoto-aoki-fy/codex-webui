import {ref} from 'vue'
import {threadSecurity,type ThreadSecurity} from '../api/threadSecurity'
export function createThreadSecurityObservation(){
 const snapshots=ref<Record<string,ThreadSecurity>>({})
 let serial=0
 function revision(_id:string){return serial}
 function accept(id:string,token:number,value:ThreadSecurity|null){
  if(!id||!value||token!==revision(id))return
  const rows=Object.entries(snapshots.value).filter(([key])=>key!==id).slice(-99)
  snapshots.value=Object.fromEntries([...rows,[id,value]])
 }
 function observe(notification:{method:string;params:unknown}){
  if(notification.method!=='thread/settings/updated')return
  const row=notification.params as Record<string,unknown>
  if(typeof row?.threadId!=='string'||!row.threadId||row.threadId.length>2000)return
  serial++
  accept(row.threadId,revision(row.threadId),threadSecurity(row.threadSettings))
 }
 function clear(){serial++;snapshots.value={}}
 return {snapshots,revision,accept,observe,clear}
}
