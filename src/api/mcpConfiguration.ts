import {rpcCall} from './codexRpcClient'
export type McpSwitch={name:string;enabled:boolean|null}
export type McpSwitches={filePath:string;version:string;servers:McpSwitch[]}
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
export function mcpSwitches(value:unknown):McpSwitches {
 const layers=record(value).layers
 if(!Array.isArray(layers)||layers.length>100)throw new Error('Configuration layers unavailable; no safe targeted edit is possible.')
 const candidates=layers.map(record).filter(layer=>{const name=record(layer.name);return name.type==='user'&&name.profile==null&&typeof name.file==='string'&&!layer.disabledReason})
 if(candidates.length!==1)throw new Error('A single writable base user layer was not established.')
 const layer=candidates[0]!,filePath=record(layer.name).file as string
 if(typeof layer.version!=='string'||!layer.version||!filePath)throw new Error('Configuration version/path unavailable.')
 const definitions=record(record(layer.config).mcp_servers),servers:McpSwitch[]=[]
 for(const name in definitions){if(!Object.prototype.hasOwnProperty.call(definitions,name))continue;if(servers.length>=100)throw new Error('More than 100 MCP definitions; management view is bounded.')
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(name))continue
  const definition=record(definitions[name]);servers.push({name,enabled:typeof definition.enabled==='boolean'?definition.enabled:null})
 }
 return {filePath,version:layer.version,servers}
}
export async function readMcpSwitches(){return mcpSwitches(await rpcCall('config/read',{includeLayers:true}))}
export async function saveMcpSwitch(snapshot:McpSwitches,name:string,enabled:boolean){
 if(!snapshot.servers.some(server=>server.name===name)||!/^[A-Za-z0-9_-]{1,100}$/.test(name)||!snapshot.version||!snapshot.filePath)throw new Error('Refresh the exact MCP definition before editing.')
 const value=await rpcCall<{status?:unknown;version?:unknown;filePath?:unknown}>('config/value/write',{keyPath:`mcp_servers.${name}.enabled`,value:enabled,mergeStrategy:'upsert',filePath:snapshot.filePath,expectedVersion:snapshot.version})
 if(!['ok','okOverridden'].includes(String(value?.status))||typeof value.version!=='string'||value.filePath!==snapshot.filePath)throw new Error('Unrecognized configuration acknowledgment; saved outcome uncertain. Read configuration before retrying.')
 return {version:value.version,overridden:value.status==='okOverridden'}
}
