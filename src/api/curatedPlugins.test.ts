import {afterEach,expect,it,vi} from 'vitest'
import {curatedPlugins,readCuratedPlugins} from './curatedPlugins'
afterEach(()=>vi.unstubAllGlobals())
it('retains actual version/state and distinguishes unknown values without registry state',()=>{
 const result=curatedPlugins({marketplaces:[{name:'native',plugins:[{id:'id',name:'Demo',version:'v2',localVersion:'v1',installed:true,enabled:false,source:{type:'remote',token:'SECRET'},interface:{shortDescription:'Native description'}}]}]})
 expect(result.plugins[0]).toMatchObject({version:'v2',localVersion:'v1',installed:true,enabled:false,description:'Native description'})
 expect(result.plugins[0]!.source).not.toContain('SECRET')
 expect(curatedPlugins({marketplaces:[]}).plugins).toEqual([])
 expect(()=>curatedPlugins({})).toThrow('Incompatible')
})
it('requests only vertical sources without force refetch or local Marketplace synchronization',async()=>{
 const fetch=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>new Response(JSON.stringify({result:{marketplaces:[]}})))
 vi.stubGlobal('fetch',fetch);await readCuratedPlugins()
 expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({method:'plugin/list',params:{marketplaceKinds:['vertical'],forceRefetch:false}})
})
