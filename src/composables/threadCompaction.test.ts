import { ref } from 'vue'
import { expect,it,vi } from 'vitest'
import { createThreadCompaction } from './threadCompaction'
function setup(){const epoch=ref(0), selected=ref('t'), blocked=vi.fn(()=>false),refresh=vi.fn(async()=>{}),request=vi.fn(async()=>({}));return {epoch,selected,blocked,refresh,request,action:createThreadCompaction({epoch,selected,blocked,refresh,ready:()=>true},request)}}
const event=(method:string,item:any)=>({method,params:{threadId:'t',item},atIso:''})
it('guards overlap and only confirms completion for the observed native compaction item',async()=>{
 const {action,request,refresh,blocked}=setup();blocked.mockReturnValue(true);await action.run();expect(request).not.toHaveBeenCalled();blocked.mockReturnValue(false)
 await action.run();await action.run();expect(request).toHaveBeenCalledTimes(1);expect(action.state.value).toBe('pending')
 action.observe(event('item/completed',{id:'wrong',type:'contextCompaction'}));expect(action.state.value).toBe('pending')
 action.observe(event('item/started',{id:'c',type:'contextCompaction'}));action.observe(event('item/completed',{id:'c',type:'contextCompaction'}));expect(action.state.value).toBe('completed');expect(refresh).toHaveBeenCalledWith('t')
})
it('does not retry unknown outcomes or let stale acknowledgments mark success',async()=>{
 const s=setup();await s.action.run();s.epoch.value++;expect(s.action.state.value).toBe('unknown');expect(s.request).toHaveBeenCalledTimes(1)
 s.action.observe(event('item/completed',{id:'c',type:'contextCompaction'}));expect(s.action.state.value).toBe('unknown')
})
it('distinguishes explicit unsupported from permission rejection and unknown transport failure',async()=>{
 const s=setup();for(const [error,state] of [[{rpcCode:-32601},'unsupported'],[{rpcCode:-32000},'failed'],[new Error('disconnect'),'unknown']] as const){s.request.mockRejectedValueOnce(error);await s.action.run();expect(s.action.state.value).toBe(state)}
})
