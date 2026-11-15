import {rpcCall} from './codexRpcClient'
import {executionText} from './normalizers/executionDetails'
export type ImportSource='claude-code'|'cursor'
export function migrationPreview(value:unknown){
 const result=value as {items?:unknown[]}
 if(!Array.isArray(result?.items))throw new Error('External-agent discovery unavailable')
 const rows=result.items.slice(0,100).map(value=>{
  const row=value as Record<string,unknown>
  if(!row||typeof row.itemType!=='string'||typeof row.description!=='string')throw new Error('Incompatible migration manifest')
  const raw=row.details as Record<string,unknown>|null
  const details:Record<string,unknown>={}
  // Public manifest identities only: never source contents, credentials or executable data.
  for(const key of ['plugins','skills','sessions','mcpServers','hooks','subagents','commands','memory']){
   const values=raw?.[key]
   if(Array.isArray(values))details[key]=values.slice(0,20).map(value=>{if(typeof value==='string')return value.slice(0,2000);const v=value as Record<string,unknown>;return v?{name:v.name,path:v.path,cwd:v.cwd,title:v.title,marketplaceName:v.marketplaceName,pluginNames:Array.isArray(v.pluginNames)?v.pluginNames.slice(0,20):undefined}:null})
  }
  return {type:executionText(row.itemType).slice(0,100),description:executionText(row.description).slice(0,4000),scope:typeof row.cwd==='string'?executionText(row.cwd).slice(0,2000):'Home scope (not requested)',details:executionText(details),skipped:['SKILLS','PLUGINS','MCP_SERVER_CONFIG','MEMORY'].includes(row.itemType)}
 })
 return {rows,bounded:result.items.length>100}
}
export async function detectExternalConfiguration(cwd:string,source:ImportSource){
 if(!cwd||!['claude-code','cursor'].includes(source))throw new Error('Select a remote project and supported source')
 return migrationPreview(await rpcCall('externalAgentConfig/detect',{cwds:[cwd],includeHome:false,maxSessions:0,migrationSource:source}))
}
