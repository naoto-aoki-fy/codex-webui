import {rpcCall} from './codexRpcClient'
export function remoteStatus(value:unknown){const row=value as Record<string,unknown>
 if(!row||!['disabled','connecting','connected','errored'].includes(String(row.status))||typeof row.serverName!=='string'||(row.environmentId!=null&&typeof row.environmentId!=='string'))throw new Error('Incompatible Remote Control status')
 return {status:String(row.status),serverName:row.serverName.slice(0,300),environmentId:typeof row.environmentId==='string'?row.environmentId:null}
}
export type RemoteClient={clientId:string;name:string;platform:string;lastSeen:number|null}
export function remoteClients(value:unknown):{data:RemoteClient[];nextCursor:string|null}{const row=value as Record<string,unknown>
 if(!Array.isArray(row?.data)||row.data.length>100||(row.nextCursor!=null&&typeof row.nextCursor!=='string'))throw new Error('Incompatible Remote Control clients')
 return {data:row.data.map(v=>{const client=v as Record<string,unknown>;if(typeof client?.clientId!=='string'||!client.clientId)throw new Error('Invalid Remote Control client');return {clientId:client.clientId,name:typeof client.displayName==='string'?client.displayName.slice(0,300):'Unnamed client',platform:typeof client.platform==='string'?client.platform.slice(0,100):'Unavailable',lastSeen:typeof client.lastSeenAt==='number'&&Number.isFinite(client.lastSeenAt)?client.lastSeenAt:null}}),nextCursor:row.nextCursor as string|null??null}
}
export async function readRemoteStatus(){return remoteStatus(await rpcCall('remoteControl/status/read',null))}
export async function listRemoteClients(environmentId:string,cursor:string|null){return remoteClients(await rpcCall('remoteControl/client/list',{environmentId,cursor,limit:50,order:'desc'}))}
