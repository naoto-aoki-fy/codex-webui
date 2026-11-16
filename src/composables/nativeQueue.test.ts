import {effectScope,ref} from 'vue'
import {afterEach,expect,it,vi} from 'vitest'
import {createNativeQueue} from './nativeQueue'
import {queueEntry,queuePage,queuedInput} from '../api/nativeQueue'

// These controller tests mock the atomic-storage boundary; the browser fixture
// exercises actual IndexedDB serialization across independent documents.
vi.mock('../utils/browserTransactionalRecords', () => {
 let tail: Promise<unknown> = Promise.resolve()
 return {
  readBrowserRecord: async (_name: string, legacy: () => unknown) => legacy(),
  updateBrowserRecord: (name: string, legacy: () => unknown, action: (value: any) => unknown) => {
   const result = tail.then(() => { const next = action(legacy()); if(typeof window!=='undefined')window.localStorage.setItem(name, JSON.stringify(next)); return next })
   tail = result.catch(() => {}); return result
  }
 }
})
function setup(request:(method:string,params:any)=>Promise<any>){const selected=ref('t'),epoch=ref(0),scope=effectScope();const owner=scope.run(()=>createNativeQueue({selected,epoch,ready:()=>true,blocked:()=>false},request as any))!;return {owner,selected,epoch,stop:()=>scope.stop()}}
const payload={text:'queued text',imageUrls:[],fileAttachments:[],skills:[]}
const queued=(clientId='c')=>({id:'q',clientUserMessageId:clientId,input:[{type:'text',text:'queued text'}]})
afterEach(()=>vi.unstubAllGlobals())
it('requires an observed supported list, sends structured input once and validates native acknowledgment',async()=>{
 let resolve:(v:any)=>void=()=>{};let sent:any
 const request=vi.fn(async(method,params)=>{if(method==='thread/queue/list')return {data:[],nextCursor:null};sent=params;return new Promise(r=>resolve=r)})
 const {owner,stop}=setup(request)
 await expect(owner.add(payload)).rejects.toThrow('Read');await owner.refresh()
 const pending=owner.add(payload);await expect(owner.add(payload)).rejects.toThrow();await vi.waitFor(()=>expect(sent).toBeTruthy());expect(sent.clientUserMessageId).toBeTruthy();resolve({queuedSubmission:queued(sent.clientUserMessageId)})
 await expect(pending).resolves.toBe(true);expect(request.mock.calls.filter(c=>c[0]==='thread/queue/add')).toHaveLength(1);stop()
})
it('preserves images, local file prompt, skill and exact native app mentions',()=>{
 const input=queuedInput({...payload,imageUrls:['data:image/png;base64,AAAA'],fileAttachments:[{label:'a',path:'/remote/a',fsPath:'/remote/a'}],skills:[{name:'skill',path:'/remote/SKILL.md'}],apps:[{id:'native-id',name:'Native app'}]})
 expect(input.map(p=>p.type)).toEqual(['text','image','skill','mention']);expect(input[0]?.text).toContain('/remote/a');expect(input[3]?.path).toBe('app://native-id')
})
it('uncertain writes are never replayed and block another add until explicit inspection acknowledgment',async()=>{
 const request=vi.fn(async(method)=>{if(method==='thread/queue/list')return {data:[],nextCursor:null};throw new Error('network lost')})
 const {owner,epoch,stop}=setup(request);await owner.refresh();await expect(owner.add(payload)).rejects.toThrow('network');expect(owner.uncertain.value).toContain('unknown')
 epoch.value++;await owner.refresh();await expect(owner.add(payload)).rejects.toThrow('Read');expect(request.mock.calls.filter(c=>c[0]==='thread/queue/add')).toHaveLength(1)
 await owner.acknowledgeUnknown();expect(owner.available.value).toBe(true);stop()
})
it('discards read results after selection, connection change and native queue change',async()=>{
 let resolve:(v:any)=>void=()=>{};const {owner,selected,epoch,stop}=setup(async()=>new Promise(r=>resolve=r))
 for(const change of [()=>selected.value='other',()=>epoch.value++,()=>owner.observe({method:'thread/queue/changed',params:{threadId:selected.value},atIso:'x'})]){
  const pending=owner.refresh();change();resolve({data:[queued()],nextCursor:null});await pending;expect(owner.rows.value).toEqual([])
 }stop()
})
it('bounds native payload retention and disables lossy rich-input editing',()=>{
 expect(queueEntry({...queued(),input:[{type:'text',text:'rich',textElements:[{span:{start:0,end:4}}]}]}).input).toBe(null)
 expect(queueEntry({...queued(),input:[{type:'image',url:'x'.repeat(2000001)}]}).input).toBe(null)
 expect(()=>queuePage({data:Array(21).fill(queued())})).toThrow();expect(()=>queuePage({data:[],nextCursor:5})).toThrow()
})
it('updates only the first text and preserves exact image/skill/app inputs and client identity',async()=>{
 const input=[{type:'text',text:'old',text_elements:[]},{type:'image',url:'data:image/png;base64,AAAA'},{type:'skill',name:'s',path:'/remote/SKILL.md'},{type:'mention',name:'App',path:'app://native'}]
 let current={...queued(),input};const request=vi.fn(async(method,params)=>{if(method==='thread/queue/list')return {data:[current],nextCursor:null};current={...current,input:params.input};return {queuedSubmission:current}})
 const {owner,stop}=setup(request);await owner.refresh();await owner.manage('update','q','edited')
 expect(current.input).toEqual([{...input[0],text:'edited'},...input.slice(1)]);expect(request.mock.calls[1]?.[1]).not.toHaveProperty('responsesapiClientMetadata');stop()
})
it('native full-order and exact-ID removal/start do not rewrite a client-owned queue',async()=>{
 let entries=[queued(),{...queued(),id:'q2'}];const request=vi.fn(async(method,params)=>{
  if(method==='thread/queue/list')return {data:entries,nextCursor:null}
  if(method==='thread/queue/reorder'){expect(params.queuedSubmissionIds).toEqual(['q2','q']);entries=entries.slice().reverse();return {}}
  if(method==='thread/queue/delete'){entries=[];return {deleted:false}}
  return {turn:{id:'turn',status:'inProgress'}}
 });const {owner,stop}=setup(request);await owner.refresh();await owner.manage('reorder','q2');expect(owner.rows.value[0]?.id).toBe('q2');await owner.manage('start','q2');expect(owner.status.value).toContain('turn accepted');await owner.manage('delete','q');expect(owner.status.value).toContain('already absent');stop()
})
it('native rejection differs from uncertain transport and stale native snapshots block operations',async()=>{
 const request=vi.fn(async(method)=>{if(method==='thread/queue/list')return {data:[queued()],nextCursor:null};throw Object.assign(new Error('entry gone'),{rpcCode:-32602})})
 const {owner,stop}=setup(request);await owner.refresh();await owner.manage('delete','q');expect(owner.uncertain.value).toBe('');expect(owner.status.value).toContain('rejected');await expect(owner.manage('start','q')).rejects.toThrow('Refresh');stop()
})
it('treats numeric internal errors after queue writes as uncertain rather than rejected',async()=>{
 const request=vi.fn(async(method)=>{if(method==='thread/queue/list')return {data:[],nextCursor:null};throw Object.assign(new Error('storage reply failed'),{rpcCode:-32603})})
 const {owner,stop}=setup(request);await owner.refresh();await expect(owner.add(payload)).rejects.toThrow();expect(owner.uncertain.value).toContain('unknown');await expect(owner.add(payload)).rejects.toThrow('Read');expect(request.mock.calls.filter(c=>c[0]==='thread/queue/add')).toHaveLength(1);stop()
})
it('retains a lost-acknowledgment registration guard across owner recreation and reconnect',async()=>{
 const storage=new Map<string,string>()
 vi.stubGlobal('navigator',{locks:{request:async (_name:string,action:()=>unknown)=>action()}})
 vi.stubGlobal('window',{localStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)}})
 let persisted:any[]=[],clientId=''
 const request=vi.fn(async(method,params)=>{
  if(method==='thread/queue/list')return {data:persisted,nextCursor:null}
  clientId=params.clientUserMessageId;persisted=[queued(clientId)]
  throw new Error('remote enqueue committed; HTTP reply lost')
 })
 const first=setup(request);await first.owner.refresh();await expect(first.owner.add(payload)).rejects.toThrow('reply lost');first.stop()
 expect([...storage.values()].join('')).not.toContain(payload.text)
 const reopened=setup(request);await reopened.owner.refresh();expect(reopened.owner.rows.value[0]?.clientId).toBe(clientId)
 await expect(reopened.owner.add(payload)).rejects.toThrow('Read');reopened.epoch.value++;await reopened.owner.refresh();await expect(reopened.owner.add(payload)).rejects.toThrow('Read')
 expect(request.mock.calls.filter(([method])=>method==='thread/queue/add')).toHaveLength(1)
 // Absence could mean execution; it is never proof that enqueue failed.
 persisted=[];await reopened.owner.refresh();expect(reopened.owner.available.value).toBe(false)
 await reopened.owner.acknowledgeUnknown();expect(reopened.owner.status.value).toContain('can duplicate execution');reopened.stop()
})
it('fails before enqueue when a reload recovery marker cannot be stored',async()=>{
 vi.stubGlobal('navigator',{locks:{request:async (_name:string,action:()=>unknown)=>action()}})
 vi.stubGlobal('window',{localStorage:{getItem:()=>null,setItem:()=>{throw new Error('storage unavailable')}}})
 const request=vi.fn(async()=>({data:[],nextCursor:null})),f=setup(request);await f.owner.refresh()
 await expect(f.owner.add(payload)).rejects.toThrow('storage unavailable');expect(request).toHaveBeenCalledTimes(1);f.stop()
})
