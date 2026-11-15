import {ref} from 'vue'
import {executionText} from '../api/normalizers/executionDetails'
export type DeniedAction={threadId:string;turnId:string;reviewId:string;targetId:string|null;action:string;risk:string;observed:string}
export function createDeniedActionObservation(){
 const rows=ref<DeniedAction[]>([])
 function observe(notification:{method:string;params:unknown;atIso:string}){
  if(notification.method!=='item/autoApprovalReview/completed')return
  const p=notification.params as Record<string,unknown>,review=p?.review as Record<string,unknown>
  if(!p||!review||![p.threadId,p.turnId,p.reviewId].every(v=>typeof v==='string'&&v.length>0&&v.length<=2000))return
  const retained=rows.value.filter(row=>row.threadId!==p.threadId||row.reviewId!==p.reviewId)
  if(review.status!=='denied'){rows.value=retained;return}
  rows.value=[...retained.slice(-49),{threadId:p.threadId as string,turnId:p.turnId as string,reviewId:p.reviewId as string,targetId:typeof p.targetItemId==='string'?p.targetItemId.slice(0,2000):null,action:p.action==null?'Unavailable':executionText(p.action),risk:executionText(review.riskLevel??'Unknown'),observed:notification.atIso.slice(0,100)}]
 }
 function clear(){rows.value=[]}
 return {rows,observe,clear}
}
