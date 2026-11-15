import {expect,it} from 'vitest'
import {remoteStatus,remoteClients} from './remoteControl'
it('projects only status identity, omitting tokens and pairing secrets',()=>{
 expect(remoteStatus({status:'connected',serverName:'server',environmentId:'env',pairingCode:'SECRET',token:'SECRET'})).toEqual({status:'connected',serverName:'server',environmentId:'env'})
 expect(()=>remoteStatus({status:'unknown',serverName:'server'})).toThrow('Incompatible')
 expect(remoteStatus({status:'disabled',serverName:'server',environmentId:null}).environmentId).toBeNull()
})
it('projects bounded registered clients without inventing active status',()=>{
 expect(remoteClients({data:[{clientId:'c',displayName:'Phone',platform:'mobile',lastSeenAt:12,secret:'SECRET'}],nextCursor:null})).toEqual({data:[{clientId:'c',name:'Phone',platform:'mobile',lastSeen:12}],nextCursor:null})
 expect(()=>remoteClients({data:[{}]})).toThrow('Invalid')
 expect(remoteClients({data:[]})).toEqual({data:[],nextCursor:null})
})
