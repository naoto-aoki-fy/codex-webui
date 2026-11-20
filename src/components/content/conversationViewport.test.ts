import {effectScope,nextTick,reactive} from 'vue'
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

it.each(['visible', 'question switched', 'load failed'] as const)(
  'handles a question jump during history loading when %s',
  async (outcome) => {
    const scope = effectScope()
    const question = (id: number) => ({
      id, method: 'item/tool/requestUserInput', threadId: 'thread', turnId: 'turn',
      itemId: '', receivedAtIso: '', params: null,
    })
    let finishLoad!: () => void
    let failLoad!: (error: Error) => void
    const page = new Promise<void>((resolve, reject) => {
      finishLoad = resolve
      failLoad = reject
    })
    const props = reactive<ConversationProps>({
      messages: [], pendingRequests: [], pendingQuestion: question(1), liveOverlay: null,
      isLoading: false, activeThreadId: 'thread', cwd: '/remote', hasMorePersistedAbove: true,
      loadEarlierMessages: vi.fn().mockReturnValueOnce(page).mockResolvedValueOnce(undefined),
    })
    const viewport = scope.run(() => createConversationViewport({ props }))!
    const ownerDocument = { activeElement: null }
    const initialHeading = {
      getBoundingClientRect: () => ({ top: 350, bottom: 380 }),
      focus: vi.fn(),
      ownerDocument,
    }
    const currentHeading = {
      getBoundingClientRect: () => ({ top: 50, bottom: 80 }),
      focus: vi.fn(),
      ownerDocument,
    }
    const container = {
      clientTop: 0, clientHeight: 200, scrollHeight: 1000, scrollTop: 100,
      getBoundingClientRect: () => ({ top: 0 }),
      querySelector: vi.fn().mockReturnValue(currentHeading),
      scrollTo: vi.fn(),
    }
    viewport.conversationListRef.value = container as unknown as HTMLElement

    try {
      const loading = viewport.loadMoreAbove()
      viewport.jumpToQuestion(initialHeading as unknown as HTMLButtonElement)
      expect(initialHeading.focus).toHaveBeenCalledWith({ preventScroll: true })
      expect(container.scrollTo).toHaveBeenCalledTimes(1)

      if (outcome === 'question switched') {
        props.pendingQuestion = null
        props.pendingQuestion = question(1)
      }
      if (outcome === 'load failed') {
        failLoad(new Error('History failed'))
        await expect(loading).rejects.toThrow('History failed')
        await viewport.loadMoreAbove()
      } else {
        finishLoad()
        await loading
      }

      expect(container.scrollTo).toHaveBeenCalledTimes(1)
      if (outcome === 'visible') {
        expect(currentHeading.focus).toHaveBeenCalledWith({ preventScroll: true })
      } else {
        expect(currentHeading.focus).not.toHaveBeenCalled()
      }
      expect(viewport.isLoadingMore.value).toBe(false)
    } finally {
      scope.stop()
    }
  },
)
