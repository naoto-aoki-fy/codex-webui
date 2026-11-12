import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { AppServerClient, createCodexBridgeMiddleware } from './codexAppServerBridge'

const scope = globalThis as typeof globalThis & { __codexRemoteSharedBridge__?: any }
const previous = scope.__codexRemoteSharedBridge__
let middleware: ReturnType<typeof createCodexBridgeMiddleware>
afterEach(() => { middleware?.dispose(); scope.__codexRemoteSharedBridge__ = previous; vi.restoreAllMocks() })
function setup() {
  const client = new AppServerClient()
  let rows = [{ id: 'a', name: 'original', preview: '' }]
  let text = 'message'
  const rpc = vi.spyOn(client, 'rpc').mockImplementation(async method => {
    if (method === 'thread/list') return { data: rows.map(row => ({ ...row })), nextCursor: null }
    if (method === 'thread/read') return { thread: { turns: [{ items: [{ type: 'userMessage', content: [{ type: 'text', text }] }] }] } }
    return {}
  })
  scope.__codexRemoteSharedBridge__ = { version: 'external-websocket-v1', appServer: client, methodCatalog: {} }
  middleware = createCodexBridgeMiddleware()
  const emit = (method: string) => (client as any).emitNotification({ method, params: { threadId: 'a' } })
  async function request(path: string, payload: unknown, owner = middleware) {
    const req = Object.assign(Readable.from([JSON.stringify(payload)]), { method: 'POST', url: '/codex-api/' + path, headers: {} })
    const end = vi.fn()
    const res = Object.assign(new EventEmitter(), { setHeader: vi.fn(), write: vi.fn(), end })
    await owner(req as unknown as IncomingMessage, res as unknown as ServerResponse, vi.fn())
    return JSON.parse(end.mock.calls[0]![0])
  }
  return { rpc, emit, request, search: (query: string) => request('thread-search', { query }), rows: (value: typeof rows) => { rows = value }, text: (value: string) => { text = value } }
}
it('constructs lazily, shares concurrent searches and reuses the exact response envelope', async () => {
  const s = setup()
  expect(s.rpc).not.toHaveBeenCalled()
  expect(await Promise.all([s.search('original'), s.search('original')])).toEqual(Array(2).fill({ data: { threadIds: ['a'], indexedThreadCount: 1 } }))
  await s.search('message')
  expect(s.rpc.mock.calls.map(call => call[0])).toEqual(['thread/list', 'thread/read'])
})
for (const method of ['thread/start', 'thread/name/set', 'thread/archive', 'thread/unarchive', 'thread/fork', 'thread/revert', 'turn/start', 'turn/steer']) {
  it(`refreshes after successful ${method}`, async () => {
    const s = setup(); await s.search('original')
    s.rows([{ id: 'b', name: 'replacement', preview: '' }])
    await s.request('rpc', { method, params: { threadId: 'a' } })
    expect((await s.search('replacement')).data.threadIds).toEqual(['b'])
    expect((await s.search('original')).data.threadIds).toEqual([])
  })
}
for (const method of ['thread/started', 'thread/name/updated', 'thread/archived', 'thread/unarchived', 'thread/updated', 'turn/started', 'turn/completed', 'item/completed', 'item/agentMessage/delta', 'app-server/disconnected']) {
  it(`refreshes on external ${method} without an SSE subscriber`, async () => {
    const s = setup(); await s.search('original')
    s.text('fresh content'); s.rows([{ id: 'a', name: 'fresh title', preview: '' }])
    s.emit(method); s.emit(method)
    expect((await s.search('fresh')).data.threadIds).toEqual(['a'])
    expect(s.rpc.mock.calls.filter(call => call[0] === 'thread/list')).toHaveLength(2)
  })
}
it('expires unobserved mutations on access and ignores unrelated notifications', async () => {
  let now = 1000; vi.spyOn(Date, 'now').mockImplementation(() => now)
  const s = setup(); await s.search('original')
  s.rows([{ id: 'b', name: 'fresh', preview: '' }]); s.emit('account/updated')
  await s.search('original'); expect(s.rpc).toHaveBeenCalledTimes(2)
  now += 5 * 60 * 1000
  expect((await s.search('fresh')).data.threadIds).toEqual(['b'])
})
it('does not let an old build overwrite or clear a newer pending build', async () => {
  const s = setup()
  let finish!: (value: unknown) => void
  s.rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const old = s.search('original')
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  s.emit('thread/started'); s.rows([{ id: 'b', name: 'fresh', preview: '' }])
  await s.search('fresh')
  finish({ data: [{ id: 'a', name: 'original' }], nextCursor: null }); await old
  expect((await s.search('fresh')).data.threadIds).toEqual(['b'])
  expect(s.rpc.mock.calls.filter(call => call[0] === 'thread/list')).toHaveLength(2)
})
it('retries list failures and preserves history-read fallback', async () => {
  const s = setup(); s.rpc.mockRejectedValueOnce(new Error('list failed'))
  expect(await s.search('original')).toEqual({ error: 'list failed' })
  s.rpc.mockImplementation(async method => { if (method === 'thread/list') return { data: [{ id: 'a', name: 'original' }] }; throw new Error('history failed') })
  expect((await s.search('original')).data.threadIds).toEqual(['a'])
})
it('preserves pagination order, phrase matching, limits and four concurrent history reads', async () => {
  const s = setup()
  let active = 0, maximum = 0
  s.rpc.mockImplementation(async (method, params) => {
    if (method === 'thread/list') {
      const second = Boolean((params as any).cursor)
      expect(params).toMatchObject({ archived: false, limit: 100, sortKey: 'updated_at', modelProviders: [] })
      return { data: Array.from({ length: second ? 2 : 4 }, (_, i) => ({ id: String(i + (second ? 4 : 0)), name: 'exact phrase' })), nextCursor: second ? null : 'page2' }
    }
    active++; maximum = Math.max(maximum, active)
    await new Promise(resolve => setImmediate(resolve))
    active--; return { thread: { turns: [] } }
  })
  expect(await s.request('thread-search', { query: 'exact phrase', limit: 3 })).toEqual({ data: { threadIds: ['0', '1', '2'], indexedThreadCount: 6 } })
  expect(maximum).toBe(4)
  expect((await s.search('phrase exact')).data.threadIds).toEqual([])
  expect(s.rpc).toHaveBeenCalledTimes(8)
})
it('coalesces invalidations while a new build is pending and old cleanup runs', async () => {
  const s = setup()
  const finishes: Array<(value: unknown) => void> = []
  s.rpc.mockImplementation(method => method === 'thread/list'
    ? new Promise(resolve => finishes.push(resolve)) : Promise.resolve({}))
  const old = s.search('original')
  await vi.waitFor(() => expect(finishes).toHaveLength(1))
  s.emit('thread/started'); s.emit('turn/completed')
  const fresh = s.search('fresh')
  await vi.waitFor(() => expect(finishes).toHaveLength(2))
  finishes[0]!({ data: [], nextCursor: null }); await old
  const shared = s.search('fresh')
  await new Promise(resolve => setImmediate(resolve))
  expect(finishes).toHaveLength(2)
  finishes[1]!({ data: [{ id: 'b', name: 'fresh' }], nextCursor: null })
  expect(await fresh).toEqual(await shared)
  expect((await s.search('fresh')).data.threadIds).toEqual(['b'])
})
it('refreshes message-only changes and leaves the cache intact after a failed mutation', async () => {
  const s = setup(); await s.search('message')
  s.text('unique new content'); s.emit('item/completed')
  expect((await s.search('unique new content')).data.threadIds).toEqual(['a'])
  expect((await s.search('message')).data.threadIds).toEqual([])
  s.rpc.mockRejectedValueOnce(new Error('rename failed'))
  expect(await s.request('rpc', { method: 'thread/name/set', params: { threadId: 'a', name: 'failed' } })).toEqual({ error: 'rename failed' })
  await s.search('original')
  expect(s.rpc.mock.calls.filter(call => call[0] === 'thread/list')).toHaveLength(2)
})

