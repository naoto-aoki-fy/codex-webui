import {afterEach,expect,it,vi} from 'vitest'
import {agentThread,listChildAgents,readAgent} from './subagents'
afterEach(()=>vi.unstubAllGlobals())
const reply=(result:unknown)=>vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({result}))))
it('uses direct native filtering without reading histories or guessing fork relationships',async()=>{
 reply({data:[{id:'child',parentThreadId:'parent',forkedFromId:'other',status:{type:'active'},preview:'x'.repeat(20000)}],nextCursor:'next'})
 const value=await listChildAgents('parent',false)
 expect(value.rows[0]?.parent).toBe('parent');expect(value.rows[0]?.preview.length).toBe(4000)
 expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string).params).toEqual({parentThreadId:'parent',archived:false,limit:20,modelProviders:[]})
})
it('rejects ignored parent filters, oversized pages and malformed cursors',async()=>{
 for(const result of [{data:[{id:'other',forkedFromId:'parent'}]},{data:Array(21).fill({id:'c',parentThreadId:'p'})},{data:[],nextCursor:4}]){reply(result);await expect(listChildAgents('p',false)).rejects.toThrow()}
})
it('reads only selected metadata and verifies exact identity',async()=>{
 reply({thread:{id:'wrong'}});await expect(readAgent('wanted')).rejects.toThrow('identity changed')
 expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string).params).toEqual({threadId:'wanted',includeTurns:false})
 expect(agentThread({id:'ok',preview:'<script>x</script> token=private'}).preview).not.toContain('private')
})
