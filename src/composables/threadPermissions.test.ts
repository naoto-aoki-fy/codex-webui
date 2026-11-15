import {effectScope,ref,reactive} from 'vue'
import {expect,it,vi} from 'vitest'
import {threadSecurity,type ThreadSecurity} from '../api/threadSecurity'
import {permissionChoices,permissionPatch} from '../api/threadPermissions'
import {createThreadPermissions} from './threadPermissions'
const choices={approvals:['on-request','never'],sandboxes:['readOnly','workspaceWrite','dangerFullAccess']}
function setup(request:(...args:any[])=>Promise<any>){const epoch=ref(0),selected=ref('t'),snapshots=reactive<Record<string,ThreadSecurity|null>>({t:threadSecurity({approvalPolicy:'never',sandbox:{type:'dangerFullAccess'}})}),scope=effectScope();const owner=scope.run(()=>createThreadPermissions({epoch,selected,ready:()=>true,blocked:()=>false,snapshot:id=>snapshots[id]??null},request as any))!;return {owner,epoch,selected,snapshots,stop:()=>scope.stop()}}
const event={method:'thread/settings/updated',params:{threadId:'t'},atIso:'fixture'}
it('requires known native managed constraints and constructs only exact thread permission fields',()=>{
 expect(permissionChoices({})).toBe(null);expect(permissionChoices({requirements:{}})).toBe(null)
 expect(permissionChoices({requirements:{allowed_approval_policies:['on-request'],allowed_sandbox_modes:['read-only'],allowed_permission_profiles:null}})).toEqual({approvals:['on-request'],sandboxes:['readOnly']})
 expect(permissionChoices({requirements:{allowed_approval_policies:[],allowed_sandbox_modes:null,allowed_permission_profiles:{managed:true}}})).toEqual({approvals:[],sandboxes:[]})
 expect(permissionPatch('on-request','workspaceWrite')).toEqual({approvalPolicy:'on-request',sandboxPolicy:{type:'workspaceWrite',writableRoots:[],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true}});expect(()=>permissionPatch('invalid','')).toThrow()
})
it('waits for both acknowledgment and exact native effective observation, including event before response',async()=>{
 let release:()=>void=()=>{};const request=vi.fn(()=>new Promise<void>(r=>release=r)),{owner,snapshots,stop}=setup(request)
 const pending=owner.run('on-request','readOnly',choices);await owner.run('never','dangerFullAccess',choices);expect(request).toHaveBeenCalledOnce()
 snapshots.t=threadSecurity({approvalPolicy:'on-request',sandboxPolicy:{type:'readOnly',networkAccess:false}});owner.observe(event);expect(owner.state.value).toBe('requested');release();await pending;expect(owner.state.value).toBe('completed');stop()
})
it('does not accept unrelated or mismatched events and never retries uncertain writes',async()=>{
 const request=vi.fn(async()=>{throw new Error('reply lost')}),{owner,epoch,snapshots,stop}=setup(request)
 await owner.run('on-request','',choices);expect(owner.state.value).toBe('unknown');expect(owner.canReconcile.value).toBe(false)
 await owner.run('on-request','',choices);expect(request).toHaveBeenCalledOnce();epoch.value++;snapshots.t=threadSecurity({approvalPolicy:'on-request',sandbox:{type:'readOnly'}});expect(owner.canReconcile.value).toBe(true);owner.reconcile();expect(owner.state.value).toBe('completed');stop()
})
it('keeps rejection and connection-change unknown distinct and ignores late replies',async()=>{
 const {owner,stop}=setup(async()=>{throw Object.assign(new Error('managed restriction'),{rpcCode:-32600})});await owner.run('never','',choices);expect(owner.state.value).toBe('rejected');stop()
 let release:()=>void=()=>{};const s=setup(()=>new Promise<void>(r=>release=r));const pending=s.owner.run('never','',choices);s.epoch.value++;release();await pending;expect(s.owner.state.value).toBe('unknown');s.stop()
})
it('uses the operation thread snapshot after selection changes, never the replacement thread settings',async()=>{
 const {owner,selected,snapshots,stop}=setup(async()=>({}));await owner.run('on-request','',choices);selected.value='other';snapshots.other=threadSecurity({approvalPolicy:'on-request'});owner.observe(event);expect(owner.state.value).toBe('accepted');snapshots.t=threadSecurity({approvalPolicy:'on-request'});owner.observe(event);expect(owner.state.value).toBe('completed');stop()
})
it('holds an uncertain permission barrier on native internal errors too',async()=>{
 const {owner,stop}=setup(async()=>{throw Object.assign(new Error('persistence confirmation failed'),{rpcCode:-32603})});await owner.run('on-request','',choices);expect(owner.state.value).toBe('unknown');expect(owner.blocking.value).toBe(true);stop()
})
