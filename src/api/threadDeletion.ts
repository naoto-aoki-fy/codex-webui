import {rpcCall} from './codexRpcClient'
import {executionText} from './normalizers/executionDetails'
export type DeleteRequest=(method:string,params:unknown)=>Promise<unknown>
export type DeletePreview={id:string;name:string;cwd:string;forkedFrom:string|null;checkedAt:string}
export async function previewThreadDeletion(id:string,request:DeleteRequest=rpcCall):Promise<DeletePreview>{
 if(!id||id.length>2000)throw new Error('Native conversation identity unavailable')
 const result=await request('thread/read',{threadId:id,includeTurns:false}) as Record<string,any>
 if(result?.importStage!==undefined||result?.importedTranscript!==undefined)throw new Error('Permanent deletion of Portable imported history is withheld. Use archiving to preserve its persisted receipt and history.')
 const row=result?.thread
 if(row?.id!==id||row.status?.type!=='idle'||typeof row.cwd!=='string'||!row.cwd||row.cwd.length>8000||row.forkedFromId!=null&&(typeof row.forkedFromId!=='string'||row.forkedFromId.length>2000))throw new Error('Exact native identity, working directory and idle state are required')
 for(const archived of [false,true]){
  const children=await request('thread/list',{parentThreadId:id,archived,limit:20,modelProviders:[]}) as {data?:Record<string,unknown>[];nextCursor?:unknown}
  if(!Array.isArray(children?.data)||children.data.length>20||children.nextCursor!==null||children.data.some(child=>child.parentThreadId!==id))throw new Error('A complete native child-agent inventory is required; unsupported/ambiguous filters cannot authorize deletion')
  if(children.data.length)throw new Error('This conversation has native child agents. Subtree deletion is withheld by this limited workflow.')
 }
 return {id,name:executionText(typeof row.name==='string'?row.name.slice(0,300):id),cwd:row.cwd,forkedFrom:typeof row.forkedFromId==='string'?row.forkedFromId:null,checkedAt:new Date().toISOString()}
}
