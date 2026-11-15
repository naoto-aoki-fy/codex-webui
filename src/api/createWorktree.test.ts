import {execFileSync} from 'node:child_process'
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,expect,it} from 'vitest'
import {createRemoteWorktree,planWorktree,parseWorktrees,verifyCreatedWorktree,WorktreeOutcomeError} from './createWorktree'
const roots:string[]=[]
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function fixture(){const base=mkdtempSync(join(tmpdir(),'risk-worktree-'));roots.push(base);const repo=join(base,'source');execFileSync('git',['init','-q',repo]);const git=(...args:string[])=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']});writeFileSync(join(repo,'file'),'committed');git('add','file');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');const calls:any[]=[]
 const rpc=async(method:string,value:unknown)=>{const p=value as any;calls.push(p);expect(method).toBe('command/exec');expect(p.command[0]).toBe('git');try{return {exitCode:0,stdout:execFileSync(p.command[0],p.command.slice(1),{cwd:p.cwd,encoding:'utf8',maxBuffer:65536}),stderr:''}}catch(e:any){return {exitCode:e.status??1,stdout:String(e.stdout??''),stderr:String(e.stderr??'')}}}
 return {base,repo,git,rpc,calls}
}
it('creates and verifies one disposable remote-abstracted worktree without changing dirty source files or executing Hooks',async()=>{
 const {base,repo,git,rpc,calls}=fixture();writeFileSync(join(repo,'file'),'dirty source');const marker=join(base,'HOOK_RAN');const hook=join(base,'hooks');execFileSync('mkdir',['-p',hook]);writeFileSync(join(hook,'post-checkout'),'#!/bin/sh\ntouch '+marker+'\n',{mode:0o755});git('config','core.hooksPath',hook)
 const plan=await planWorktree(repo,join(base,'new'),'feature-fixture',rpc);expect(await createRemoteWorktree(plan,rpc)).toBe(join(base,'new'));expect(readFileSync(join(repo,'file'),'utf8')).toBe('dirty source');expect(readFileSync(join(base,'new','file'),'utf8')).toBe('committed');expect(existsSync(marker)).toBe(false)
 const writes=calls.filter(p=>p.command.includes('add'));expect(writes).toHaveLength(1);expect(writes[0].command).toContain('core.hooksPath=/dev/null');expect(writes[0].timeoutMs).toBe(30000)
})
it('rejects unsafe paths/branches before writes and rejects changed HEAD during confirmation',async()=>{
 const {base,repo,git,rpc,calls}=fixture()
 for(const [dest,branch] of [[repo+'/nested','ok'],['/tmp/../unsafe','ok'],['C:\\worktree','ok'],[join(base,'new'),'-bad']])await expect(planWorktree(repo,dest!,branch!,rpc)).rejects.toThrow()
 const plan=await planWorktree(repo,join(base,'new'),'valid',rpc);writeFileSync(join(repo,'second'),'x');git('add','second');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','second')
 await expect(createRemoteWorktree(plan,rpc)).rejects.toMatchObject({submitted:false});expect(calls.some(p=>p.command.includes('worktree')&&p.command.includes('add'))).toBe(false)
})
it('does not retry or remove ambiguous writes and reconciles only exact path/branch/commit',async()=>{
 const {base,repo,rpc}=fixture();const plan=await planWorktree(repo,join(base,'new'),'valid',rpc);let writes=0
 const lost=async(method:string,p:any)=>{const value=await rpc(method,p);if(p.command.includes('worktree')&&p.command.includes('add')){writes++;throw new Error('reply lost')}return value}
 await expect(createRemoteWorktree(plan,lost)).rejects.toMatchObject({submitted:true});expect(writes).toBe(1);expect(await verifyCreatedWorktree(plan,rpc)).toBe(plan.destination);await expect(verifyCreatedWorktree({...plan,branch:'different'},rpc)).rejects.toThrow('not confirmed')
})
it('treats branch conflicts as potentially partial and bounds list parsing',async()=>{const {base,repo,git,rpc}=fixture();git('branch','exists');const p=await planWorktree(repo,join(base,'new'),'exists',rpc);await expect(createRemoteWorktree(p,rpc)).rejects.toBeInstanceOf(WorktreeOutcomeError);expect(()=>parseWorktrees('worktree /truncated')).toThrow('Truncated')})
