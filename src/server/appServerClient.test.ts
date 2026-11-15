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
      } else if (frame.method === 'test/unknown') {
        socket.send(JSON.stringify({ id: frame.id, error: { code: -32601, message: 'Method not found' } }))
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
    const [missing, valid] = await Promise.allSettled([client.rpc('test/unknown', {}), client.rpc('test/collision', {})])
    expect(missing.status).toBe('rejected')
    if (missing.status === 'rejected') expect(missing.reason).toMatchObject({ code: -32601, message: 'Method not found' })
    expect(valid).toEqual({ status: 'fulfilled', value: 'reply' })
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

it('reuses the current runtime across middleware instances and disposes the active client on version replacement', async () => {
  const { createCodexBridgeMiddleware } = await import('./codexAppServerBridge')
  const scope = globalThis as typeof globalThis & { __codexRemoteSharedBridge__?: any }
  const previous = scope.__codexRemoteSharedBridge__
  const client = new AppServerClient()
  const dispose = vi.spyOn(client, 'dispose')
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
    Object.assign(runtime, { version: 'legacy' })
    const replacement = createCodexBridgeMiddleware()
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

it('uses the injected journal without recording turn metadata without creating or connecting another runtime', async () => {
  const { AppServerClient: ClientCore } = await import('./appServerClient')
  const call = vi.fn().mockResolvedValue({ turn: { id: 'turn' } })
  const threadIndex = { call: vi.fn(async (method, params, rpc) => rpc(method, params)) }
  const client = new ClientCore({ threadIndex })
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
    expect(result.turn).not.toHaveProperty('generationMetadata')
    expect(listener).not.toHaveBeenCalled()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try { await expect(client.rpc('turn/start', params)).resolves.toHaveProperty('turn.id', 'turn') }
    finally { warn.mockRestore() }
  } finally { client.dispose() }
})

it('retains recovery snapshots beyond the retired full-history cache TTL', () => {
  const client = new AppServerClient()
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
  const snapshot = { thread: { id: 'retained', turns: [] } }
  try {
    expect(client.getLastThreadReadSnapshot('retained')).toBeNull()
    client.storeThreadReadSnapshot('retained', snapshot)
    now.mockReturnValue(31_000)
    expect(client.getLastThreadReadSnapshot('retained')).toBe(snapshot)
  } finally { now.mockRestore(); client.dispose() }
})

it('discards fallback snapshots and buffered events on thread/reverted', () => {
  const client = new AppServerClient()
  try {
    client.storeThreadReadSnapshot('reverted', { thread: { id: 'reverted', turns: ['deleted'] } })
    ;(client as any).emitNotification({ method: 'item/completed', params: { threadId: 'reverted', turnId: 't1', item: { id: 'cmd', type: 'commandExecution' } } })
    expect(client.getStreamEvents('reverted', 100)).toHaveLength(1)
    const epoch = client.getSnapshotEpoch()
    ;(client as any).emitNotification({ method: 'thread/reverted', params: { threadId: 'reverted' } })
    expect(client.getSnapshotEpoch()).not.toBe(epoch)
    expect(client.getLastThreadReadSnapshot('reverted')).toBeNull()
    expect(client.getStreamEvents('reverted', 100)).toEqual([])
  } finally { client.dispose() }
})
it('forgets native deleted thread snapshots subscriptions and stream events without clearing another thread',()=>{
 const client=new AppServerClient()
 try{
  client.storeThreadReadSnapshot('deleted',{thread:{id:'deleted',turns:[]}});client.storeThreadReadSnapshot('keep',{thread:{id:'keep',turns:[]}})
  ;(client as any).subscribedThreads.add('deleted');(client as any).subscribedThreads.add('keep')
  ;(client as any).emitNotification({method:'thread/deleted',params:{threadId:'deleted'}})
  expect(client.getLastThreadReadSnapshot('deleted')).toBeNull();expect(client.getStreamEvents('deleted',100)).toEqual([])
  expect((client as any).subscribedThreads.has('deleted')).toBe(false);expect((client as any).subscribedThreads.has('keep')).toBe(true);expect(client.getLastThreadReadSnapshot('keep')).not.toBeNull()
 }finally{client.dispose()}
})
