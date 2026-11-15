import {expect,it,vi} from 'vitest'
import {hookInspection} from './hooksInspection'
import {hookPolicy,saveHookPolicy} from './hookPolicy'
const native={key:'/remote/hook.json:SessionStart:0:0',eventName:'SessionStart',source:'project',isManaged:false,enabled:true,currentHash:'sha256:fixture',trustStatus:'untrusted',handlerType:'command',command:'echo fixture'}
const hook=hookInspection({data:[{hooks:[native]}]}).groups[0]!.hooks[0]!
const config=(version='v1',states={})=>({layers:[{name:{type:'user',profile:null,file:'/remote/config.toml'},version,config:{api_key:'SECRET',hooks:{state:states},unknown:{preserve:true}}}]})
it('only offers verified user/project policies and never managed or plugin definitions',()=>{
 for(const row of [{...native,isManaged:true},{...native,source:'plugin'},{...native,key:'unidentified'},{...native,currentHash:null}])expect(hookInspection({data:[{hooks:[row]}]}).groups[0]?.hooks[0]?.editable).toBe(null)
})
it('writes exactly one native key and field, preserving trust and unrelated configuration',async()=>{
 const request=vi.fn(async(method,params:any)=>method==='hooks/list'?{data:[{hooks:[native]}]}:method==='config/value/write'?{status:'ok',version:'v2',filePath:'/remote/config.toml'}:config('v2',{[native.key]:{enabled:false,trusted_hash:'preserved'}}))
 const result=await saveHookPolicy('t',hookPolicy(config(),[hook]),hook,'disable',request)
 expect(request.mock.calls[1]).toEqual(['config/value/write',{keyPath:'hooks.state',value:{[native.key]:{enabled:false}},mergeStrategy:'upsert',filePath:'/remote/config.toml',expectedVersion:'v1'},{configWriteErrors:true}])
 expect(result.states[native.key]).toEqual({enabled:false,trustedHash:'preserved'});expect(JSON.stringify(result)).not.toContain('SECRET')
})
it('approves only the exact native definition hash and verifies the saved native hash',async()=>{
 const request=vi.fn(async(method,params:any)=>method==='hooks/list'?{data:[{hooks:[native]}]}:method==='config/value/write'?{status:'ok',version:'v2',filePath:'/remote/config.toml'}:config('v2',{[native.key]:{trusted_hash:native.currentHash}}))
 await saveHookPolicy('t',hookPolicy(config(),[hook]),hook,'trust',request);expect(request.mock.calls[1]?.[1].value).toEqual({[native.key]:{trusted_hash:native.currentHash}})
})
it('rejects changed/ambiguous native identity before writes and never reloads or lists project/plugin trust catalogs',async()=>{
 const request=vi.fn(async()=>({data:[{hooks:[{...native,currentHash:'changed'}]}]}));await expect(saveHookPolicy('t',hookPolicy(config(),[hook]),hook,'enable',request)).rejects.toMatchObject({submitted:false});expect(request).toHaveBeenCalledOnce();expect(request.mock.calls[0]).toEqual(['hooks/list',{threadId:'t'}])
})
it('preserves native rejection versus uncertain submission without replaying writes',async()=>{
 let calls=0;const request=vi.fn(async(method)=>{if(method==='hooks/list')return {data:[{hooks:[native]}]};calls++;throw new Error('reply lost')})
 await expect(saveHookPolicy('t',hookPolicy(config(),[hook]),hook,'enable',request)).rejects.toMatchObject({submitted:true});expect(calls).toBe(1)
})
