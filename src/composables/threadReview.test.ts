import {ref} from 'vue'
import {expect,it,vi} from 'vitest'
import {createThreadReview,reviewTarget} from './threadReview'
it('serializes only the supported distinct targets',()=>{
 expect(reviewTarget('uncommittedChanges','ignored')).toEqual({type:'uncommittedChanges'})
 expect(reviewTarget('baseBranch',' main ')).toEqual({type:'baseBranch',branch:'main'})
 expect(reviewTarget('commit','sha')).toEqual({type:'commit',sha:'sha'})
 expect(reviewTarget('custom','check')).toEqual({type:'custom',instructions:'check'})
 expect(()=>reviewTarget('commit','')).toThrow()
})
it('guards active work and duplicates, uses native review and matches completion',async()=>{
 const epoch=ref(0),selected=ref('t'),blocked=vi.fn(()=>true),interrupt=vi.fn(async()=>{}),request=vi.fn(async()=>({reviewThreadId:'t',turn:{id:'r'}}))
 const action=createThreadReview({epoch,selected,blocked,interrupt,ready:()=>true},request)
 await action.run();expect(request).not.toHaveBeenCalled();blocked.mockReturnValue(false)
 await action.run();await action.run();expect(request).toHaveBeenCalledTimes(1)
 expect(request).toHaveBeenCalledWith('review/start',{threadId:'t',delivery:'inline',target:{type:'uncommittedChanges'}})
 await action.cancel();expect(interrupt).toHaveBeenCalledTimes(1)
 action.observe({method:'turn/completed',params:{threadId:'t',turn:{id:'other',status:'completed'}},atIso:''});expect(action.busy.value).toBe(true)
 action.observe({method:'turn/completed',params:{threadId:'t',turn:{id:'r',status:'interrupted'}},atIso:''});expect(action.status.value).toContain('interrupted')
 await action.run();epoch.value++;expect(action.status.value).toContain('unknown');expect(action.busy.value).toBe(false)
})
it('uses the acknowledged review identity before lifecycle events and reconciles completion before its reply',async()=>{
 const epoch=ref(0),selected=ref('t'),interrupt=vi.fn(async(_thread:string,_turn:string)=>{})
 let resolve!:(value:unknown)=>void
 const request=vi.fn(()=>new Promise(r=>resolve=r))
 const action=createThreadReview({epoch,selected,blocked:()=>false,ready:()=>true,interrupt},request)
 const pending=action.run()
 action.observe({method:'turn/completed',params:{threadId:'t',turn:{id:'early',status:'completed'}},atIso:''})
 resolve({reviewThreadId:'t',turn:{id:'early'}});await pending
 expect(action.busy.value).toBe(false);expect(action.status.value).toBe('Native review completed.')
 const next=action.run();resolve({reviewThreadId:'t',turn:{id:'cancel-before-start'}});await next;await action.cancel()
 expect(interrupt).toHaveBeenCalledWith('t','cancel-before-start')
 expect(action.status.value).toContain('interruption requested')
})
