import {afterEach,expect,it,vi} from 'vitest'
import {mcpSwitches,saveMcpSwitch} from './mcpConfiguration'
afterEach(()=>vi.unstubAllGlobals())
const config={layers:[{name:{type:'user',file:'/remote/config.toml',profile:null},version:'v1',config:{mcp_servers:{demo:{command:'SECRET_COMMAND',env:{TOKEN:'SECRET'},enabled:true},'complex.name':{enabled:true}},other:'KEEP'}}]}
it('projects only exact base user identity, version and boolean without secrets',()=>{
 expect(mcpSwitches(config)).toEqual({filePath:'/remote/config.toml',version:'v1',servers:[{name:'demo',enabled:true}]})
 expect(JSON.stringify(mcpSwitches(config))).not.toContain('SECRET')
 expect(()=>mcpSwitches({layers:[]})).toThrow('single writable')
 expect(()=>mcpSwitches({layers:[{...config.layers[0],name:{type:'user',file:'/remote/config.toml',profile:'profile'}}]})).toThrow('single writable')
})
it('writes only the selected scalar with optimistic version; does not resend config or secrets',async()=>{
 const fetch=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>new Response(JSON.stringify({result:{status:'ok',version:'v2',filePath:'/remote/config.toml'}})))
 vi.stubGlobal('fetch',fetch);expect(await saveMcpSwitch(mcpSwitches(config),'demo',false)).toEqual({version:'v2',overridden:false})
 expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({method:'config/value/write',params:{keyPath:'mcp_servers.demo.enabled',value:false,mergeStrategy:'upsert',filePath:'/remote/config.toml',expectedVersion:'v1'}})
 await expect(saveMcpSwitch(mcpSwitches(config),'other',false)).rejects.toThrow('Refresh')
})
