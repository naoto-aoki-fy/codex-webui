import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import * as vue from 'vue'
import hljs from 'highlight.js/lib/common'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Execute the real setup script with reactive props and controlled async/DOM boundaries.
const source = readFileSync(resolve('src/components/content/ThreadConversation.vue'), 'utf8').split('<script setup lang="ts">')[1]!.split('</script>')[0]!
const parsed = ts.createSourceFile('conversation.ts', source, ts.ScriptTarget.Latest, true)
const imports: Record<string, unknown> = {}
for (const node of parsed.statements) {
  if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly) continue
  const path = (node.moduleSpecifier as ts.StringLiteral).text
  imports[path] = path.endsWith('.vue') ? {} : path === 'vue' ? vue : await import(/* @vite-ignore */ resolve('src/components/content', path))
}
const update = vi.fn()
const cleanups: Array<() => void> = []
function setup(initial: Record<string, unknown> = {}) {
  const props = vue.reactive({ activeThreadId: 'A', cwd: '/tmp', messages: [], pendingRequests: [], liveOverlay: null, isLoading: false, ...initial })
  const emit = vi.fn()
  const scope = vue.effectScope()
  const unmount: Array<() => void> = []
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('window', { removeEventListener() {} })
  const parseCalls = vi.fn()
  const instrumentedSource = source.replace('function parseMessageBlocks(text: string): MessageBlock[] {', 'function parseMessageBlocks(text: string): MessageBlock[] { recordParse();')
  const code = ts.transpileModule(instrumentedSource + `\nreturn { openDiffViewer, closeDiffViewer, selectDiffViewerChange, activeDiffViewerChange, activeDiffViewerSummary, activeDiffViewerChangeKey, isDiffViewerFileListOpen, isFileLinkContextMenuVisible, fileLinkContextBrowseUrl, expandedWorkedIds, expandedCommandIds, failedMarkdownImages, onMarkdownImageError, isMarkdownImageFailed, loadMoreAbove, conversationListRef, renderWindowStart, isLoadingMore, scheduleConversationScroll, editMessage, forkResponse, bindPendingImageHandlers, getMessageBlocks, renderMarkdownBlocksAsHtml, renderCachedHighlightedCodeAsHtml, highlightCacheVersion, visibleMessages, autoFollowOutput, messageBlockCache, inlineSegmentCache, markdownHtmlCache, highlightHtmlCache };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const state = scope.run(() => new Function('exports', 'require', 'defineProps', 'defineEmits', 'defineExpose', 'recordParse', code)({}, (path: string) => {
    if (path === 'highlight.js/lib/common') return { default: hljs }
    if (path === 'vue') return { ...vue, onMounted() {}, onBeforeUnmount: (fn: () => void) => unmount.push(fn) }
    if (path.includes('codexGateway')) return { updateThreadFileChanges: update }
    if (path.includes('useMobile')) return { useMobile: () => ({ isMobile: vue.ref(false) }) }
    return imports[path]
  }, () => props, () => emit, () => {}, parseCalls))!
  cleanups.push(() => { unmount.forEach(fn => fn()); scope.stop() })
  return { props, state, frames, emit, parseCalls }
}
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.unstubAllGlobals(); update.mockReset() })
const deferred = () => { let resolve!: (value: any) => void; let reject!: (error: Error) => void; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

describe('conversation thread state isolation', () => {
  it('dismisses diff/context state and expansions only on identity changes', async () => {
    const { props, state: s } = setup()
    s.activeDiffViewerSummary.value = { turnId: 'turn', changes: [] }
    s.activeDiffViewerChangeKey.value = 'file'
    s.isDiffViewerFileListOpen.value = true
    s.isFileLinkContextMenuVisible.value = true
    s.fileLinkContextBrowseUrl.value = '/old'
    s.expandedWorkedIds.value.add('shared')
    await vue.nextTick()
    expect(s.activeDiffViewerSummary.value).not.toBeNull()
    props.activeThreadId = 'B'
    await vue.nextTick()
    expect(s.activeDiffViewerSummary.value).toBeNull()
    expect(s.activeDiffViewerChangeKey.value).toBe('')
    expect(s.isDiffViewerFileListOpen.value).toBe(false)
    expect(s.isFileLinkContextMenuVisible.value).toBe(false)
    expect(s.fileLinkContextBrowseUrl.value).toBe('')
    expect(s.expandedWorkedIds.value.size).toBe(0)
  })
  it('keeps viewer selection and close state in the conversation', async () => {
    const { props, state: s } = setup()
    const first = { path: 'a.ts', operation: 'update', diff: '+first', addedLineCount: 1, removedLineCount: 0 }
    const second = { ...first, path: 'b.ts', diff: '+second' }
    s.openDiffViewer({ turnId: 'turn', changes: [first, second] }, second)
    expect(s.activeDiffViewerChange.value.path).toBe('b.ts')
    s.selectDiffViewerChange(first)
    expect(s.activeDiffViewerChange.value.path).toBe('a.ts')
    s.closeDiffViewer()
    expect(s.activeDiffViewerChange.value).toBeNull()
    s.openDiffViewer({ turnId: 'turn', changes: [first] }, first)
    props.activeThreadId = 'B'
    props.activeThreadId = 'A'
    await vue.nextTick()
    expect(s.activeDiffViewerChange.value).toBeNull()
  })
  it('scopes failed images to URL and thread while preserving same-thread failures', async () => {
    const { props, state: s } = setup()
    s.onMarkdownImageError('message', 0, 'old.png')
    expect(s.isMarkdownImageFailed('message', 0, 'old.png')).toBe(true)
    expect(s.isMarkdownImageFailed('message', 0, 'new.png')).toBe(false)
    props.activeThreadId = 'B'
    await vue.nextTick()
    expect(s.isMarkdownImageFailed('message', 0, 'old.png')).toBe(false)
  })
  it('settles canceled scroll work and ignores queued nextTick work after unmount', async () => {
    const { props, state: s, frames } = setup()
    const old = s.scheduleConversationScroll()
    await vue.nextTick()
    props.activeThreadId = 'B'
    await old
    await vue.nextTick()
    expect(frames.size).toBeLessThanOrEqual(1)
    cleanups.splice(0).forEach(fn => fn())
    await vue.nextTick()
    expect(frames.size).toBe(0)
  })
  it('does not restore old history scroll or clear a new loading operation after A → B → A', async () => {
    const { props, state: s } = setup()
    const first = deferred()
    const second = deferred()
    Object.assign(props, { hasMorePersistedAbove: true, loadEarlierMessages: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) })
    const container = { scrollHeight: 100, scrollTop: 10 }
    s.conversationListRef.value = container
    const old = s.loadMoreAbove()
    props.activeThreadId = 'B'
    await vue.nextTick()
    props.activeThreadId = 'A'
    await vue.nextTick()
    const current = s.loadMoreAbove()
    container.scrollHeight = 200
    first.resolve(undefined)
    await old
    expect(container.scrollTop).toBe(10)
    expect(s.isLoadingMore.value).toBe(true)
    second.resolve(undefined)
    await current
    expect(container.scrollTop).toBe(110)
    expect(s.isLoadingMore.value).toBe(false)
  })
  it('ignores old image-settled callbacks and rebinds reused DOM images for the new visit', async () => {
    const { props, state: s, frames } = setup()
    const listeners: Array<() => void> = []
    const image = { complete: false, addEventListener: (_: string, fn: () => void) => listeners.push(fn) }
    s.conversationListRef.value = { querySelectorAll: () => [image] }
    s.bindPendingImageHandlers()
    const oldLoad = listeners[0]!
    props.activeThreadId = 'B'
    await vue.nextTick()
    s.bindPendingImageHandlers()
    const before = frames.size
    oldLoad()
    expect(frames.size).toBe(before)
    expect(listeners).toHaveLength(4)
  })
  it('defaults response forks to native and preserves portable cutoffs and disabled boundaries', () => {
    const { props, state: s, emit } = setup({ messages: [
      { id: 'answer', role: 'assistant', text: 'answer', turnId: 'turn', turnIndex: 3 },
      { id: 'imported', role: 'assistant', text: 'imported answer', turnIndex: -2 },
    ] })
    s.forkResponse('answer')
    expect(emit).toHaveBeenLastCalledWith('forkThread', { threadId: 'A', turnIndex: 3, method: 'native' })
    s.forkResponse('answer', 'portable')
    expect(emit).toHaveBeenLastCalledWith('forkThread', { threadId: 'A', turnIndex: 3, method: 'portable' })
    s.forkResponse('imported', 'native')
    expect(emit).toHaveBeenCalledTimes(2)
    s.forkResponse('imported', 'portable')
    expect(emit).toHaveBeenLastCalledWith('forkThread', { threadId: 'A', turnIndex: -2, method: 'portable' })
    Object.assign(props, { isForkDisabled: true })
    s.forkResponse('answer')
    s.forkResponse('answer', 'portable')
    expect(emit).toHaveBeenCalledTimes(3)
  })
  it('preserves same-thread streaming UI choices and parent-owned rollback', async () => {
    const { props, state: s, emit } = setup()
    const user = { id: 'user', role: 'user', text: 'question', turnId: 'turn', turnIndex: 0 }
    const command = { id: 'cmd', role: 'assistant', text: '', messageType: 'commandExecution', commandExecution: { status: 'completed', command: 'pwd', output: '' } }
    Object.assign(props, { messages: [user, command] })
    await vue.nextTick()
    s.expandedCommandIds.value.add('cmd')
    s.expandedWorkedIds.value.add('worked')
    s.activeDiffViewerSummary.value = { turnId: 'turn', changes: [] }
    s.isFileLinkContextMenuVisible.value = true
    Object.assign(props, { messages: [user, command, { id: 'live', role: 'assistant', text: 'streaming' }] })
    await vue.nextTick()
    expect(s.expandedCommandIds.value.has('cmd')).toBe(true)
    expect(s.expandedWorkedIds.value.has('worked')).toBe(true)
    expect(s.activeDiffViewerSummary.value).not.toBeNull()
    expect(s.isFileLinkContextMenuVisible.value).toBe(true)
    s.editMessage('user')
    expect(emit).toHaveBeenLastCalledWith('rollback', { threadId: 'A', turnId: 'turn', operation: 'fork-and-revert' })
    s.editMessage('user', 'revert')
    expect(emit).toHaveBeenLastCalledWith('rollback', { threadId: 'A', turnId: 'turn', operation: 'revert' })
    s.editMessage('user', 'fork-and-revert')
    expect(emit).toHaveBeenLastCalledWith('rollback', { threadId: 'A', turnId: 'turn', operation: 'fork-and-revert' })
    Object.assign(props, { isRevertDisabled: true })
    s.editMessage('user')
    expect(emit).toHaveBeenCalledTimes(3)
  })
})

describe('conversation Markdown characterization', () => {
  const message = (text: string, id = 'markdown') => ({ id, role: 'assistant', text })

  it('renders ordinary Markdown and inline code with escaped HTML', () => {
    const { state: s } = setup()
    const html = s.renderMarkdownBlocksAsHtml('# Title\n\n**bold** and `a < b`')
    expect(html).toContain('<h1')
    expect(html).toMatch(/<strong[^>]*>bold<\/strong>/u)
    expect(html).toContain('a &lt; b')
    expect(html).not.toContain('a < b')
  })

  it.each(['```', '~~~'])('loads highlighting for %s, including incomplete streaming fences', async fence => {
    const { props, state: s } = setup()
    const partial = `${fence}js\nconst n = 1`
    expect(s.renderMarkdownBlocksAsHtml(partial)).not.toContain('hljs-keyword')
    Object.assign(props, { messages: [message(`${fence}js\nconst n = 1`)] })
    for (let i = 0; i < 8; i++) await vue.nextTick()
    expect(s.highlightCacheVersion.value).toBe(1)
    expect(s.renderMarkdownBlocksAsHtml(`${fence}js\nconst n = 1`)).toContain('hljs-keyword')
    Object.assign(props, { messages: [message(`${fence}python\nreturn True\n${fence}`)] })
    await vue.nextTick()
    expect(s.getMessageBlocks(props.messages[0])).toEqual([{ kind: 'codeBlock', language: 'python', value: 'return True' }])
    expect(s.renderMarkdownBlocksAsHtml(`${fence}python\nreturn True\n${fence}`)).toContain('hljs-keyword')
    expect(s.highlightCacheVersion.value).toBe(1)
  })

  it('reuses unchanged blocks and reparses same-ID text or cwd changes', () => {
    const { props, state: s, parseCalls } = setup()
    const first = s.getMessageBlocks(message('first'))
    for (let i = 0; i < 100; i++) expect(s.getMessageBlocks(message('first'))).toBe(first)
    expect(parseCalls).toHaveBeenCalledTimes(1)
    expect(s.getMessageBlocks(message('second'))).toEqual([{ kind: 'paragraph', value: 'second' }])
    props.cwd = '/other'
    s.getMessageBlocks(message('second'))
    expect(parseCalls).toHaveBeenCalledTimes(3)
    expect(s.messageBlockCache.size).toBe(1)
  })

  it('parses each changed streaming snapshot once and bounds retained message entries', () => {
    const { state: s, parseCalls } = setup()
    for (let i = 1; i <= 20; i++) {
      const snapshot = message('x'.repeat(i))
      s.getMessageBlocks(snapshot)
      s.getMessageBlocks(snapshot)
    }
    expect(parseCalls).toHaveBeenCalledTimes(20)
    expect(s.messageBlockCache.size).toBe(1)
    for (let i = 0; i < 400; i++) s.getMessageBlocks(message('text', String(i)))
    expect(s.messageBlockCache.size).toBe(300)
  })

  it('characterizes retained cache entries across deletion and thread changes', async () => {
    const { props, state: s } = setup()
    s.getMessageBlocks(message('old text'))
    Object.assign(props, { messages: [] })
    await vue.nextTick()
    props.activeThreadId = 'B'
    await vue.nextTick()
    expect(s.messageBlockCache.size).toBe(1)
    expect(s.getMessageBlocks(message('new text'))).toEqual([{ kind: 'paragraph', value: 'new text' }])
    cleanups.splice(0).forEach(fn => fn())
    expect(s.messageBlockCache.size).toBe(0)
  })

  it('characterizes initial cached history, subsequent windowing and scroll-preserving pagination', async () => {
    const messages = Array.from({ length: 120 }, (_, i) => message(String(i), String(i)))
    const { props, state: s } = setup({ messages })
    // Known follow-up: initial setup does not apply the 50-message window.
    expect(s.visibleMessages.value).toHaveLength(120)
    Object.assign(props, { messages: [...messages] })
    await vue.nextTick()
    expect(s.visibleMessages.value).toHaveLength(50)
    s.autoFollowOutput.value = false
    const container = { scrollHeight: 1000, scrollTop: 10 }
    s.conversationListRef.value = container
    const loading = s.loadMoreAbove()
    container.scrollHeight = 1600
    await loading
    expect(s.visibleMessages.value).toHaveLength(80)
    expect(container.scrollTop).toBe(610)
    expect(s.visibleMessages.value.map((m: { id: string }) => m.id)).toEqual(messages.slice(40).map(m => m.id))
  })
})
