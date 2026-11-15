import {rpcCall} from './codexRpcClient'
import {remoteGit} from './workingTree'
type Rpc=(method:string,params:unknown)=>Promise<unknown>
export type WorktreePlan={root:string;head:string;branch:string;destination:string}
export class WorktreeOutcomeError extends Error {constructor(message:string,readonly submitted:boolean){super(message)}}
function path(value:string){
 if(value.length>2000||!value.startsWith('/')||value==='/'||/[\x00-\x1f\x7f\\]/.test(value)||value.split('/').some(p=>p==='.'||p==='..'||p==='.git')||value.includes('//'))throw new Error('Use an absolute POSIX remote path without dot segments, control characters or .git')
 return value.replace(/\/$/,'')
}
async function git(cwd:string,args:string[],rpc:Rpc,write=false){const result=await remoteGit(cwd,args,write?(method,params)=>rpc(method,{...params as Record<string,unknown>,timeoutMs:30000}):rpc);if(result.bounded)throw new Error('Remote Git output exceeded 64 KiB; inspect externally');return result.text}
export function parseWorktrees(text:string){
 if(text&&!text.endsWith('\0'))throw new Error('Truncated native worktree list')
 const entries:{path:string;head:string;branch:string}[]=[];let current:{path:string;head:string;branch:string}|null=null
 for(const field of text.split('\0')){
  if(field.startsWith('worktree ')){if(entries.length>=300)throw new Error('More than 300 worktrees; inspect externally');current={path:field.slice(9),head:'',branch:''};entries.push(current)}
  else if(current&&field.startsWith('HEAD '))current.head=field.slice(5)
  else if(current&&field.startsWith('branch '))current.branch=field.slice(7)
 }
 return entries
}
export async function planWorktree(cwd:string,destination:string,branch:string,rpc:Rpc=rpcCall):Promise<WorktreePlan>{
 path(cwd);const target=path(destination)
 if(!branch||branch.length>100||branch.startsWith('-')||/[\x00-\x20\x7f]/.test(branch))throw new Error('Provide a valid new Git branch name, up to 100 characters')
 const root=path((await git(cwd,['rev-parse','--show-toplevel'],rpc)).trim())
 if(target===root||target.startsWith(root+'/')||root.startsWith(target+'/'))throw new Error('Choose a separate destination outside the source repository')
 await git(root,['check-ref-format','--branch',branch],rpc)
 const head=(await git(root,['rev-parse','--verify','HEAD'],rpc)).trim()
 if(!/^[a-f0-9]{40,64}$/.test(head))throw new Error('Native repository HEAD unavailable')
 return {root,head,branch,destination:target}
}
export async function verifyCreatedWorktree(plan:WorktreePlan,rpc:Rpc=rpcCall){
 const entries=parseWorktrees(await git(plan.root,['worktree','list','--porcelain','-z'],rpc))
 const entry=entries.find(row=>row.path===plan.destination)
 if(!entry||entry.head!==plan.head||entry.branch!==`refs/heads/${plan.branch}`)throw new Error('Exact worktree path, branch and commit are not confirmed. Inspect partial state; no cleanup or retry was performed.')
 const root=(await git(plan.destination,['rev-parse','--show-toplevel'],rpc)).trim()
 if(root!==plan.destination)throw new Error('Destination identity differs from the confirmed remote worktree')
 return plan.destination
}
export async function createRemoteWorktree(plan:WorktreePlan,rpc:Rpc=rpcCall){
 let submitted=false
 try{
  const current=await planWorktree(plan.root,plan.destination,plan.branch,rpc)
  if(current.root!==plan.root||current.head!==plan.head)throw new Error('Repository HEAD changed; review a fresh plan before creating')
  const entries=parseWorktrees(await git(plan.root,['worktree','list','--porcelain','-z'],rpc))
  if(entries.some(row=>row.path===plan.destination||row.branch===`refs/heads/${plan.branch}`))throw new Error('Destination or branch is already used by a native worktree')
  submitted=true
  // Native command/exec on the selected App Server. Never invoke host Git or shell.
  await git(plan.root,['-c','core.hooksPath=/dev/null','worktree','add','--no-track','-b',plan.branch,plan.destination,plan.head],rpc,true)
  return await verifyCreatedWorktree(plan,rpc)
 }catch(e){throw new WorktreeOutcomeError(e instanceof Error?e.message:'Remote worktree creation failed',submitted)}
}
