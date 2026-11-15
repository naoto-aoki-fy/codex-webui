import {rpcCall} from './codexRpcClient'
export function memoryReadiness(value:unknown){const row=value as Record<string,unknown>
 if(typeof row?.v2Ready!=='boolean'||typeof row.v2ConsolidatedThreads!=='number'||!Number.isSafeInteger(row.v2ConsolidatedThreads)||row.v2ConsolidatedThreads<0)throw new Error('Incompatible memory readiness response')
 return {ready:row.v2Ready,count:row.v2ConsolidatedThreads}
}
export async function readMemoryStatus(){return memoryReadiness(await rpcCall('memory/status',{}))}
export async function readThreadMemory(threadId:string){const value=await rpcCall<{summary?:unknown}>('thread/memory/read',{threadId})
 if(value?.summary!==null&&typeof value?.summary!=='string')throw new Error('Incompatible thread memory response')
 return value.summary===null?null:value.summary.slice(0,8000)
}
