import {rpcCall} from './codexRpcClient'
import {executionText} from './normalizers/executionDetails'
export type AgentThread = {id:string;parent:string|null;name:string;role:string;status:string;cwd:string;preview:string}
export function agentThread(value:unknown):AgentThread {
 const row=value as Record<string,unknown>
 if(!row || typeof row.id!=='string'||!row.id||row.id.length>2000)throw new Error('Incompatible native agent identity')
 if(row.parentThreadId!=null&&typeof row.parentThreadId!=='string')throw new Error('Incompatible native parent identity')
 const text=(v:unknown,n=300)=>typeof v==='string'?executionText(v.slice(0,n)):'Unavailable'
 return {id:row.id,parent:typeof row.parentThreadId==='string'?row.parentThreadId:null,name:text(row.agentNickname??row.name),role:text(row.agentRole),status:text((row.status as Record<string,unknown>)?.type??row.status),cwd:text(row.cwd,2000),preview:text(row.preview,4000)}
}
export async function readAgent(id:string){
 const result=await rpcCall<{thread:unknown}>('thread/read',{threadId:id,includeTurns:false})
 const row=agentThread(result?.thread)
 if(row.id!==id)throw new Error('Native thread identity changed')
 return row
}
export async function listChildAgents(parent:string,archived:boolean,cursor?:string){
 const result=await rpcCall<{data:unknown[];nextCursor?:unknown}>('thread/list',{parentThreadId:parent,archived,limit:20,...(cursor?{cursor}:{}),modelProviders:[]})
 if(!Array.isArray(result?.data)||result.data.length>20)throw new Error('Incompatible native child list')
 const rows=result.data.map(agentThread)
 if(rows.some(row=>row.parent!==parent))throw new Error('Runtime did not honor the native parent filter')
 if(result.nextCursor!=null&&(typeof result.nextCursor!=='string'||result.nextCursor.length>4000))throw new Error('Incompatible native child cursor')
 return {rows,cursor:typeof result.nextCursor==='string'?result.nextCursor:null}
}
