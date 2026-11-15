import {expect,it,vi,afterEach} from 'vitest'
import {hookInspection,readHooks} from './hooksInspection'
afterEach(()=>vi.unstubAllGlobals())
it('projects actual trust and effective state, escaping definitions and omitting internal/secret data',()=>{
 const value=hookInspection({data:[{cwd:'/remote',hooks:[{key:'k',eventName:'SessionStart',handlerType:'command',command:'echo <script> token=PRIVATE',trustStatus:'untrusted',enabled:false,isManaged:true,sourcePath:'/remote/hook',currentHash:'hash',internal:{secret:'SECRET'}}],warnings:[],errors:[]}]})
 expect(value.groups[0]?.hooks[0]).toMatchObject({enabled:false,managed:true,trust:'untrusted'})
 expect(JSON.stringify(value)).not.toMatch(/PRIVATE|SECRET|internal/)
 expect(value.groups[0]?.hooks[0]?.definition).toContain('<script>')
})
it('bounds Hooks and warnings without inventing empty/known effective state',()=>{
 const value=hookInspection({data:[{hooks:Array(10000).fill({key:'k'}),warnings:Array(1000).fill('x'.repeat(5000))}]})
 expect(value.truncated).toBe(true);expect(value.groups[0]?.hooks).toHaveLength(100);expect(value.groups[0]?.warnings).toHaveLength(10)
 expect(value.groups[0]?.hooks[0]?.enabled).toBe(null)
 expect(()=>hookInspection({data:[{}]})).toThrow('unavailable')
})
it('uses loaded native thread scope without resuming or invoking Hooks',async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({result:{data:[]}})));vi.stubGlobal('fetch',fetcher)
 await readHooks('t');expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({method:'hooks/list',params:{threadId:'t'}})
})
