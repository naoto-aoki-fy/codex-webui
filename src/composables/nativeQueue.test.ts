import {effectScope,ref} from 'vue'
import {expect,it,vi} from 'vitest'
import {createNativeQueue} from './nativeQueue'
import {queueEntry,queuePage,queuedInput} from '../api/nativeQueue'
function setup(request:(method:string,params:any)=>Promise<any>){const selected=ref('t'),epoch=ref(0),scope=effectScope();const owner=scope.run(()=>createNativeQueue({selected,epoch,ready:()=>true,blocked:()=>false},request as any))!;return {owner,selected,epoch,stop:()=>scope.stop()}}
const payload={text:'queued text',imageUrls:[],fileAttachments:[],skills:[]}
const queued=(clientId='c')=>({id:'q',clientUserMessageId:clientId,input:[{type:'text',text:'queued text'}]})
it('requires an observed supported list, sends structured input once and validates native acknowledgment',async()=>{
 let resolve:(v:any)=>void=()=>{};let sent:any
 const request=vi.fn(async(method,params)=>{if(method==='thread/queue/list')return {data:[],nextCursor:null};sent=params;return new Promise(r=>resolve=r)})
 const {owner,stop}=setup(request)
 await expect(owner.add(payload)).rejects.toThrow('Read');await owner.refresh()
 const pending=owner.add(payload);await expect(owner.add(payload)).rejects.toThrow();expect(sent.clientUserMessageId).toBeTruthy();resolve({queuedSubmission:queued(sent.clientUserMessageId)})
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
 owner.acknowledgeUnknown();expect(owner.available.value).toBe(true);stop()
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
