import {afterEach,expect,it,vi} from 'vitest'
import {ref} from 'vue'
import {createNativeShell} from './nativeShell'
import {inspectShell,shellParameters,shellResult} from '../api/nativeShell'
const stops:(()=>void)[]=[]
afterEach(()=>stops.splice(0).forEach(stop=>stop()))
function fixture(){const epoch=ref(0),selected=ref('t'),blocked=ref(false),ready=ref(true)
 const request=vi.fn(async(method:string,params:any):Promise<any>=>method==='thread/read'?{thread:{id:params.threadId,cwd:'/remote/project',status:{type:'idle'},environments:[{environmentId:'local',cwd:'/remote/project'}]}}:method==='environment/info'?{shell:{name:'bash',path:'/bin/bash'},cwd:'file:///server'}:method==='command/exec'?{exitCode:0,stdout:'safe stdout',stderr:''}:{})
 const c=createNativeShell({epoch,selected,blocked:()=>blocked.value,ready:()=>ready.value},request);stops.push(c.dispose);return {c,request,epoch,selected,blocked,ready}
}
it('requires a matching local environment and configured POSIX shell with no fallback',async()=>{
 for(const environments of [undefined,[],[{environmentId:'remote',cwd:'/remote/project'}],[{environmentId:'local',cwd:'/other'}]])await expect(inspectShell('t',async()=>({thread:{id:'t',cwd:'/remote/project',status:{type:'idle'},environments}}))).rejects.toThrow('environment')
 await expect(inspectShell('t',async(method)=>method==='thread/read'?{thread:{id:'t',cwd:'/r',status:{type:'idle'},environments:[{environmentId:'local',cwd:'/r'}]}}:{shell:{name:'powershell',path:'C:\\shell'}})).rejects.toThrow('POSIX')
})
it('submits only after confirmation and revalidation with exact readonly native parameters',async()=>{
 const {c,request}=fixture();await c.inspect();expect(request.mock.calls.map(row=>row[0])).toEqual(['thread/read','environment/info']);await c.run('pwd',false);expect(request).toHaveBeenCalledTimes(2);await c.run('pwd',true);expect(c.state.value).toBe('completed');expect(c.output.value).toMatchObject({exitCode:0,stdout:'safe stdout'});expect(request.mock.calls.at(-1)).toEqual(['command/exec',{command:['/bin/bash','-c','pwd'],processId:expect.any(String),cwd:'/remote/project',timeoutMs:30000,outputBytesCap:65536,sandboxPolicy:{type:'readOnly',networkAccess:false}}]);expect(request.mock.calls.some(row=>/turn\/|thread\/shell/.test(row[0]))).toBe(false)
})
it('does not duplicate a pending command or claim completion before its native final reply',async()=>{
 const {c,request}=fixture();await c.inspect();let release!:(value:unknown)=>void;request.mockImplementation(async(method,params)=>method==='thread/read'?{thread:{id:params.threadId,cwd:'/remote/project',status:{type:'idle'},environments:[{environmentId:'local',cwd:'/remote/project'}]}}:method==='environment/info'?{shell:{name:'bash',path:'/bin/bash'}}:method==='command/exec'?new Promise(resolve=>release=resolve):{});const running=c.run('sleep 1',true);await vi.waitFor(()=>expect(release).toBeTypeOf('function'));expect(c.state.value).toBe('requested');await c.run('duplicate',true);expect(request.mock.calls.filter(row=>row[0]==='command/exec')).toHaveLength(1);const id=c.processId.value;await c.terminate();expect(request.mock.calls.at(-1)).toEqual(['command/exec/terminate',{processId:id}]);expect(c.state.value).toBe('requested');release({exitCode:143,stdout:'',stderr:'stopped'});await running;expect(c.output.value?.exitCode).toBe(143);expect(c.state.value).toBe('completed')
})
it('drops stale context loads and prevents a changed/unmounted preflight from writing',async()=>{
 const f=fixture();f.selected.value='replacement';await f.c.inspect('t');expect(f.request).not.toHaveBeenCalled();f.selected.value='t';await f.c.inspect();f.request.mockImplementationOnce(async()=>({thread:{id:'t',cwd:'/different',status:{type:'idle'},environments:[{environmentId:'local',cwd:'/different'}]}}));await f.c.run('pwd',true);expect(f.c.state.value).toBe('rejected');expect(f.request.mock.calls.some(row=>row[0]==='command/exec')).toBe(false)
 const g=fixture();await g.c.inspect();await g.c.run('pwd',true,()=>false);expect(g.request.mock.calls.some(row=>row[0]==='command/exec')).toBe(false)
})
it('keeps internal/transport outcomes unknown, never replays and rejects stale completion',async()=>{
 for(const code of [-32601,-32603,undefined]){const f=fixture();await f.c.inspect();const original=f.request.getMockImplementation()!;f.request.mockImplementation(async(method,params)=>{if(method==='command/exec')throw Object.assign(new Error('token=SECRET'),{rpcCode:code});return original(method,params)});await f.c.run('pwd',true);expect(f.c.state.value).toBe(code===-32601?'rejected':'unknown');expect(f.c.status.value).not.toContain('SECRET');await f.c.run('replay',true);expect(f.request.mock.calls.filter(row=>row[0]==='command/exec')).toHaveLength(1)}
 const f=fixture();await f.c.inspect();const original=f.request.getMockImplementation()!;let release!:(value:unknown)=>void;f.request.mockImplementation(async(method,params)=>method==='command/exec'?new Promise(resolve=>release=resolve):original(method,params));const pending=f.c.run('pwd',true);await vi.waitFor(()=>expect(release).toBeTypeOf('function'));f.epoch.value++;release({exitCode:0,stdout:'OLD',stderr:''});await pending;expect(f.c.state.value).toBe('unknown');expect(f.c.output.value).toBeNull();await f.c.terminate();expect(f.request.mock.calls.some(row=>row[0]==='command/exec/terminate')).toBe(false)
})
it('bounds redacts and safely projects malformed native outputs and command text',()=>{
 expect(shellResult({exitCode:0,stdout:'token=SECRET\n'+'x'.repeat(200000),stderr:'<script>BAD</script>'})).toMatchObject({bounded:true,stderr:'<script>BAD</script>'});const r=shellResult({exitCode:0,stdout:'x'.repeat(200000),stderr:''});expect(r.stdout.length).toBeLessThanOrEqual(12000);expect(()=>shellResult({exitCode:'0',stdout:'',stderr:''})).toThrow();expect(()=>shellParameters({threadId:'t',cwd:'/r',path:'/bin/sh',shell:'sh',checkedAt:''},'x'.repeat(8001),'id')).toThrow()
})
