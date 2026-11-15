import {ref} from 'vue'
import {afterEach,expect,it,vi} from 'vitest'
import {createNativeAuthentication} from './nativeAuthentication'
import {prepareAuthentication,nativeLogin} from '../api/nativeAuthentication'
const cleanup:(()=>void)[]=[]
afterEach(()=>cleanup.splice(0).forEach(fn=>fn()))
const loginId='00000000-0000-4000-8000-000000000029'
const browserResult={type:'chatgpt',loginId,authUrl:'https://auth.openai.com/fixture-only'}
const deviceResult={type:'chatgptDeviceCode',loginId,verificationUrl:'https://auth.openai.com/fixture-device',userCode:'FIXTURE-CODE'}
function fixture(override?:(method:string,params:any)=>Promise<any>|undefined){let signedIn=false;const epoch=ref(0),ready=ref(true),blocked=ref(false),reset=vi.fn(async()=>{})
 const request=vi.fn(async(method:string,params:any)=>{const custom=override?.(method,params);if(custom!==undefined)return custom
  if(method==='account/read')return {account:signedIn?{type:'chatgpt',email:'fixture@example.invalid',planType:'plus'}:null,requiresOpenaiAuth:true}
  if(method==='configRequirements/read')return {requirements:{allowed_login_methods:['chatgpt']}}
  if(method==='thread/loaded/list')return {data:['t'],nextCursor:null}
  if(method==='thread/read')return {thread:{id:params.threadId,status:{type:'idle'}}}
  if(method==='account/login/start')return params.type==='chatgpt'?browserResult:deviceResult
  if(method==='account/login/cancel')return {status:'canceled'}
  throw new Error('Unexpected fixture request')
 });const owner=createNativeAuthentication({epoch,ready:()=>ready.value,blocked:()=>blocked.value,reconnectAndReload:reset},request);cleanup.push(owner.dispose)
 return {owner,request,epoch,ready,blocked,reset,signIn:()=>{signedIn=true}}
}
const event=(success=true,id=loginId,error:string|null=null)=>({method:'account/login/completed',params:{loginId:id,success,error},atIso:'fixture'})
it('requires signed-out auth policy and a complete bounded idle inventory without resuming/reading histories',async()=>{
 const f=fixture();await f.owner.prepare();expect(f.owner.state.value).toBe('prepared');expect(f.request.mock.calls.filter(([m])=>m==='thread/read')[0]?.[1]).toEqual({threadId:'t',includeTurns:false});expect(f.request.mock.calls.some(([m])=>m==='account/login/start')).toBe(false)
 for(const override of [(m:string)=>m==='thread/loaded/list'?Promise.resolve({data:Array.from({length:21},(_,i)=>String(i)),nextCursor:null}):undefined,(m:string)=>m==='thread/read'?Promise.resolve({thread:{id:'t',status:{type:'active'}}}):undefined,(m:string)=>m==='configRequirements/read'?Promise.resolve({requirements:{allowed_login_methods:[]}}):undefined]){const blocked=fixture(override);await blocked.owner.prepare();expect(blocked.owner.state.value).toBe('rejected');expect(blocked.request.mock.calls.some(([m])=>m==='account/login/start')).toBe(false)}
})
it('waits for exact native completion and actual account before requiring cache reconciliation',async()=>{
 const f=fixture();await f.owner.prepare();await f.owner.start('chatgpt',false);expect(f.request.mock.calls.some(([m])=>m==='account/login/start')).toBe(false)
 await f.owner.start('chatgpt',true);expect(f.owner.state.value).toBe('waiting');expect(f.owner.blocking.value).toBe(true)
 f.owner.observe(event(true,'other'));expect(f.owner.state.value).toBe('waiting');f.signIn();f.owner.observe(event());await vi.waitFor(()=>expect(f.owner.state.value).toBe('completed'));expect(f.owner.url.value).toBe('');expect(f.owner.code.value).toBe(null);expect(f.owner.needsRefresh.value).toBe(true);await f.owner.refreshConnection();expect(f.reset).toHaveBeenCalledOnce()
})
it('handles native completion before HTTP acknowledgment without exposing a stale sign-in link',async()=>{
 let release:(v:any)=>void=()=>{};const f=fixture(m=>m==='account/login/start'?new Promise(r=>release=r):undefined);await f.owner.prepare();const pending=f.owner.start('chatgpt',true);await vi.waitFor(()=>expect(f.request.mock.calls.some(([m])=>m==='account/login/start')).toBe(true));f.signIn();f.owner.observe(event());release(browserResult);await pending;expect(f.owner.state.value).toBe('completed');expect(f.owner.url.value).toBe('')
})
it('cancels only the identified native session, including deliberate cancellation before its ID arrives',async()=>{
 let release:(v:any)=>void=()=>{};const f=fixture(m=>m==='account/login/start'?new Promise(r=>release=r):undefined);await f.owner.prepare();const pending=f.owner.start('chatgptDeviceCode',true);await vi.waitFor(()=>expect(f.request.mock.calls.some(([m])=>m==='account/login/start')).toBe(true));await f.owner.cancel();release(deviceResult);await pending;expect(f.owner.state.value).toBe('canceled');expect(f.request.mock.calls.find(([m])=>m==='account/login/cancel')?.[1]).toEqual({loginId});expect(f.owner.code.value).toBe(null);expect(f.owner.blocking.value).toBe(false)
})
it('keeps internal errors/unknown outcomes blocked with no replay and requires explicit unknown reconciliation',async()=>{
 const f=fixture(m=>m==='account/login/start'?Promise.reject(Object.assign(new Error('native storage reply failed'),{rpcCode:-32603})):undefined);await f.owner.prepare();await f.owner.start('chatgpt',true);expect(f.owner.state.value).toBe('unknown');await f.owner.start('chatgpt',true);expect(f.request.mock.calls.filter(([m])=>m==='account/login/start')).toHaveLength(1);await f.owner.inspect();await f.owner.refreshConnection();expect(f.reset).not.toHaveBeenCalled();await f.owner.refreshConnection(true);expect(f.reset).toHaveBeenCalledOnce()
})
it('clears URLs/codes and refuses late responses after connection change',async()=>{
 const f=fixture();await f.owner.prepare();await f.owner.start('chatgptDeviceCode',true);expect(f.owner.code.value).toBe('FIXTURE-CODE');f.ready.value=false;f.epoch.value++;expect(f.owner.code.value).toBe(null);expect(f.owner.url.value).toBe('');expect(f.owner.loginId.value).toBe('');expect(f.owner.state.value).toBe('unknown');f.owner.observe(event());expect(f.owner.state.value).toBe('unknown');expect(f.request.mock.calls.filter(([m])=>m==='account/login/start')).toHaveLength(1)
})
it('handles server-reported expiration and unsafe URLs without logging or storing credentials',async()=>{
 const f=fixture();await f.owner.prepare();await f.owner.start('chatgptDeviceCode',true);f.owner.observe(event(false,loginId,'code expired token=PRIVATE'));await vi.waitFor(()=>expect(f.owner.state.value).toBe('failed'));expect(f.owner.status.value).not.toContain('PRIVATE');expect(f.owner.code.value).toBe(null)
 for(const authUrl of ['javascript:alert(1)','https://user:password@example.invalid/','http://untrusted.example.invalid/'])expect(()=>nativeLogin({...browserResult,authUrl},'chatgpt')).toThrow()
})
it('native completion winning a cancellation race cannot be reported as successful cancellation',async()=>{
 let release:(v:any)=>void=()=>{};const f=fixture(m=>m==='account/login/cancel'?new Promise(r=>release=r):undefined);await f.owner.prepare();await f.owner.start('chatgpt',true);const cancel=f.owner.cancel();f.signIn();f.owner.observe(event());release({status:'notFound'});await cancel;expect(f.owner.state.value).toBe('completed');expect(f.owner.needsRefresh.value).toBe(true)
})
it('invalidates prepared authentication when another native account change is observed',async()=>{
 const f=fixture();await f.owner.prepare();f.owner.observe({method:'account/updated',params:{authMode:'chatgpt'},atIso:'x'});await f.owner.start('chatgpt',true);expect(f.owner.preparation.value).toBe(null);expect(f.request.mock.calls.some(([m])=>m==='account/login/start')).toBe(false)
})
it('rejects incomplete/malformed idle inventories instead of inferring no active work',async()=>{
 for(const loaded of [{data:[],nextCursor:'more'},{data:[]},{data:['t','t'],nextCursor:null},{data:['t',null],nextCursor:null}]){
  const f=fixture(m=>m==='thread/loaded/list'?Promise.resolve(loaded):undefined);await f.owner.prepare();expect(f.owner.state.value).toBe('rejected');expect(f.request.mock.calls.some(([m])=>m==='account/login/start')).toBe(false)
 }
 const f=fixture(m=>m==='thread/read'?Promise.resolve({thread:{id:'t'}}):undefined);await f.owner.prepare();expect(f.owner.state.value).toBe('rejected')
})
it('invalidates a start preflight and delayed account reads on an account change',async()=>{
 const f=fixture();await f.owner.prepare();let release!:(value:any)=>void
 f.request.mockImplementationOnce(()=>new Promise(resolve=>release=resolve))
 const starting=f.owner.start('chatgpt',true);f.owner.observe({method:'account/updated',params:{authMode:'chatgpt'},atIso:'x'})
 release({account:null,requiresOpenaiAuth:true});await starting;expect(f.owner.state.value).toBe('unknown');expect(f.request.mock.calls.some(([m])=>m==='account/login/start')).toBe(false)
 f.request.mockImplementationOnce(()=>new Promise(resolve=>release=resolve));const reading=f.owner.inspect()
 f.owner.observe({method:'account/updated',params:{authMode:'chatgpt'},atIso:'y'});release({account:{type:'chatgpt',email:'STALE@example.invalid'},requiresOpenaiAuth:true});await reading
 expect(f.owner.account.value).toBeNull();expect(f.owner.blocking.value).toBe(true)
})
it('does not complete the idle check while a listed thread inspection is still unresolved',async()=>{
 let release!:(value:any)=>void,reads=0
 const f=fixture(m=>m==='thread/loaded/list'?Promise.resolve({data:['t','last'],nextCursor:null}):m==='thread/read'&&++reads===2?new Promise(resolve=>release=resolve):undefined)
 const pending=f.owner.prepare();await vi.waitFor(()=>expect(release).toBeTypeOf('function'));expect(f.owner.state.value).toBe('preparing')
 release({thread:{id:'last',status:{type:'active'}}});await pending;expect(f.owner.state.value).toBe('rejected');expect(f.request.mock.calls.some(([m])=>m==='account/login/start')).toBe(false)
})
