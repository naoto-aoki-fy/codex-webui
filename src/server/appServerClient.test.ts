import { expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import { AppServerClient } from './codexAppServerBridge'

it('correlates concurrent replies and colliding server IDs, clears pending calls, and restores subscriptions once', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address() as { port: number }
  vi.stubEnv('CODEXUI_APP_SERVER_URL', `ws://127.0.0.1:${address.port}`)
  const frames: any[] = []
  let connections = 0
  server.on('connection', socket => {
    connections++
    socket.on('message', raw => {
      const frame = JSON.parse(raw.toString()); frames.push(frame)
      if (frame.method === 'initialize') socket.send(JSON.stringify({ id: frame.id, result: {} }))
      else if (frame.method === 'test/collision') {
        socket.send(JSON.stringify({ id: frame.id, method: 'test/approval', params: {} }))
        socket.send(JSON.stringify({ method: 'test/notification', params: {} }))
        socket.send(JSON.stringify({ id: frame.id, result: 'reply' }))
      } else if (['thread/start', 'thread/resume'].includes(frame.method)) {
        socket.send(JSON.stringify({ id: frame.id, result: { thread: { id: 'test-thread', turns: [] } } }))
      } else if (frame.method === 'thread/archive' || frame.method === 'thread/unsubscribe') {
        socket.send(JSON.stringify({ id: frame.id, result: {} }))
      } else if (frame.method === 'test/pending') socket.close()
    })
  })
  const client = new AppServerClient()
  const notifications: any[] = []
  const unsubscribe = client.onNotification(value => notifications.push(value))
  try {
    expect(await Promise.all([client.rpc('test/collision', {}), client.rpc('test/collision', {})])).toEqual(['reply', 'reply'])
    expect(connections).toBe(1)
    expect(frames.filter(f => f.method === 'initialize')).toHaveLength(1)
    expect(notifications.filter(f => f.method === 'test/notification')).toHaveLength(2)
    expect(client.listPendingServerRequests()).toHaveLength(2)
    const approval = client.listPendingServerRequests()[0]!
    await client.respondToServerRequest({ id: approval.id, result: { decision: 'accept' } })
    await client.rpc('thread/start', {})
    await expect(client.rpc('test/pending', {})).rejects.toThrow('disconnected')
    expect(client.listPendingServerRequests()).toEqual([])
    expect(notifications.filter(f => f.method === 'app-server/disconnected')).toHaveLength(1)
    await Promise.all([client.reconnect(), client.reconnect()])
    expect(connections).toBe(2)
    await vi.waitFor(() => expect(frames.filter(f => f.method === 'thread/resume')).toHaveLength(1))
    expect(frames.filter(f => f.method === 'test/pending')).toHaveLength(1)
    await expect(client.respondToServerRequest({ id: approval.id, result: {} })).rejects.toThrow('No pending')
    await client.rpc('thread/archive', { threadId: 'test-thread' })
    await client.reconnect()
    await vi.waitFor(() => expect(frames.filter(f => f.method === 'thread/resume')).toHaveLength(1))
    await client.rpc('thread/start', {})
    await client.rpc('thread/unsubscribe', { threadId: 'test-thread' })
    await client.reconnect()
    await vi.waitFor(() => expect(frames.filter(f => f.method === 'thread/resume')).toHaveLength(1))
    client.dispose()
    expect(server.address()).toBeTruthy()
  } finally {
    unsubscribe(); client.dispose(); vi.unstubAllEnvs()
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

it('reuses the current runtime across middleware instances and retires legacy workers on version replacement', async () => {
  const { createCodexBridgeMiddleware } = await import('./codexAppServerBridge')
  const scope = globalThis as typeof globalThis & { __codexRemoteSharedBridge__?: any }
  const previous = scope.__codexRemoteSharedBridge__
  const client = new AppServerClient()
  const dispose = vi.spyOn(client, 'dispose')
  const worker = { dispose: vi.fn(), scheduleThreadQueueDrain: vi.fn(), processThreadQueue: vi.fn(), startQueuedTurn: vi.fn() }
  const runtime = { version: 'external-websocket-files-v2', appServer: client, methodCatalog: {} }
  scope.__codexRemoteSharedBridge__ = runtime
  try {
    const first = createCodexBridgeMiddleware()
    const second = createCodexBridgeMiddleware()
    expect(scope.__codexRemoteSharedBridge__).toBe(runtime)
    const listener = vi.fn()
    const release = second.subscribeNotifications(listener)
    ;(client as any).emitNotification({ method: 'test/event', params: null })
    expect(listener).toHaveBeenCalledOnce()
    release()
    first.dispose()
    expect(dispose).not.toHaveBeenCalled()
    expect(scope.__codexRemoteSharedBridge__).toBe(runtime)
    Object.assign(runtime, { version: 'legacy', backendQueueProcessor: worker })
    const replacement = createCodexBridgeMiddleware()
    expect(worker.dispose).toHaveBeenCalledOnce()
    await worker.startQueuedTurn()
    await expect(client.rpc('test/event', {})).rejects.toThrow('Retired app-server bridge')
    expect(scope.__codexRemoteSharedBridge__.appServer).not.toBe(client)
    const replacementRuntime = scope.__codexRemoteSharedBridge__
    expect(dispose).toHaveBeenCalledOnce()
    second.dispose(); second.dispose(); first.dispose()
    expect(dispose).toHaveBeenCalledOnce()
    expect(scope.__codexRemoteSharedBridge__).toBe(replacementRuntime)
    replacement.dispose()
  } finally {
    client.dispose()
    scope.__codexRemoteSharedBridge__ = previous
  }
})

it('expires earlier-page reads after 30 seconds without expiring the fallback snapshot', async () => {
  const client = new AppServerClient()
  const read = vi.spyOn(client, 'rpc').mockResolvedValue({ thread: { id: 'ttl' } })
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
  try {
    expect(client.getLastThreadReadSnapshot('ttl')).toBeNull()
    const snapshot = { thread: { id: 'ttl', turns: [] } }
    client.storeThreadReadSnapshot('ttl', snapshot)
    await client.readThreadForTurnPage('ttl')
    now.mockReturnValue(30_999)
    await client.readThreadForTurnPage('ttl')
    expect(read).toHaveBeenCalledOnce()
    now.mockReturnValue(31_000)
    await client.readThreadForTurnPage('ttl')
    expect(read).toHaveBeenCalledTimes(2)
    expect(client.getLastThreadReadSnapshot('ttl')).toBe(snapshot)
  } finally { now.mockRestore(); client.dispose() }
})

it('uses injected stores for turn metadata without creating or connecting another runtime', async () => {
  const { AppServerClient: ClientCore } = await import('./appServerClient')
  const call = vi.fn().mockResolvedValue({ turn: { id: 'turn' } })
  const threadIndex = { call: vi.fn(async (method, params, rpc) => rpc(method, params)) }
  const metadataStore = { save: vi.fn().mockResolvedValue(undefined) }
  const client = new ClientCore({ threadIndex, metadataStore })
  const internal = client as any
  internal.ensureInitialized = vi.fn().mockResolvedValue(undefined)
  internal.call = call
  const listener = vi.fn()
  client.onNotification(listener)
  try {
    const params = { threadId: 'thread', model: 'fixture', effort: 'high' }
    const result = await client.rpc('turn/start', params) as any
    expect(threadIndex.call).toHaveBeenCalledOnce()
    expect(call).toHaveBeenCalledExactlyOnceWith('turn/start', params)
    expect(metadataStore.save).toHaveBeenCalledExactlyOnceWith('thread', 'turn', result.turn.generationMetadata)
    expect(listener).toHaveBeenCalledWith({ method: 'turn/generationMetadata', params: { threadId: 'thread', turnId: 'turn', generationMetadata: result.turn.generationMetadata } })
    metadataStore.save.mockRejectedValueOnce(new Error('disk unavailable'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try { await expect(client.rpc('turn/start', params)).resolves.toHaveProperty('turn.id', 'turn') }
    finally { warn.mockRestore() }
  } finally { client.dispose() }
})

function deferredRead() {
  let resolve!: (value: unknown) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

for (const invalidation of ['notification', 'snapshot'] as const) {
  it(`prevents stale pagination writes after ${invalidation} invalidation`, async () => {
    const client = new AppServerClient()
    const internal = client as any
    const old = deferredRead()
    const fresh = deferredRead()
    const rpc = vi.spyOn(client, 'rpc').mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const invalidate = () => invalidation === 'snapshot'
      ? client.storeThreadReadSnapshot('race', { thread: { id: 'race' } })
      : internal.emitNotification({ method: 'turn/started', params: { threadId: 'race' } })
    try {
      const first = client.readThreadForTurnPage('race')
      invalidate()
      old.resolve('old')
      expect(await first).toBe('old')
      expect(internal.threadTurnPageReadCacheByThreadId.size).toBe(0)
      const second = client.readThreadForTurnPage('race')
      expect(rpc).toHaveBeenCalledTimes(2)
      fresh.resolve('fresh')
      expect(await second).toBe('fresh')
      expect(await client.readThreadForTurnPage('race')).toBe('fresh')
      expect(rpc).toHaveBeenCalledTimes(2)
    } finally { client.dispose() }
  })

  it(`detaches stale promises on repeated ${invalidation} invalidations without deleting replacement reads`, async () => {
    const client = new AppServerClient()
    const internal = client as any
    const reads = [deferredRead(), deferredRead(), deferredRead(), deferredRead()]
    const rpc = vi.spyOn(client, 'rpc')
    for (const read of reads) rpc.mockReturnValueOnce(read.promise)
    const invalidate = () => invalidation === 'snapshot'
      ? client.storeThreadReadSnapshot('race', {})
      : internal.emitNotification({ method: 'turn/started', params: { threadId: 'race' } })
    try {
      const old = client.readThreadForTurnPage('race')
      const independent = client.readThreadForTurnPage('other')
      invalidate()
      const middle = client.readThreadForTurnPage('race')
      invalidate()
      const fresh = client.readThreadForTurnPage('race')
      const joined = client.readThreadForTurnPage('race')
      expect(rpc).toHaveBeenCalledTimes(4)
      reads[0]!.resolve('old')
      reads[2]!.resolve('middle')
      expect(await old).toBe('old')
      expect(await middle).toBe('middle')
      const stillJoined = client.readThreadForTurnPage('race')
      expect(rpc).toHaveBeenCalledTimes(4)
      reads[3]!.resolve('fresh')
      reads[1]!.resolve('other')
      expect(await Promise.all([fresh, joined, stillJoined, independent])).toEqual(['fresh', 'fresh', 'fresh', 'other'])
      expect(internal.threadTurnPageReadPromiseByThreadId.size).toBe(0)
      expect(await client.readThreadForTurnPage('other')).toBe('other')
      expect(rpc).toHaveBeenCalledTimes(4)
    } finally { client.dispose() }
  })
}

for (const outcome of ['resolve', 'reject'] as const) {
  it(`isolates ${outcome} completion from a disconnected generation and cleans up replacement reads`, async () => {
    const client = new AppServerClient()
    const internal = client as any
    const old = deferredRead()
    const fresh = deferredRead()
    const rpc = vi.spyOn(client, 'rpc').mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    try {
      const first = client.readThreadForTurnPage('generation')
      const firstResult = outcome === 'reject' ? expect(first).rejects.toThrow('disconnected') : expect(first).resolves.toBe('old')
      const generation = internal.connectionGeneration
      // Invoke the actual transport disconnect callback without network timing.
      // Resolve before disconnect to cover a reply queued for the next microtask.
      if (outcome === 'resolve') old.resolve('old')
      else internal.pending.set(99, { resolve: vi.fn(), reject: old.reject })
      internal.transport.disconnected()
      expect(internal.connectionGeneration).toBe(generation + 1)
      expect(internal.threadTurnPageReadPromiseByThreadId.size).toBe(0)
      const second = client.readThreadForTurnPage('generation')
      await firstResult
      expect(internal.threadTurnPageReadCacheByThreadId.size).toBe(0)
      const joined = client.readThreadForTurnPage('generation')
      expect(rpc).toHaveBeenCalledTimes(2)
      fresh.resolve('new connection')
      expect(await Promise.all([second, joined])).toEqual(['new connection', 'new connection'])
      expect(internal.threadTurnPageReadPromiseByThreadId.size).toBe(0)
      expect(internal.pending.size).toBe(0)
    } finally { client.dispose() }
  })
}

it('retains no pagination epoch bookkeeping for invalidated threads or rejected reads', async () => {
  const client = new AppServerClient()
  const internal = client as any
  const rpc = vi.spyOn(client, 'rpc').mockRejectedValue(new Error('read failed'))
  try {
    for (let i = 0; i < 100; i++) {
      const threadId = `ephemeral-${i}`
      await expect(client.readThreadForTurnPage(threadId)).rejects.toThrow('read failed')
      client.storeThreadReadSnapshot(threadId, {})
    }
    expect(rpc).toHaveBeenCalledTimes(100)
    expect(internal.threadTurnPageReadPromiseByThreadId.size).toBe(0)
    expect(internal.threadTurnPageReadCacheByThreadId.size).toBe(0)
  } finally { client.dispose() }
})

it('discards fallback snapshots, buffered events and pending pages on thread/reverted', async () => {
  const client = new AppServerClient()
  const internal = client as any
  const old = deferredRead()
  vi.spyOn(client, 'rpc').mockReturnValueOnce(old.promise)
  try {
    client.storeThreadReadSnapshot('reverted', { thread: { id: 'reverted', turns: ['deleted'] } })
    const epoch = client.getSnapshotEpoch()
    const pending = client.readThreadForTurnPage('reverted')
    internal.emitNotification({ method: 'thread/reverted', params: { threadId: 'reverted' } })
    expect(client.getSnapshotEpoch()).not.toBe(epoch)
    expect(client.getLastThreadReadSnapshot('reverted')).toBeNull()
    expect(client.getStreamEvents('reverted', 100)).toEqual([])
    old.resolve('deleted')
    await pending
    expect(internal.threadTurnPageReadCacheByThreadId.has('reverted')).toBe(false)
  } finally { client.dispose() }
})
