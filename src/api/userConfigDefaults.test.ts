import {afterEach,expect,it,vi} from 'vitest'
import {activeUserConfig,saveUserModelDefault} from './userConfigDefaults'
afterEach(()=>vi.unstubAllGlobals())
const base={name:{type:'user',file:'/remote/config.toml',profile:null},version:'base-v',config:{model:'base',api_key:'SECRET'}}
const profile={name:{type:'user',file:'/remote/work.config.toml',profile:'work'},version:'profile-v',config:{model:'profile',model_reasoning_effort:'medium',unknown:{secret:'SECRET'}}}
it('uses native active profile file/version rather than legacy profile tables or base user defaults',()=>{
 const value=activeUserConfig({layers:[profile,base]});expect(value).toEqual({filePath:'/remote/work.config.toml',version:'profile-v',profile:'work',model:'profile',effort:'medium'});expect(JSON.stringify(value)).not.toContain('SECRET')
 expect(activeUserConfig({layers:[base]})?.profile).toBe(null);expect(activeUserConfig({layers:[profile,{...profile,name:{...profile.name,profile:'other'}}]})).toBe(null)
 expect(activeUserConfig({layers:[{...base,version:null}]})).toBe(null)
})
it('writes one allowlisted scalar with native CAS and opts in without changing generic RPC params',async()=>{
 const request=vi.fn().mockResolvedValue(new Response(JSON.stringify({result:{status:'okOverridden',version:'new',filePath:'/remote/work.config.toml'}})));vi.stubGlobal('fetch',request)
 const target=activeUserConfig({layers:[profile,base]})!;expect(await saveUserModelDefault(target,'model','fixture-model')).toEqual({version:'new',overridden:true})
 const init=request.mock.calls[0]![1];expect(JSON.parse(init.body)).toEqual({method:'config/value/write',params:{keyPath:'model',value:'fixture-model',mergeStrategy:'upsert',filePath:target.filePath,expectedVersion:'profile-v'}});expect(init.headers['X-Codex-Config-Write-Errors']).toBe('1')
})
it('rejects unapproved keys/values before sending and refuses mismatched native acknowledgments',async()=>{
 const request=vi.fn();vi.stubGlobal('fetch',request);const target=activeUserConfig({layers:[base]})!
 await expect(saveUserModelDefault(target,'features.remote_control' as any,'true')).rejects.toThrow();await expect(saveUserModelDefault(target,'model','bad model')).rejects.toThrow();expect(request).not.toHaveBeenCalled()
 request.mockResolvedValue(new Response(JSON.stringify({result:{status:'ok',version:'v',filePath:'/wrong'}})));await expect(saveUserModelDefault(target,'model','fixture-model')).rejects.toThrow('unknown')
})
