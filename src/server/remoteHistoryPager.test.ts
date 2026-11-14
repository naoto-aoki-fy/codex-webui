import { expect, it, vi } from 'vitest'
import { RemoteHistoryPager, HISTORY_MAX_INDEX_PAGES } from './remoteHistoryPager'

function fixture(count = 1000) {
  const turns = Array.from({ length: count }, (_, i) => ({ id: `turn-${i}`, status: 'completed', items: [{ type: 'agentMessage', text: 'x'.repeat(4096) }] }))
  let generation = 1
  let bytes = 0
  const rpc = vi.fn(async (method: string, params: unknown) => {
    const p = params as Record<string, any>
    let result: unknown
    if (method === 'thread/read') result = { thread: { id: 'thread', turns: p.includeTurns ? turns : [] } }
    else {
      const data = p.sortDirection === 'desc' ? [...turns].reverse() : turns
      const start = p.cursor ? Number(String(p.cursor).split(':')[1]) : 0
      const end = Math.min(start + p.limit, data.length)
      result = { data: data.slice(start, end).map(turn => p.itemsView === 'notLoaded' ? { ...turn, items: [], itemsView: 'notLoaded' } : turn), nextCursor: end < data.length ? `opaque:${end}` : null }
    }
    bytes += Buffer.byteLength(JSON.stringify(result))
    return result
  })
  const legacy = vi.fn(() => rpc('thread/read', { threadId: 'thread', includeTurns: true }))
  const client = { rpc, getConnectionGeneration: () => generation, readThreadForTurnPage: legacy }
  return { turns, rpc, legacy, client, get bytes() { return bytes }, reconnect: () => generation++ }
}

it('uses real upstream turn pagination and keeps exact indices without full item hydration', async () => {
  const f = fixture()
  const pager = new RemoteHistoryPager(f.client)
  const latest = await pager.read('thread')
  expect(latest).toMatchObject({ startTurnIndex: 990, hasMoreOlder: true })
  expect((latest.result as any).thread.turns.map((turn: any) => turn.id)).toEqual(f.turns.slice(990).map(turn => turn.id))
  const older = await pager.read('thread', 'turn-990', 10)
  expect(older).toMatchObject({ startTurnIndex: 980, hasMoreOlder: true })
  expect(f.rpc.mock.calls.map(([method, p]) => [method, (p as any).itemsView])).toEqual([
    ['thread/read', undefined], ['thread/turns/list', 'notLoaded'], ['thread/turns/list', 'full'], ['thread/turns/list', 'full'],
  ])
  expect(f.legacy).not.toHaveBeenCalled()
  expect(f.bytes).toBeLessThan(Buffer.byteLength(JSON.stringify({ thread: { turns: f.turns } })) / 10)
})

it('reports missing native pagination without reading full history, including after reconnect', async () => {
  const f = fixture(20)
  const original = f.rpc.getMockImplementation()!
  f.rpc.mockImplementation(async (method, params) => {
    if (method === 'thread/turns/list') throw Object.assign(new Error('Method not found'), { code: -32601 })
    return original(method, params)
  })
  const pager = new RemoteHistoryPager(f.client)
  await expect(pager.read('thread')).rejects.toThrow('Upgrade Codex')
  await expect(pager.read('thread', 'turn-10')).rejects.toThrow('Upgrade Codex')
  expect(f.legacy).not.toHaveBeenCalled()
  f.reconnect()
  await expect(pager.read('thread')).rejects.toThrow('Upgrade Codex')
  expect(f.legacy).not.toHaveBeenCalled()
})

it.each(['Permission denied', 'App-server disconnected', 'Timeout'])('does not classify %s as unsupported or silently fetch full history', async message => {
  const f = fixture()
  f.rpc.mockRejectedValue(new Error(message))
  await expect(new RemoteHistoryPager(f.client).read('thread')).rejects.toThrow(message)
  expect(f.legacy).not.toHaveBeenCalled()
})

it('invalidates on changed history and rejects oversized/malformed pages and repeated cursors', async () => {
  const f = fixture(20)
  const pager = new RemoteHistoryPager(f.client)
  await pager.read('thread')
  pager.invalidate('thread')
  await pager.read('thread')
  expect(f.rpc.mock.calls.filter(([m]) => m === 'thread/read')).toHaveLength(2)
  f.rpc.mockResolvedValue({ data: [], nextCursor: 99 })
  pager.invalidate()
  await expect(pager.read('thread')).rejects.toThrow('Incompatible metadata')
  f.rpc.mockImplementation(async method => method === 'thread/read' ? { thread: { id: 'thread' } } : { data: [], nextCursor: 'same' })
  await expect(pager.read('thread')).rejects.toThrow('repeated cursor')
  expect(HISTORY_MAX_INDEX_PAGES).toBe(100)
})

it('ignores obsolete reads after disconnect and seeks arbitrary boundaries with metadata only', async () => {
  const f = fixture(50)
  const pager = new RemoteHistoryPager(f.client)
  await pager.read('thread')
  const older = await pager.read('thread', 'turn-20', 5)
  expect(older).toMatchObject({ startTurnIndex: 15 })
  expect(f.rpc.mock.calls.some(([, p]) => (p as any).itemsView === 'notLoaded' && (p as any).sortDirection === 'desc')).toBe(true)
  f.reconnect()
  await pager.read('thread')
  expect(f.rpc.mock.calls.filter(([m]) => m === 'thread/read')).toHaveLength(2)
})

it('caps simultaneous index scans and discards invalidated work before requesting more pages', async () => {
  let release!: () => void
  const barrier = new Promise<void>(resolve => { release = resolve })
  const rpc = vi.fn(async method => {
    if (method === 'thread/read') { await barrier; return { thread: { id: 'thread', turns: [] } } }
    return { data: [], nextCursor: null }
  })
  const pager = new RemoteHistoryPager({ rpc, getConnectionGeneration: () => 1, readThreadForTurnPage: vi.fn() })
  const pending = Array.from({ length: 16 }, (_, i) => pager.read(`thread-${i}`).catch(error => error))
  await expect(pager.read('overflow')).rejects.toThrow('16 concurrent indexes')
  expect(pager.getCacheStats().pending).toBe(16)
  pager.invalidate()
  release()
  const results = await Promise.all(pending)
  expect(results.every(value => value instanceof Error && value.message.includes('History changed'))).toBe(true)
  expect(rpc.mock.calls.every(([method]) => method === 'thread/read')).toBe(true)
})

it('coalesces concurrent identical native pages while preserving different boundaries', async () => {
  const f = fixture(50)
  const pager = new RemoteHistoryPager(f.client)
  const [first, second] = await Promise.all([pager.read('thread'), pager.read('thread')])
  expect(first).toBe(second)
  expect(f.rpc.mock.calls.filter(([, p]) => (p as any).itemsView === 'full')).toHaveLength(1)
  const [older, duplicate] = await Promise.all([pager.read('thread', 'turn-40'), pager.read('thread', 'turn-40')])
  expect(older).toBe(duplicate)
  expect(f.rpc.mock.calls.filter(([, p]) => (p as any).itemsView === 'full')).toHaveLength(2)
})
