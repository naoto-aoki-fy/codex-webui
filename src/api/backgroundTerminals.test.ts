import {expect,it,vi,afterEach} from 'vitest'
import {terminalPage,listBackgroundTerminals,terminateBackgroundTerminal} from './backgroundTerminals'
afterEach(()=>vi.unstubAllGlobals())
it('checks native identities and bounds malformed/large pages',()=>{
 expect(terminalPage({data:[],nextCursor:null})).toEqual({data:[],nextCursor:null})
 expect(()=>terminalPage({data:[{processId:'1'}]})).toThrow('Invalid')
 expect(()=>terminalPage({data:Array(101).fill({})})).toThrow('Incompatible')
})
it('uses only thread-scoped native list and exact termination and preserves false acknowledgment',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({result:{data:[],nextCursor:'c'}}))).mockResolvedValueOnce(new Response(JSON.stringify({result:{terminated:false}})))
 vi.stubGlobal('fetch',fetch)
 expect(await listBackgroundTerminals('t')).toEqual({data:[],nextCursor:'c'})
 expect(await terminateBackgroundTerminal('t','42')).toBe(false)
 expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({method:'thread/backgroundTerminals/list',params:{threadId:'t',cursor:null,limit:50}})
 expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({method:'thread/backgroundTerminals/terminate',params:{threadId:'t',processId:'42'}})
})
