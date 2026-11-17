import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { createConversationActions } from './conversationActions'
import { copyTextToClipboard } from '../../utils/clipboard'

vi.mock('../../utils/clipboard', () => ({ copyTextToClipboard: vi.fn() }))

afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

function setup() {
  const isCurrentThreadGeneration = vi.fn(() => true)
  const actions = createConversationActions({
    threadGeneration: 1, isCurrentThreadGeneration,
    props: {
      messages: [{ id: 'response', role: 'assistant', text: '# Answer\n\n```ts\n1 + 1\n```' }],
      pendingRequests: [], liveOverlay: null, isLoading: false, activeThreadId: 'thread', cwd: '/work',
    },
    readPlan: vi.fn(() => ({ explanation: '', steps: [], copyText: '', hasCopyContent: false })),
    anchoredFileChangeSummaryByAnchorId: computed(() => ({})),
    buildFileChangeCopyText: vi.fn(() => ''), emit: vi.fn(),
  })
  return { actions, isCurrentThreadGeneration }
}

describe('copy assistant response feedback', () => {
  it('reports success only after the helper resolves and resets feedback', async () => {
    vi.useFakeTimers()
    let succeed!: () => void
    vi.mocked(copyTextToClipboard).mockReturnValue(new Promise<void>(resolve => { succeed = resolve }))
    const { actions } = setup()
    const pending = actions.copyResponse('response')
    expect(copyTextToClipboard).toHaveBeenCalledExactlyOnceWith('# Answer\n\n```ts\n1 + 1\n```')
    expect(actions.copiedResponseAnchorId.value).toBe('')
    succeed()
    await pending
    expect(actions.copiedResponseAnchorId.value).toBe('response')
    vi.advanceTimersByTime(1800)
    expect(actions.copiedResponseAnchorId.value).toBe('')
  })

  it('does not retry the fallback or report success after the helper rejects', async () => {
    vi.mocked(copyTextToClipboard).mockRejectedValue(new Error('Copy failed'))
    const { actions } = setup()
    await expect(actions.copyResponse('response')).resolves.toBeUndefined()
    expect(copyTextToClipboard).toHaveBeenCalledOnce()
    expect(actions.copiedResponseAnchorId.value).toBe('')
    expect(actions.copiedMessageResetTimer).toBeNull()
  })

  it('keeps empty content and stale thread feedback ineligible', async () => {
    vi.mocked(copyTextToClipboard).mockResolvedValue(undefined)
    const { actions, isCurrentThreadGeneration } = setup()
    await actions.copyResponse('missing')
    expect(copyTextToClipboard).not.toHaveBeenCalled()
    isCurrentThreadGeneration.mockReturnValue(false)
    await actions.copyResponse('response')
    expect(actions.copiedResponseAnchorId.value).toBe('')
    expect(actions.copiedMessageResetTimer).toBeNull()
  })
})
