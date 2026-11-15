import { rpcCall } from './codexRpcClient'
export const GIT_PREVIEW_CAP = 65_536
export type GitRow = { path: string; oldPath?: string; index: string; worktree: string; untracked: boolean }
type Rpc = (method: string, params: unknown) => Promise<unknown>
export async function remoteGit(cwd: string, args: string[], rpc: Rpc = rpcCall): Promise<{text:string; bounded:boolean}> {
 if (!cwd.trim()) throw new Error('Select a remote project first.')
 const value = await rpc('command/exec', { command: ['git','--literal-pathspecs','--no-pager','--no-optional-locks','-c','core.fsmonitor=false',...args], cwd, timeoutMs:10_000, outputBytesCap:GIT_PREVIEW_CAP }) as Record<string,unknown>
 if (typeof value?.exitCode !== 'number' || typeof value.stdout !== 'string' || typeof value.stderr !== 'string') throw new Error('Incompatible remote Git response')
 if (value.exitCode !== 0 && !(args.includes('--no-index') && value.exitCode === 1)) throw new Error(value.stderr.slice(0,2000) || `Remote Git exited ${value.exitCode}`)
 return {text:value.stdout.slice(0,GIT_PREVIEW_CAP), bounded:new TextEncoder().encode(value.stdout).length >= GIT_PREVIEW_CAP}
}
export function parseGitStatus(text: string): GitRow[] {
 if (text && !text.endsWith('\0')) throw new Error('Git status was truncated. Narrow the project changes before retrying.')
 const fields=text.split('\0'), rows:GitRow[]=[]
 for(let i=0;i<fields.length-1;i++) {
  const entry=fields[i]!
  if(entry.length<4 || entry[2]!==' ') throw new Error('Malformed Git status')
  const index=entry[0]!,worktree=entry[1]!,path=entry.slice(3)
  const oldPath=/[RC]/.test(index+worktree)?fields[++i]:undefined
  if(!path || (/[RC]/.test(index+worktree) && !oldPath)) throw new Error('Malformed Git rename status')
  if(rows.length===300) throw new Error('More than 300 changed paths. Status view is bounded; narrow changes before retrying.')
  rows.push({path,oldPath,index,worktree,untracked:index==='?'&&worktree==='?'})
 }
 return rows
}
export async function readWorkingTree(cwd:string) {
 const result=await remoteGit(cwd,['status','--porcelain=v1','-z','--untracked-files=all'])
 if(result.bounded) throw new Error('Git status exceeded the 64 KiB limit.')
 return {rows:parseGitStatus(result.text),refreshedAt:new Date().toISOString()}
}
export async function readWorkingTreePatch(cwd:string,row:GitRow,staged:boolean) {
 // No shell, external diff driver or textconv. -- separates server-supplied filenames.
 const args=row.untracked?['diff','--no-index','--no-ext-diff','--no-textconv','--','/dev/null',row.path]:['diff',...(staged?['--cached']:[]),'--no-ext-diff','--no-textconv','--',row.path,...(row.oldPath?[row.oldPath]:[])]
 return remoteGit(cwd,args)
}
