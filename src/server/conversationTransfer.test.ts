import { beforeEach, describe, expect, it, vi } from 'vitest'
import { convertTransferHistory, createConversationTransfers, portableItems } from './conversationTransfer'
import { normalizeThreadMessagesV2 } from '../api/normalizers/v2'
const disk = vi.hoisted(() => ({ state: {} as Record<string, any> }))
vi.mock('./codexGlobalState.js', () => ({
  readCodexGlobalState: async () => structuredClone(disk.state),
  updateCodexGlobalState: async (fn: (state: Record<string, any>) => unknown) => fn(disk.state),
}))
const turn = (n: number) => ({ id: `turn-${n}`, status: 'completed', items: [
  { type: 'userMessage', id: `u-${n}`, content: [{ type: 'text', text: `question ${n}` }] },
  { type: 'agentMessage', id: `a-${n}`, text: `answer ${n}` },
] })
function server() {
  return vi.fn(async (method: string, params: any): Promise<any> => {
    if (method === 'thread/read') return { thread: { id: params.threadId, cwd: '/workspace', turns: Array.from({ length: 25 }, (_, i) => turn(i)) } }
    if (method === 'thread/start') return { thread: { id: 'destination' }, model: params.model, modelProvider: params.modelProvider }
    if (method === 'thread/inject_items') return {}
    throw new Error(`Unexpected RPC: ${method}`)
  })
}
beforeEach(() => { disk.state = {} })
describe('portable conversation transfer', () => {
  // CAP-001 + CAP-002: user cutoffs are exclusive; response cutoffs remain inclusive.
  it('snapshots all preceding history and the exact user draft independently of the UI page', async () => {
    const rpc = server(), transfers = createConversationTransfers(rpc)
    const source = { id: 'source', cwd: '/workspace', projectId: 'project', turns: Array.from({ length: 25 }, (_, i) => turn(i)) }
    source.turns[20]!.items[0]!.content = [{ type: 'text', text: '  Revise **this**\n```ts\nx()\n```  ' }]
    const before = structuredClone(source)
    rpc.mockResolvedValueOnce({ thread: source })
    const prepared = await transfers.prepare('source', undefined, { turnId: 'turn-20', messageId: 'u-20' })
    expect(prepared.messageCount).toBe(40)
    // Later source changes cannot alter either part of the prepared snapshot.
    source.turns[20]!.items[0]!.content[0]!.text = 'changed later'
    const result = await transfers.create(prepared.id, 'different-model', 'different-provider')
    expect(result.draftText).toBe(normalizeThreadMessagesV2({ thread: before as any }).find(message => message.id === 'u-20')!.text)
    expect(result.projectId).toBe('project')
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['thread/read', 'thread/start', 'thread/inject_items'])
    const items = rpc.mock.calls[2]![1].items
    expect(items).toHaveLength(40)
    expect(items[0].content[0].text).toBe('question 0')
    expect(items.at(-1).content[0].text).toBe('answer 19')
    expect(JSON.stringify(items)).not.toContain('Revise')
    const reopened = createConversationTransfers(rpc)
    expect(await reopened.status(prepared.id)).toMatchObject({ stage: 'ready', draftText: result.draftText })
    expect((await reopened.decorate({ thread: { id: 'destination', turns: [] } })).importedTranscript).toHaveLength(40)
    await expect(reopened.create(prepared.id, 'different-model', 'different-provider')).rejects.toThrow('consumed')
    expect(rpc.mock.calls).toHaveLength(3)
    // Only the deliberate test mutation changed the source object.
    source.turns[20]!.items[0]!.content[0]!.text = before.turns[20]!.items[0]!.content![0]!.text
    expect(source).toEqual(before)
  })
  it('creates a draft-only destination at the first user turn without injecting or generating', async () => {
    const rpc = server(), transfers = createConversationTransfers(rpc)
    const prepared = await transfers.prepare('source', undefined, { turnId: 'turn-0', messageId: 'u-0' })
    expect(prepared.messageCount).toBe(0)
    await expect(transfers.create(prepared.id, 'model', 'provider')).resolves.toMatchObject({ draftText: 'question 0' })
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['thread/read', 'thread/start'])
  })
  it('preserves an existing imported prefix exactly once before a native user cutoff', async () => {
    const rpc = server(), transfers = createConversationTransfers(rpc)
    const first = await transfers.prepare('source', { turnId: 'turn-0' })
    await transfers.create(first.id, 'model', 'provider')
    const prepared = await transfers.prepare('destination', undefined, { turnId: 'turn-1', messageId: 'u-1' })
    expect(prepared.messageCount).toBe(4)
    expect((await transfers.status(prepared.id)).draftText).toBe('question 1')
  })
  it.each([
    { turnId: 'stale', messageId: 'u-1' },
    { turnId: 'turn-1', messageId: 'u-2' },
    { turnId: 'turn-1', messageId: 'a-1' },
  ])('rejects a stale or non-user revert target before creation: %j', async target => {
    const rpc = server()
    await expect(createConversationTransfers(rpc).prepare('source', undefined, target)).rejects.toThrow('no longer available')
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['thread/read'])
    expect(disk.state).toEqual({})
  })
  it('cancels a revert snapshot without creating a destination or retaining a draft', async () => {
    const rpc = server(), transfers = createConversationTransfers(rpc)
    const prepared = await transfers.prepare('source', undefined, { turnId: 'turn-1', messageId: 'u-1' })
    await transfers.cancel(prepared.id)
    await expect(transfers.status(prepared.id)).rejects.toThrow('not found')
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['thread/read'])
  })
  it.each(['thread/start', 'thread/inject_items'])('fences ambiguous Portable Fork and Revert %s outcomes across reopening', async failedMethod => {
    const rpc = server(), transfers = createConversationTransfers(rpc)
    const prepared = await transfers.prepare('source', undefined, { turnId: 'turn-1', messageId: 'u-1' })
    rpc.mockImplementation(async (method, params) => {
      if (method === failedMethod) throw new Error('timeout: acknowledgement lost')
      if (method === 'thread/start') return { thread: { id: 'destination' }, model: params.model, modelProvider: params.modelProvider }
      throw new Error('Unexpected operation')
    })
    await expect(transfers.create(prepared.id, 'model', 'provider')).rejects.toThrow('Incomplete destination')
    await expect(createConversationTransfers(rpc).create(prepared.id, 'model', 'provider')).rejects.toThrow('consumed')
    expect(rpc.mock.calls.filter(call => call[0] === failedMethod)).toHaveLength(1)
    expect(rpc.mock.calls.every(call => ['thread/read', 'thread/start', 'thread/inject_items'].includes(call[0]))).toBe(true)
  })

  it('returns the source provider from the existing history read for destination preselection', async () => {
    const rpc = server()
    rpc.mockImplementationOnce(async () => ({ thread: { cwd: '/workspace', modelProvider: 'source-provider', turns: [turn(0)] } }))
    const prepared = await createConversationTransfers(rpc).prepare('unselected-source')
    expect(prepared.sourceModelProvider).toBe('source-provider')
    expect(rpc.mock.calls).toEqual([['thread/read', { threadId: 'unselected-source', includeTurns: true }]])
  })
  it('allowlists only ordinary user and assistant text, silently excluding all other content', () => {
    const history = [{ items: [
      ...turn(0).items,
      { type: 'reasoning', encrypted_content: 'SECRET', content: ['SECRET'] },
      { type: 'additional_tools', tools: ['SECRET'] },
      { type: 'message', role: 'developer', content: 'SECRET' },
      { type: 'commandExecution', command: 'pwd', aggregatedOutput: 'SECRET' },
      { type: 'mcpToolCall', server: 's', tool: 't', result: { content: [{ type: 'text', text: 'SECRET' }] } },
      { type: 'userMessage', content: [{ type: 'image', url: 'SECRET' }, { type: 'localImage', path: 'SECRET' }, { type: 'skill', name: 'SECRET', path: 'SECRET' }] },
      { type: 'fileChange', changes: [{ path: 'SECRET', diff: 'SECRET' }] },
      { type: 'function_call_output', call_id: 'SECRET', output: 'SECRET' },
      { type: 'custom_tool_call_output', output: 'SECRET' },
      { type: 'importAnnotation', text: 'SECRET' },
      { type: 'plan', text: 'SECRET' },
      { type: 'unknown', text: 'SECRET' },
      { type: 'userMessage', content: [{ type: 'text', text: '' }, { type: 'text', text: '  \n  ' }] },
      { type: 'userMessage', content: null },
      { type: 'agentMessage', text: '' },
      { type: 'agentMessage', text: '  \n  ' },
    ] }]
    const result = convertTransferHistory(history, 'source')
    const items = portableItems(result.messages)
    expect(items.map(i => i.role)).toEqual(['user', 'assistant'])
    expect(items[0]?.content).toEqual([{ type: 'input_text', text: 'question 0' }])
    expect(items[1]?.content).toEqual([{ type: 'output_text', text: 'answer 0' }])
    expect(JSON.stringify(items)).not.toContain('SECRET')
    expect(items.every(i => i.type === 'message' && Object.keys(i).length === 3)).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.messages.map(message => message.text)).toEqual(['question 0', 'answer 0'])
  })
  it('keeps adjacent messages, Markdown, code blocks and whitespace unchanged around excluded content', () => {
    const texts = ['  Hello\n\n**Explain** this code.  ', '```ts\nconst value = 1\n```\n', 'Imported: user-authored text [Attachment omitted] stays verbatim.', 'A separate consecutive user message.']
    const { messages, warnings } = convertTransferHistory([{ items: [
      { type: 'userMessage', content: [{ type: 'image', url: 'SECRET' }, { type: 'text', text: texts[0] }, { type: 'attachment', path: 'SECRET' }] },
      { type: 'commandExecution', aggregatedOutput: 'SECRET' },
      { type: 'agentMessage', text: texts[1] },
      { type: 'userMessage', content: [{ type: 'text', text: texts[2] }] },
      { type: 'userMessage', content: [{ type: 'text', text: texts[3] }] },
    ] }], 'source')
    expect(messages.map(message => message.text)).toEqual(texts)
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'user'])
    expect(portableItems(messages).map(item => item.content[0]?.text)).toEqual(texts)
    expect(warnings).toEqual([])
  })
  it('injects and persists exactly the same text-only cutoff through reopening and a later transfer', async () => {
    const rpc = server()
    const sourceTurns = [turn(0), { ...turn(1), items: [
      { type: 'reasoning', content: ['SECRET'] },
      { type: 'userMessage', content: [{ type: 'text', text: 'next **question**' }, { type: 'image', url: 'SECRET' }] },
      { type: 'mcpToolCall', result: { content: [{ type: 'text', text: 'SECRET' }] } },
      { type: 'agentMessage', text: '```js\nanswer()\n```' },
    ] }, turn(2)]
    rpc.mockImplementationOnce(async () => ({ thread: { cwd: '/workspace', turns: sourceTurns } }))
    const transfers = createConversationTransfers(rpc)
    const prepared = await transfers.prepare('source', { turnId: 'turn-1' })
    expect(prepared.warnings).toEqual([])
    expect(prepared.messageCount).toBe(4)
    await transfers.create(prepared.id, 'model', 'provider')
    const items = rpc.mock.calls.find(call => call[0] === 'thread/inject_items')![1].items
    expect(items.map((item: any) => item.content[0].text)).toEqual(['question 0', 'answer 0', 'next **question**', '```js\nanswer()\n```'])
    const reopened = createConversationTransfers(rpc)
    const payload = await reopened.decorate({ thread: { id: 'destination', turns: [] } })
    expect(normalizeThreadMessagesV2(payload).map(message => message.text)).toEqual(items.map((item: any) => item.content[0].text))
    expect(JSON.stringify(payload)).not.toContain('SECRET')
    expect((await reopened.status(prepared.id)).warnings).toEqual([])
    const readOnlyCalls = rpc.mock.calls.length
    await reopened.assertReady('destination')
    expect(rpc.mock.calls).toHaveLength(readOnlyCalls)
    rpc.mockImplementationOnce(async () => ({ thread: { cwd: '/workspace', turns: [] } }))
    const next = await reopened.prepare('destination', { importedMessageIndex: 3 })
    expect(next.messageCount).toBe(4)
    expect(next.warnings).toEqual([])
  })
  it('prepares before selection and cancellation creates nothing', async () => {
    const rpc = server(); const transfers = createConversationTransfers(rpc)
    const prepared = await transfers.prepare('source')
    expect(prepared.messageCount).toBe(50)
    expect(rpc.mock.calls.map(c => c[0])).toEqual(['thread/read'])
    await transfers.cancel(prepared.id)
    await expect(transfers.create(prepared.id, 'model', 'provider')).rejects.toThrow('consumed')
    expect(rpc.mock.calls).toHaveLength(1)
  })
  it.each([undefined, 12])('imports the complete stable prefix (%s), persists presentation and never reinjects on resume', async cutoff => {
    const rpc = server(); const transfers = createConversationTransfers(rpc)
    const prepared = await transfers.prepare('source', cutoff === undefined ? undefined : { turnId: 'turn-' + cutoff })
    rpc.mockImplementationOnce(async () => ({ thread: { id: 'destination' }, model: 'model', modelProvider: 'provider' }))
    await transfers.create(prepared.id, 'model', 'provider')
    expect(rpc.mock.calls.map(c => c[0])).toEqual(['thread/read', 'thread/start', 'thread/inject_items'])
    const items = rpc.mock.calls[2]![1].items
    expect(items.length).toBe((cutoff === undefined ? 25 : 13) * 2)
    expect(items[0].content[0].text).toBe('question 0')
    expect(items.at(-1).content[0].text).toBe(`answer ${cutoff ?? 24}`)
    // A replacement bridge reads the durable record, with no RPC or injection.
    const reopened = createConversationTransfers(rpc)
    const payload = await reopened.decorate({ thread: { id: 'destination', turns: [] } })
    expect(normalizeThreadMessagesV2(payload)).toHaveLength(items.length)
    const messages = normalizeThreadMessagesV2(payload)
    expect(messages.map(message => message.text)).toEqual(items.map((item: any) => item.content[0].text))
    expect(messages[1]?.importMetadata?.source).toBe(payload.importedTranscript[1].source)
    expect(payload.importedTranscript[1].source).toContain('source')
    expect(payload.importStage).toBe('ready')
    await reopened.assertReady('destination')
    expect(rpc.mock.calls).toHaveLength(3)
    await expect(reopened.create(prepared.id, 'model', 'provider')).rejects.toThrow('consumed')
    expect(rpc.mock.calls).toHaveLength(3)
  })
  it('does not decorate or impose import guards on an independently native-forked thread', async () => {
    const rpc = server(); const transfers = createConversationTransfers(rpc)
    const prepared = await transfers.prepare('source', { turnId: 'turn-0' })
    await transfers.create(prepared.id, 'model', 'provider')
    const payload = { thread: { id: 'native-fork', turns: [turn(0)] } }
    const reopened = createConversationTransfers(rpc)
    const decorated = await reopened.decorate(payload)
    expect(decorated).toBe(payload)
    await reopened.assertReady('native-fork')
    expect(normalizeThreadMessagesV2(decorated)[1]?.text).toBe('answer 0')
    expect(rpc.mock.calls).toHaveLength(3)
  })
  it('imports an existing imported prefix exactly once', async () => {
    const rpc = server(); const transfers = createConversationTransfers(rpc)
    const first = await transfers.prepare('source', { turnId: 'turn-0' })
    await transfers.create(first.id, 'model', 'provider')
    const stored = Object.values(disk.state['conversation-transfers-v1'] as Record<string, any>)[0]!
    stored.warnings = ['Legacy omission notice']
    stored.messages.push({ role: 'tool', text: 'SECRET', source: 'source' }, { role: 'assistant', text: '', source: 'source' })
    const second = await transfers.prepare('destination', { turnId: 'turn-0' })
    expect(second.warnings).toEqual([])
    expect(second.messageCount).toBe(4)
    const response = await transfers.prepare('destination', { importedMessageIndex: 1 })
    expect(response.messageCount).toBe(2)
  })
  it.each(['unsupported method thread/inject_items', 'timeout: acknowledgement lost'])('fences duplicate creation and uncertain injection: %s', async message => {
    const rpc = server(); const transfers = createConversationTransfers(rpc)
    const prepared = await transfers.prepare('source')
    let reject!: (cause: Error) => void
    rpc.mockImplementation(async (method, params) => {
      if (method === 'thread/start') return { thread: { id: 'destination' }, model: params.model, modelProvider: params.modelProvider }
      return new Promise((_resolve, rejectPromise) => { reject = rejectPromise })
    })
    const pending = transfers.create(prepared.id, 'model', 'provider')
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith('thread/inject_items', expect.anything()))
    await expect(transfers.create(prepared.id, 'model', 'provider')).rejects.toThrow('pending')
    reject(new Error(message))
    await expect(pending).rejects.toThrow('Incomplete destination destination; stage injecting')
    const reopened = createConversationTransfers(rpc)
    await expect(reopened.assertReady('destination')).rejects.toThrow('Incomplete')
    await expect(reopened.create(prepared.id, 'model', 'provider')).rejects.toThrow('consumed')
    expect(rpc.mock.calls.filter(c => c[0] === 'thread/inject_items')).toHaveLength(1)
  })
  it('never injects into or decorates the source if start returns its identity', async () => {
    const rpc = server(), transfers = createConversationTransfers(rpc)
    const prepared = await transfers.prepare('source', undefined, { turnId: 'turn-1', messageId: 'u-1' })
    rpc.mockResolvedValueOnce({ thread: { id: 'source' }, model: 'model', modelProvider: 'provider' })
    await expect(transfers.create(prepared.id, 'model', 'provider')).rejects.toThrow('separate destination')
    await transfers.assertReady('source')
    const payload = { thread: { id: 'source', turns: [] } }
    expect(await transfers.decorate(payload)).toBe(payload)
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['thread/read', 'thread/start'])
  })
  it('rejects a default provider/model before injection', async () => {
    const rpc = server(); const transfers = createConversationTransfers(rpc)
    const prepared = await transfers.prepare('source')
    rpc.mockResolvedValueOnce({ thread: { id: 'wrong' }, model: 'other', modelProvider: 'default' })
    await expect(transfers.create(prepared.id, 'model', 'provider')).rejects.toThrow('did not confirm')
    await expect(transfers.assertReady('wrong')).rejects.toThrow('Incomplete')
    expect(rpc.mock.calls).toHaveLength(2)
  })
  it('rejects in-progress history and oversized history without creating a destination', async () => {
    const rpc = server(); const transfers = createConversationTransfers(rpc)
    rpc.mockResolvedValueOnce({ thread: { turns: [{ ...turn(0), status: 'inProgress' }] } })
    await expect(transfers.prepare('source')).rejects.toThrow('Finish or stop')
    rpc.mockResolvedValueOnce({ thread: { turns: [{ items: [{ type: 'agentMessage', text: 'x'.repeat(8 * 1024 * 1024) }] }] } })
    await expect(transfers.prepare('source')).rejects.toThrow('8 MiB')
    rpc.mockResolvedValueOnce({ thread: { cwd: '/workspace', status: { type: 'active' }, turns: [turn(0)] } })
    await expect(transfers.prepare('source')).rejects.toThrow('Finish or stop')
    await expect(transfers.prepare('source', { turnId: 'stale-turn' })).rejects.toThrow('Source history changed')
    expect(rpc.mock.calls.every(c => c[0] === 'thread/read')).toBe(true)
  })
})

it('converts a 2000-turn history in one bounded linear pass', () => {
  const turns = Array.from({ length: 2000 }, (_, index) => turn(index))
  const start = performance.now()
  const result = convertTransferHistory(turns, 'source')
  const bytes = Buffer.byteLength(JSON.stringify(portableItems(result.messages)))
  expect(result.messages).toHaveLength(4000)
  console.log(`Transfer audit: 2000 turns, ${bytes} bytes, ${(performance.now() - start).toFixed(2)}ms; zero RPCs during conversion`)
})
it('protects every imported prefix stage from native deletion without modifying receipts or native resources',async()=>{
 for(const stage of ['ready','injecting','starting']){
  disk.state={'conversation-transfers-v1':{fixture:{destinationId:'imported',sourceId:'source',cwd:'/r',messages:[{role:'user',text:'keep',source:'fixture'}],stage}}}
  const rpc=server(),transfers=createConversationTransfers(rpc),before=structuredClone(disk.state)
  await expect(transfers.assertNativeDeletion('imported')).rejects.toMatchObject({code:-32600})
  await expect(transfers.assertNativeDeletion('ordinary')).resolves.toBeUndefined()
  expect(disk.state).toEqual(before);expect(rpc).not.toHaveBeenCalled()
 }
})
