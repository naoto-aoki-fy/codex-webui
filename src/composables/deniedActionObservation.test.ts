import {expect,it} from 'vitest'
import {createDeniedActionObservation} from './deniedActionObservation'
const event=(reviewId='r',status='denied')=>({method:'item/autoApprovalReview/completed',atIso:'fixture',params:{threadId:'t',turnId:'turn',reviewId,targetItemId:'item',review:{status,riskLevel:'high'},action:{type:'command',command:'echo <script> token=SECRET',internalInstructions:'HIDDEN'}}})
it('retains exact native identities without storing credentials or reconstructing retry payloads',()=>{
 const owner=createDeniedActionObservation();owner.observe(event());expect(owner.rows.value[0]).toMatchObject({threadId:'t',turnId:'turn',reviewId:'r',targetId:'item'})
 expect(JSON.stringify(owner.rows.value)).not.toMatch(/SECRET|HIDDEN/);owner.observe(event());expect(owner.rows.value).toHaveLength(1);owner.observe(event('r','approved'));expect(owner.rows.value).toEqual([])
})
it('bounds transient native observations and clears connection state',()=>{
 const owner=createDeniedActionObservation();for(let i=0;i<1000;i++)owner.observe(event(String(i)))
 expect(owner.rows.value).toHaveLength(50);owner.clear();expect(owner.rows.value).toEqual([])
})
it('ignores malformed and unrelated events',()=>{const owner=createDeniedActionObservation();owner.observe({method:'item/autoApprovalReview/completed',atIso:'x',params:{}});owner.observe({...event(),method:'item/completed'});expect(owner.rows.value).toEqual([])})
