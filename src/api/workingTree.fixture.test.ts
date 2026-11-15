import {execFileSync} from 'node:child_process'
import {mkdtempSync,writeFileSync,rmSync,renameSync,unlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,expect,it,vi} from 'vitest'
import {readWorkingTree,readWorkingTreePatch} from './workingTree'
const roots:string[]=[]
afterEach(()=>{vi.unstubAllGlobals();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
it('reads disposable Git states including literal pathspec names, rename/delete/binary and bounded large patches',async()=>{
 const root=mkdtempSync(join(tmpdir(),'approved-git-'));roots.push(root)
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']})
 git('init','-q');writeFileSync(join(root,'both'),'old\n');writeFileSync(join(root,'rename'),'old\n');writeFileSync(join(root,'delete'),'old\n');writeFileSync(join(root,'binary'),Buffer.from([0,1,2]));writeFileSync(join(root,':(glob)*'),'literal old\n');git('add','--all');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture')
 writeFileSync(join(root,'both'),'staged\n');git('add','both');writeFileSync(join(root,'both'),'unstaged\n');renameSync(join(root,'rename'),join(root,'renamed'));git('add','rename','renamed');unlinkSync(join(root,'delete'));writeFileSync(join(root,'binary'),Buffer.from([0,3,4]));writeFileSync(join(root,':(glob)*'),'literal new\n');writeFileSync(join(root,'untracked'),'x\n'.repeat(50_000))
 vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init:RequestInit)=>{
  const {method,params}=JSON.parse(init.body as string);expect(method).toBe('command/exec');expect(params.cwd).toBe(root)
  let result
  try{result={exitCode:0,stdout:execFileSync(params.command[0],params.command.slice(1),{cwd:params.cwd,encoding:'utf8',maxBuffer:2_000_000,stdio:['ignore','pipe','pipe']}).slice(0,params.outputBytesCap),stderr:''}}
  catch(error){const e=error as {status:number;stdout:string;stderr:string};result={exitCode:e.status,stdout:e.stdout.slice(0,params.outputBytesCap),stderr:e.stderr.slice(0,params.outputBytesCap)}}
  return new Response(JSON.stringify({result}))
 }))
 const result=await readWorkingTree(root),both=result.rows.find(row=>row.path==='both')!
 expect(both).toMatchObject({index:'M',worktree:'M'})
 expect((await readWorkingTreePatch(root,both,true)).text).toContain('+staged')
 expect((await readWorkingTreePatch(root,both,false)).text).toContain('+unstaged')
 expect(result.rows.find(row=>row.path==='renamed')).toMatchObject({oldPath:'rename',index:'R'})
 expect(result.rows.find(row=>row.path==='delete')?.worktree).toBe('D')
 expect((await readWorkingTreePatch(root,result.rows.find(row=>row.path==='binary')!,false)).text).toContain('Binary files')
 const literal=await readWorkingTreePatch(root,result.rows.find(row=>row.path===':(glob)*')!,false);expect(literal.text).toContain('literal new');expect(literal.text).not.toContain('unstaged')
 const large=await readWorkingTreePatch(root,result.rows.find(row=>row.path==='untracked')!,false);expect(large.bounded).toBe(true);expect(large.text.length).toBeLessThanOrEqual(65536)
})
