import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import * as vue from 'vue'
import hljs from 'highlight.js/lib/common'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConversationViewport } from './conversationViewport'
import type { UiMessage } from '../../types/codex'

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
  const markdownSource = readFileSync(resolve('src/components/content/conversationMarkdown.ts'), 'utf8')
    .replace('function parseMessageBlocks(text: string): MessageBlock[] {', 'function parseMessageBlocks(text: string): MessageBlock[] { recordParse();')
  const markdownCode = ts.transpileModule(markdownSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const instrumentedSource = source
  const code = ts.transpileModule(instrumentedSource + `\nreturn { openDiffViewer, closeDiffViewer, selectDiffViewerChange, activeDiffViewerChange, activeDiffViewerSummary, activeDiffViewerChangeKey, isDiffViewerFileListOpen, isFileLinkContextMenuVisible, fileLinkContextBrowseUrl, expandedWorkedIds, expandedCommandIds, failedMarkdownImages, onMarkdownImageError, isMarkdownImageFailed, loadMoreAbove, conversationListRef, renderWindowStart: viewport.renderWindowStart, isLoadingMore, scheduleConversationScroll: viewport.scheduleConversationScroll, editMessage, forkResponse, bindPendingImageHandlers: viewport.bindPendingImageHandlers, getMessageBlocks, renderMarkdownBlocksAsHtml, renderCachedHighlightedCodeAsHtml: markdown.renderCachedHighlightedCodeAsHtml, highlightCacheVersion, visibleMessages, autoFollowOutput: viewport.autoFollowOutput, messageBlockCache: markdown.messageBlockCache, inlineSegmentCache: markdown.inlineSegmentCache, markdownHtmlCache: markdown.markdownHtmlCache, highlightHtmlCache: markdown.highlightHtmlCache,
    conversationRows, toggleExecution, isExecutionExpanded, toggleWebSearchGroup, isWebSearchGroupExpanded, liveReasoningHtml };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const state = scope.run(() => new Function('exports', 'require', 'defineProps', 'defineEmits', 'defineExpose', 'recordParse', code)({}, (path: string) => {
    if (path.endsWith('/conversationMarkdown')) {
      const exports = {}
      new Function('exports', 'require', 'recordParse', markdownCode)(exports, (name: string) => name === 'vue' ? vue : name === 'highlight.js/lib/common' ? { default: hljs } : imports[name], parseCalls)
      return exports
    }
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

it.each([
  { mode: 'selected details', expanded: true, selected: true },
  { mode: 'collapsed group', expanded: false, selected: true },
  { mode: 'headings only', expanded: true, selected: false },
])('only groups visible searches and preserves $mode when the render window grows', async ({ expanded, selected }) => {
  const messages: UiMessage[] = Array.from({ length: 80 }, (_, index) => ({
    id: String(index), role: 'assistant', text: 'Reply', turnId: 'turn',
  }))
  for (const index of [29, 30, 31]) {
    messages[index] = { ...messages[index], role: 'system', messageType: 'webSearch', executionLabel: 'Query' }
  }
  const { props, state } = setup({ messages })
  state.renderWindowStart.value = 30
  const visibleGroup = state.conversationRows.value[0]
  expect(visibleGroup.webSearchGroup.map((item: UiMessage) => item.id)).toEqual(['30', '31'])
  state.toggleWebSearchGroup(visibleGroup)
  if (selected) state.toggleExecution(visibleGroup, messages[31])
  if (!expanded) state.toggleWebSearchGroup(visibleGroup)

  state.autoFollowOutput.value = false
  state.conversationListRef.value = { scrollHeight: 1000, scrollTop: 10 }
  await state.loadMoreAbove()
  const olderGroup = state.conversationRows.value[29]
  expect(olderGroup.webSearchGroup.map((item: UiMessage) => item.id)).toEqual(['29', '30', '31'])
  expect(state.isWebSearchGroupExpanded(olderGroup)).toBe(expanded)
  if (!expanded) state.toggleWebSearchGroup(olderGroup)
  expect(state.isExecutionExpanded(olderGroup, messages[31])).toBe(selected)

  props.activeThreadId = 'B'
  expect(state.isWebSearchGroupExpanded(olderGroup)).toBe(false)
  expect(state.isExecutionExpanded(olderGroup, messages[31])).toBe(false)
})

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
  it('does not move away from the question when an in-flight history page finishes', async () => {
    const page = deferred()
    const loadEarlierMessages = vi.fn().mockReturnValue(page.promise)
    const viewport = createConversationViewport({
      props: {
        activeThreadId: 'A', cwd: '/tmp', messages: [], pendingRequests: [], liveOverlay: null,
        isLoading: false, hasMorePersistedAbove: true, loadEarlierMessages,
      },
    })
    const container = {
      clientTop: 0,
      scrollHeight: 1000,
      scrollTop: 450,
      getBoundingClientRect: () => ({ top: 0 }),
      scrollTo({ top = 0 }: ScrollToOptions) { this.scrollTop = top },
    }
    viewport.conversationListRef.value = container as unknown as HTMLElement
    const loading = viewport.loadMoreAbove()
    const heading = { focus: vi.fn(), getBoundingClientRect: () => ({ top: -360 }) }
    viewport.jumpToQuestion(heading as unknown as HTMLButtonElement)
    expect(heading.focus).toHaveBeenCalledWith({ preventScroll: true })
    const jumpedTo = container.scrollTop
    container.scrollHeight = 1200
    page.resolve(undefined)
    await loading
    expect(container.scrollTop).toBe(jumpedTo)
    expect(viewport.isLoadingMore.value).toBe(false)
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
  it('forks an older native response by turn ID and keeps imported cutoffs portable', () => {
    const { props, state: s, emit } = setup({ messages: [
      { id: 'answer', role: 'assistant', text: 'answer', turnId: 'turn', turnIndex: -2 },
      { id: 'imported', role: 'assistant', text: 'imported answer', turnIndex: -2, importMetadata: { source: 'fixture' } },
    ] })
    s.forkResponse('answer')
    expect(emit).toHaveBeenLastCalledWith('forkThread', { threadId: 'A', target: { turnId: 'turn' }, method: 'native' })
    s.forkResponse('answer', 'portable')
    expect(emit).toHaveBeenLastCalledWith('forkThread', { threadId: 'A', target: { turnId: 'turn' }, method: 'portable' })
    s.forkResponse('imported', 'native')
    expect(emit).toHaveBeenCalledTimes(2)
    s.forkResponse('imported', 'portable')
    expect(emit).toHaveBeenLastCalledWith('forkThread', { threadId: 'A', target: { importedMessageIndex: 1 }, method: 'portable' })
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
    s.editMessage('user', 'portable-fork-and-revert')
    expect(emit).toHaveBeenLastCalledWith('rollback', { threadId: 'A', turnId: 'turn', messageId: 'user', operation: 'portable-fork-and-revert' })
    Object.assign(props, { isRevertDisabled: true })
    s.editMessage('user')
    s.editMessage('user', 'portable-fork-and-revert')
    expect(emit).toHaveBeenCalledTimes(4)
  })
})

it('renders live reasoning Markdown as chunks arrive and escapes raw HTML', () => {
  const liveOverlay = vue.reactive({ activityLabel: 'Thinking', reasoningText: '' })
  const { state, parseCalls } = setup({ liveOverlay })
  const { liveReasoningHtml, markdownHtmlCache } = state

  expect(liveReasoningHtml.value).toBe('')
  expect(parseCalls).not.toHaveBeenCalled()

  liveOverlay.reasoningText += '**Checking'
  expect(liveReasoningHtml.value).toContain('**Checking')
  expect(liveReasoningHtml.value).not.toContain('<strong')

  liveOverlay.reasoningText += '**\n\n- Inspect `a < b'
  expect(liveReasoningHtml.value).toMatch(/<strong[^>]*>Checking<\/strong>/u)
  expect(liveReasoningHtml.value).toMatch(/<ul[^>]*>.*<li[^>]*>.*Inspect/u)
  expect(liveReasoningHtml.value).not.toContain('<code')

  liveOverlay.reasoningText += '`\n- <b>literal HTML</b>\n\n```\n  first\n    second\n```'
  expect(liveReasoningHtml.value).toMatch(/<code[^>]*>a &lt; b<\/code>/u)
  expect(liveReasoningHtml.value).toContain('&lt;b&gt;literal HTML&lt;/b&gt;')
  expect(liveReasoningHtml.value).not.toContain('<b>')
  expect(liveReasoningHtml.value).toMatch(/<pre[^>]*><code[^>]*>  first\n    second<\/code>/u)

  liveOverlay.activityLabel = 'Working'
  expect(liveReasoningHtml.value).toContain('literal HTML')
  expect(parseCalls).toHaveBeenCalledTimes(3)
  expect(markdownHtmlCache.size).toBe(0)

  liveOverlay.reasoningText = ''
  expect(liveReasoningHtml.value).toBe('')
  expect(parseCalls).toHaveBeenCalledTimes(3)
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

  it('renders copyable blocks inside list items with code whitespace and quote markup intact', () => {
    const { state: s } = setup()
    const markdown = [
      '1. Ordered item',
      '   ```ts',
      '     const value = "<tag>";',
      '     ',
      '     return value;  ',
      '   ```',
      '',
      '- > **Quote** [reference](https://example.test/docs)',
      '  > Next line',
      '',
      '- [x] Completed item',
      '  ~~~',
      '    plain code',
      '  ~~~',
    ].join('\n')
    const html = s.renderMarkdownBlocksAsHtml(markdown)
    expect(html.match(/class="message-copy-button message-block-copy-button"/gu)).toHaveLength(3)
    expect(html).toMatch(/<ol [^>]+>.*<pre[^>]+><code[^>]+>  const value = &quot;&lt;tag&gt;&quot;;\n  \n  return value;  <\/code>/su)
    expect(html).toMatch(/<li[^>]+>.*<blockquote[^>]+>.*<strong[^>]+>Quote<\/strong> <a[^>]+>reference<\/a>\nNext line/su)
    expect(html).toMatch(/data-checked="true".*<code[^>]+>  plain code<\/code>/su)
  })

  it('keeps chat image previews while preserving image syntax inside a list code fence', () => {
    const { state: s } = setup()
    const image = '![Alt](https://example.test/image.png)'
    const markdown = ['- Steps', '  ```md', `  ${image}`, '  ```', '', `- Preview ${image}`].join('\n')
    const blocks = s.getMessageBlocks(message(markdown))
    expect(blocks[0].items[0].children).toEqual([{ kind: 'codeBlock', language: 'md', value: image }])
    expect(blocks.slice(1)).toEqual([{ kind: 'image', url: 'https://example.test/image.png', alt: 'Alt', markdown: image }])
  })

  it('shows a preview after dedenting from an unfinished list code fence', () => {
    const { state: s } = setup()
    const image = '![Alt](https://example.test/image.png)'
    const markdown = ['- ```md', `  ${image}`, '', image].join('\n')
    const blocks = s.getMessageBlocks(message(markdown))
    expect(blocks[0].items[0].children).toEqual([{ kind: 'codeBlock', language: 'md', value: image }])
    expect(blocks.slice(1)).toEqual([{ kind: 'image', url: 'https://example.test/image.png', alt: 'Alt', markdown: image }])
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
