import { expect,it,vi } from 'vitest'
import { parseGitStatus,remoteGit,GIT_PREVIEW_CAP } from './workingTree'
it('parses separate index/worktree, renamed, deleted, untracked and unusual names',()=>{
 expect(parseGitStatus('MM both\0R  new\0old\0 D deleted\0?? -untracked\0')).toEqual([
 {path:'both',index:'M',worktree:'M',oldPath:undefined,untracked:false},
 {path:'new',oldPath:'old',index:'R',worktree:' ',untracked:false},
 {path:'deleted',index:' ',worktree:'D',oldPath:undefined,untracked:false},
 {path:'-untracked',index:'?',worktree:'?',oldPath:undefined,untracked:true}])
 expect(parseGitStatus('')).toEqual([])
 expect(()=>parseGitStatus(' M cut')).toThrow('truncated')
 expect(()=>parseGitStatus('?? x\0'.repeat(301))).toThrow('300')
})
it('only invokes the remote argv API with explicit remote cwd and bounds',async()=>{
 const rpc=vi.fn().mockResolvedValue({exitCode:0,stdout:'',stderr:''})
 await remoteGit('C:\\remote',['status','--porcelain=v1','-z'],rpc)
 expect(rpc).toHaveBeenCalledWith('command/exec',{command:['git','--no-pager','--no-optional-locks','-c','core.fsmonitor=false','status','--porcelain=v1','-z'],cwd:'C:\\remote',timeoutMs:10_000,outputBytesCap:GIT_PREVIEW_CAP})
 rpc.mockResolvedValue({exitCode:128,stdout:'',stderr:'not a git repository'})
 await expect(remoteGit('/remote',['status'],rpc)).rejects.toThrow('not a git repository')
 rpc.mockResolvedValue({exitCode:0})
 await expect(remoteGit('/remote',['status'],rpc)).rejects.toThrow('Incompatible')
})
