import {afterEach,expect,it,vi} from 'vitest'
import {ref} from 'vue'
import {createThreadDeletion} from './threadDeletion'
import {previewThreadDeletion} from '../api/threadDeletion'
const disposals:(()=>void)[]=[]
afterEach(()=>{disposals.splice(0).forEach(fn=>fn())})
function fixture(){let extra:any={},fail:any=null,children:any[]=[],status='idle';const request=vi.fn(async(method:string,params:any):Promise<any>=>{
 if(method==='thread/read')return {...extra,thread:{id:params.threadId,name:'Native fixture',cwd:'/remote/repo',status:{type:status}}}
 if(method==='thread/list')return {data:children,nextCursor:null}
 if(fail)throw fail
 return {}
 });const epoch=ref(0),selected=ref('t'),blocked=ref(false),ready=ref(true),c=createThreadDeletion({epoch,selected,ready:()=>ready.value,blocked:()=>blocked.value},request);disposals.push(c.dispose)
 return {c,request,epoch,selected,blocked,ready,extra:(v:any)=>extra=v,children:(v:any[])=>children=v,status:(v:string)=>status=v,fail:(v:any)=>fail=v}
}
const event=(id='t')=>({method:'thread/deleted',params:{threadId:id},atIso:''})
it('never submits native deletion without an execution-time leaf-only guarantee, including direct controller calls',async()=>{
 const {c,request,epoch}=fixture()
 await c.run('t',true);expect(request).not.toHaveBeenCalled()
 await c.prepare();expect(c.preview.value?.id).toBe('t')
 const reads=request.mock.calls.length
 await c.run('t',true);await c.run('t',true)
 c.observe(event());expect(c.state.value).toBe('prepared')
 expect(request).toHaveBeenCalledTimes(reads)
 epoch.value++;await c.prepare();await c.run('t',true)
 expect(request.mock.calls.some(([method])=>method==='thread/delete')).toBe(false)
 expect(c.status.value).toContain('cannot atomically exclude descendants')
})
it('rejects imported history, active status and child subtrees before mutation',async()=>{for(const scenario of ['import','active','child']){const f=fixture();if(scenario==='import')f.extra({importedTranscript:[]});if(scenario==='active')f.status('active');if(scenario==='child')f.children([{id:'child',parentThreadId:'t'}]);await f.c.prepare();expect(f.c.state.value).toBe('rejected');expect(f.request.mock.calls.some(row=>row[0]==='thread/delete')).toBe(false)}})
it('rejects ambiguous child filters during read-only inspection',async()=>{await expect(previewThreadDeletion('t',async(method)=>method==='thread/read'?{thread:{id:'t',cwd:'/r',status:{type:'idle'}}}:{data:[{id:'x',parentThreadId:'other'}],nextCursor:null})).rejects.toThrow('inventory')})
it('retires stale previews on selection changes without stranding the next preparation',async()=>{const f=fixture();let release!:(value:unknown)=>void;f.request.mockImplementationOnce(()=>new Promise(resolve=>release=resolve));const pending=f.c.prepare();f.selected.value='replacement';release({thread:{id:'t',name:'Native fixture',cwd:'/remote/repo',status:{type:'idle'}}});await pending;expect(f.c.state.value).toBe('idle');await f.c.prepare();expect(f.c.preview.value?.id).toBe('replacement')})
it('does not inspect a replacement selection after lazy control loading',async()=>{const f=fixture();const clickedId=f.selected.value;f.selected.value='replacement';await f.c.prepare(clickedId);expect(f.request).not.toHaveBeenCalled();expect(f.c.preview.value).toBeNull();expect(f.c.state.value).toBe('idle')})
