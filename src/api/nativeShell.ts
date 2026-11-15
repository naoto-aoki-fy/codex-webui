import {rpcCall} from './codexRpcClient'
import {executionText} from './normalizers/executionDetails'
import {permissionChoices} from './threadPermissions'
export type ShellRequest=(method:string,params:unknown)=>Promise<unknown>
export const shellRequest:ShellRequest=(method,params)=>rpcCall(method,params,{commandErrors:true})
export const SHELL_TIMEOUT_MS=30_000
export const SHELL_OUTPUT_BYTES=65_536
export type ShellAccess='readOnly'|'dangerFullAccess'
export type ShellContext={threadId:string;cwd:string;shell:string;path:string;checkedAt:string;allowFullAccess:boolean}
export async function inspectShell(threadId:string,request:ShellRequest=shellRequest):Promise<ShellContext>{
 if(!threadId||threadId.length>2000)throw new Error('Native conversation identity unavailable')
 const raw=await request('thread/read',{threadId,includeTurns:false}) as {thread?:Record<string,any>}
 const row=raw?.thread
 if(row?.id!==threadId||row.status?.type!=='idle'||typeof row.cwd!=='string'||row.cwd.length>4000||!row.cwd.startsWith('/')||/[\x00-\x1f]/.test(row.cwd))throw new Error('An idle native conversation with an absolute POSIX working directory is required')
 const environments=row.environments
 if(!Array.isArray(environments)||environments.length!==1||environments[0]?.environmentId!=='local'||environments[0]?.cwd!==row.cwd)throw new Error('Exact local App Server environment/cwd is unavailable. Remote-only, mixed and unknown execution contexts are not supported here.')
 const info=await request('environment/info',{environmentId:'local'}) as {shell?:{name?:unknown;path?:unknown}}
 if(!['sh','bash','zsh'].includes(String(info?.shell?.name))||typeof info?.shell?.path!=='string'||!info.shell.path.startsWith('/')||info.shell.path.length>4000||/[\x00-\x1f]/.test(info.shell.path))throw new Error('A native POSIX sh/bash/zsh shell identity is required; no executable fallback is used')
 let allowFullAccess=false
 try{allowFullAccess=permissionChoices(await request('configRequirements/read',{}))?.sandboxes.includes('dangerFullAccess')===true}catch{/* Unknown policy never offers broader permissions. */}
 return {threadId,cwd:row.cwd,shell:info.shell.name as string,path:info.shell.path,checkedAt:new Date().toISOString(),allowFullAccess}
}
export function shellParameters(context:ShellContext,command:string,processId:string,access:ShellAccess='readOnly'){
 if(!command.trim()||command.length>8000||command.includes('\0'))throw new Error('Enter one native shell command (at most 8,000 characters, no NUL)')
 if(!['readOnly','dangerFullAccess'].includes(access)||access==='dangerFullAccess'&&!context.allowFullAccess)throw new Error('Broader native command permissions are unavailable under the observed managed policy')
 return {command:[context.path,'-c',command],processId,cwd:context.cwd,timeoutMs:SHELL_TIMEOUT_MS,outputBytesCap:SHELL_OUTPUT_BYTES,sandboxPolicy:access==='dangerFullAccess'?{type:access}:{type:access,networkAccess:false}}
}
export function shellResult(value:unknown){
 const row=value as {exitCode?:unknown;stdout?:unknown;stderr?:unknown}
 if(!Number.isInteger(row?.exitCode)||(Number(row.exitCode)<-2147483648||Number(row.exitCode)>2147483647)||typeof row?.stdout!=='string'||typeof row.stderr!=='string')throw new Error('Native process exit/output response unavailable')
 return {exitCode:row.exitCode as number,stdout:executionText(row.stdout.slice(0,SHELL_OUTPUT_BYTES)),stderr:executionText(row.stderr.slice(0,SHELL_OUTPUT_BYTES)),bounded:row.stdout.length>=SHELL_OUTPUT_BYTES||row.stderr.length>=SHELL_OUTPUT_BYTES||row.stdout.length>12000||row.stderr.length>12000}
}
