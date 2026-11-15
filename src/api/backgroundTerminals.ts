import {rpcCall} from './codexRpcClient'
export type BackgroundTerminal={itemId:string;processId:string;command:string;cwd:string}
export function terminalPage(value:unknown):{data:BackgroundTerminal[];nextCursor:string|null}{
 const row=value as Record<string,unknown>
 if(!Array.isArray(row?.data)||row.data.length>100||(row.nextCursor!=null&&typeof row.nextCursor!=='string'))throw new Error('Incompatible background terminal list')
 const data=row.data.map((value:unknown)=>{const item=value as Record<string,unknown>
  if(!item||!['itemId','processId','command','cwd'].every(k=>typeof item[k]==='string')||!item.processId)throw new Error('Invalid background terminal')
  return {itemId:item.itemId as string,processId:item.processId as string,command:(item.command as string).slice(0,2000),cwd:(item.cwd as string).slice(0,2000)}
 })
 return {data,nextCursor:row.nextCursor as string|null??null}
}
export async function listBackgroundTerminals(threadId:string,cursor:string|null=null){return terminalPage(await rpcCall('thread/backgroundTerminals/list',{threadId,cursor,limit:50}))}
export async function terminateBackgroundTerminal(threadId:string,processId:string){
 const result=await rpcCall<{terminated?:unknown}>('thread/backgroundTerminals/terminate',{threadId,processId})
 if(typeof result?.terminated!=='boolean')throw new Error('Unrecognized termination acknowledgment; refresh before another action.')
 return result.terminated
}