function deferred<T = unknown>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

for (const stage of ['initial list', 'between pages', 'history batch', 'between batches', 'final history batch']) {
  it(`stops disposed search work during ${stage} without affecting another owner`, async () => {
    const s = setup()
    const owner = middleware
    const other = createCodexBridgeMiddleware()
    const pending = deferred()
    const started = deferred<void>()
    let lists = 0, reads = 0
    s.rpc.mockImplementation((method) => {
      if (method === 'thread/list') {
        lists++
        if (lists > 1) return Promise.resolve({ data: [] })
        if (stage.includes('list') || stage === 'between pages') {
          started.resolve(); return pending.promise
        }
        return Promise.resolve({ data: Array.from({ length: stage === 'final history batch' ? 4 : 8 }, (_, i) => ({ id: String(i), name: 'original' })) })
      }
      reads++
      if (reads === 4) started.resolve()
      return pending.promise
    })
    try {
      const old = s.search('original')
      await started.promise
      const listStage = stage === 'initial list' || stage === 'between pages'
      // Resolve before disposal to exercise the boundary before the next continuation.
      const result = listStage
        ? { data: [{ id: 'a', name: 'original' }], nextCursor: 'next' }
        : { thread: { turns: [] } }
      if (stage.startsWith('between')) pending.resolve(result)
      owner.dispose(); owner.dispose()
      if (!stage.startsWith('between')) pending.resolve(result)
      expect(await old).toEqual({ error: 'Search middleware disposed' })
      expect(lists).toBe(1)
      expect(reads).toBe(listStage ? 0 : 4)
      const count = s.rpc.mock.calls.length
      expect(await s.search('original')).toEqual({ error: 'Search middleware disposed' })
      expect(s.rpc).toHaveBeenCalledTimes(count)
      expect((scope.__codexRemoteSharedBridge__ as any).retired).not.toBe(true)
      s.rpc.mockImplementation(async method => method === 'thread/list'
        ? { data: [{ id: 'b', name: 'fresh' }] } : {})
      expect(await s.request('thread-search', { query: 'fresh' }, other)).toEqual({ data: { threadIds: ['b'], indexedThreadCount: 1 } })
      s.emit('thread/started')
      expect((await s.request('thread-search', { query: 'fresh' }, other)).data.threadIds).toEqual(['b'])
    } finally { other.dispose() }
  })
}

