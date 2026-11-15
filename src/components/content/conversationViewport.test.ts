import {effectScope,nextTick} from 'vue'
import {expect,it,vi} from 'vitest'
import {createConversationViewport} from './conversationViewport'
import type {ConversationProps} from './conversationContracts'
it('does not load older history from programmatic bottom scrolling in short viewports; upward scrolling still pages',async()=>{
 const load=vi.fn(async()=>{}),scope=effectScope()
 const viewport=scope.run(()=>createConversationViewport({props:{messages:[],pendingRequests:[],liveOverlay:null,isLoading:false,activeThreadId:'t',cwd:'/remote',hasMorePersistedAbove:true,loadEarlierMessages:load} as ConversationProps}))!
 const container={scrollTop:150,scrollHeight:750,clientHeight:600}
 viewport.conversationListRef.value=container as HTMLElement
 viewport.onConversationScroll();await nextTick();expect(load).not.toHaveBeenCalled()
 container.scrollTop=50;viewport.onConversationScroll();await nextTick();expect(load).toHaveBeenCalledWith('t')
 scope.stop()
})
