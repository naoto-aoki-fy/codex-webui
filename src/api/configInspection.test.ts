import {expect,it} from 'vitest'
import {configInspection,requirementsInspection} from './configInspection'
it('projects public values, exact layer origins and named profiles without arbitrary config or secrets',()=>{
 const result=configInspection({config:{model:'m',api_key:'SECRET',mcp_servers:{x:{token:'SECRET'}},features:{remote_control:true}},origins:{model:{name:{type:'user',file:'/remote/config.toml'}}},layers:[{name:{type:'user',file:'/remote/config.toml'},version:'v1',config:{profiles:{safe:{model:'profile-model',api_key:'SECRET'}}}}]})
 expect(result.effective[0]).toMatchObject({key:'model',value:'m'});expect(result.profiles).toEqual([{name:'safe',settings:{model:'profile-model'}}]);expect(JSON.stringify(result)).not.toMatch(/SECRET|remote_control|mcp_servers/)
})
it('distinguishes missing layers, malformed config, null restrictions and explicit empty restrictions',()=>{
 expect(configInspection({config:{}}).layersAvailable).toBe(false);expect(()=>configInspection({})).toThrow();expect(()=>requirementsInspection({})).toThrow()
 expect(requirementsInspection({requirements:null})).toBe(null);expect(requirementsInspection({requirements:{allowed_login_methods:[],additional_developer_instructions:'HIDDEN'}})).toEqual({allowed_login_methods:'[]'})
})
it('bounds layers, profiles and text even for hostile large data',()=>{
 const profiles=Object.fromEntries(Array.from({length:150},(_,i)=>['p'+i,{model:'x'.repeat(20000)}]))
 const result=configInspection({config:{},layers:Array(41).fill({name:{type:'user'},config:{profiles}})})
 expect(result.layers).toHaveLength(40);expect(result.profiles).toHaveLength(100);expect(result.profiles[0]?.settings.model?.length).toBeLessThanOrEqual(12000);expect(result.bounded).toBe(true)
})