it('unsubscribes search notifications and cannot resubscribe after disposal', async () => {
  const s = setup()
  const client = scope.__codexRemoteSharedBridge__.appServer as AppServerClient
  const off = vi.fn()
  const subscribe = vi.spyOn(client, 'onNotification').mockReturnValue(off)
  await s.search('original')
  middleware.dispose(); middleware.dispose()
  expect(off).toHaveBeenCalledOnce()
  expect(await s.search('original')).toEqual({ error: 'Search middleware disposed' })
  expect(subscribe).toHaveBeenCalledOnce()
})

it('prevents a retired runtime build from continuing or changing replacement registration', async () => {
  const s = setup()
  const stale = middleware
  const oldState = scope.__codexRemoteSharedBridge__
  const pending = deferred()
  const started = deferred<void>()
  s.rpc.mockImplementation(() => { started.resolve(); return s.rpc.mock.calls.length === 1 ? pending.promise : Promise.resolve({ data: [] }) })
  const old = s.search('original')
  await started.promise
  oldState.version = 'incompatible'
  const replacement = createCodexBridgeMiddleware()
  const replacementState = scope.__codexRemoteSharedBridge__
  vi.spyOn(replacementState.appServer as AppServerClient, 'rpc').mockImplementation(async (method) => method === 'thread/list' ? { data: [{ id: 'new', name: 'fresh' }] } : {})
  try {
    pending.resolve({ data: [{ id: 'a', name: 'original' }], nextCursor: 'next' })
    expect(await old).toEqual({ error: 'Search middleware disposed' })
    expect(s.rpc).toHaveBeenCalledOnce()
    stale.dispose()
    expect(scope.__codexRemoteSharedBridge__).toBe(replacementState)
    expect(await s.request('thread-search', { query: 'fresh' }, replacement)).toEqual({ data: { threadIds: ['new'], indexedThreadCount: 1 } })
  } finally { replacement.dispose() }
})
