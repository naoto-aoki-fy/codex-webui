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
  it('allowlists ordinary text and readable observations, without copying opaque source state', () => {
    const history = [{ items: [
      ...turn(0).items,
      { type: 'reasoning', encrypted_content: 'SECRET', content: ['SECRET'] },
      { type: 'additional_tools', tools: ['SECRET'] },
      { type: 'message', role: 'developer', content: 'SECRET' },
      { type: 'commandExecution', command: 'pwd', aggregatedOutput: '/workspace' },
      { type: 'mcpToolCall', server: 's', tool: 't', result: { content: [{ type: 'text', text: 'observation' }] } },
      { type: 'userMessage', content: [{ type: 'image', url: 'SECRET' }] },
    ] }]
    const result = convertTransferHistory(history, 'source')
    const items = portableItems(result.messages)
    expect(items.map(i => i.role)).toEqual(['user', 'assistant', 'user', 'user', 'user'])
    expect(items[0]?.content).toEqual([{ type: 'input_text', text: 'question 0' }])
    expect(items[1]?.content).toEqual([{ type: 'output_text', text: 'answer 0' }])
    expect(JSON.stringify(items)).not.toContain('SECRET')
    expect(items.every(i => i.type === 'message' && Object.keys(i).length === 3)).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
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
    const prepared = await transfers.prepare('source', cutoff)
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
    const prepared = await transfers.prepare('source', 0)
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
    const first = await transfers.prepare('source', 0)
    await transfers.create(first.id, 'model', 'provider')
    const second = await transfers.prepare('destination', 0)
    expect(second.messageCount).toBe(4)
    const response = await transfers.prepare('destination', -2)
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
    await expect(transfers.prepare('source', 0, 'stale-turn')).rejects.toThrow('Source history changed')
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
