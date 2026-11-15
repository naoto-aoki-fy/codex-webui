import {afterEach,expect,it,vi} from 'vitest'
import {memoryReadiness,readThreadMemory} from './memoryStatus'
afterEach(()=>vi.unstubAllGlobals())
it('does not infer readiness from missing fields, and preserves actual zero',()=>{
 expect(memoryReadiness({v2Ready:false,v2ConsolidatedThreads:0})).toEqual({ready:false,count:0})
 expect(()=>memoryReadiness({})).toThrow('Incompatible')
 expect(()=>memoryReadiness({v2Ready:true,v2ConsolidatedThreads:-1})).toThrow('Incompatible')
})
it('preserves null summary as ambiguous unavailable, bounds text and never sets preferences',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({result:{summary:null}}))).mockResolvedValueOnce(new Response(JSON.stringify({result:{summary:'x'.repeat(9000)}})))
 vi.stubGlobal('fetch',fetch);expect(await readThreadMemory('t')).toBeNull();expect((await readThreadMemory('t'))?.length).toBe(8000)
 expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({method:'thread/memory/read',params:{threadId:'t'}})
})
