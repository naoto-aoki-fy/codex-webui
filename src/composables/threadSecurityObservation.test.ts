import {expect,it} from 'vitest'
import {threadSecurity} from '../api/threadSecurity'
import {createThreadSecurityObservation} from './threadSecurityObservation'
it('projects only effective public security from resume and native settings payloads',()=>{
 expect(threadSecurity({model:'m'})).toBe(null)
 const value=threadSecurity({approvalPolicy:'on-request',sandbox:{type:'workspaceWrite',writableRoots:['/remote']},activePermissionProfile:{id:'workspace'},secret:'HIDDEN'})
 expect(value?.approval).toBe('on-request');expect(value?.sandbox).toContain('/remote');expect(JSON.stringify(value)).not.toContain('HIDDEN')
})
it('native settings events supersede in-flight resume reads and clear invalidates old connection results',()=>{
 const owner=createThreadSecurityObservation(),token=owner.revision('t')
 owner.observe({method:'thread/settings/updated',params:{threadId:'t',threadSettings:{approvalPolicy:'never',sandboxPolicy:{type:'readOnly'}}}})
 owner.accept('t',token,threadSecurity({approvalPolicy:'on-request'}));expect(owner.snapshots.value.t?.approval).toBe('never')
 const next=owner.revision('t');owner.clear();owner.accept('t',next,threadSecurity({approvalPolicy:'never'}));expect(owner.snapshots.value).toEqual({})
})
it('bounds snapshots and isolates identities without persisting configuration',()=>{
 const owner=createThreadSecurityObservation()
 for(let i=0;i<1000;i++)owner.observe({method:'thread/settings/updated',params:{threadId:String(i),threadSettings:{approvalPolicy:'on-request'}}})
 expect(Object.keys(owner.snapshots.value)).toHaveLength(100);expect(owner.snapshots.value['0']).toBeUndefined();expect(owner.snapshots.value['999']).toBeTruthy()
})
