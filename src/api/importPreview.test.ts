import {afterEach,expect,it,vi} from 'vitest'
import {detectExternalConfiguration,migrationPreview} from './importPreview'
afterEach(()=>vi.unstubAllGlobals())
it('excludes home, all sessions and connector-ledger discovery from native detection',async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({result:{items:[]}})));vi.stubGlobal('fetch',fetcher)
 await detectExternalConfiguration('/remote/project','cursor')
 expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({method:'externalAgentConfig/detect',params:{cwds:['/remote/project'],includeHome:false,maxSessions:0,migrationSource:'cursor'}})
})
it('renders inert redacted manifests, labels excluded scopes and bounds large payloads',()=>{
 const value=migrationPreview({items:Array(1000).fill({itemType:'SKILLS',description:'<script>token=PRIVATE</script>',cwd:'/remote',details:{skills:[{name:'safe',script:'HIDDEN',apiKey:'SECRET'}],instructions:'HIDDEN'}})})
 expect(value.rows).toHaveLength(100);expect(value.bounded).toBe(true);expect(value.rows[0]?.skipped).toBe(true);expect(JSON.stringify(value)).not.toMatch(/PRIVATE|HIDDEN|SECRET/)
})
it('distinguishes malformed and empty native results',()=>{expect(()=>migrationPreview({})).toThrow();expect(migrationPreview({items:[]}).rows).toEqual([])})
