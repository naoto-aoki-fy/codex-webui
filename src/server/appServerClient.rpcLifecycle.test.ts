import { afterEach, expect, it, vi } from 'vitest'

// Keep the real transport handshake, socket-generation guard, and client pending
// map. Replace only the wire so ordering and elapsed time are deterministic.
const wire = vi.hoisted(() => ({ sockets: [] as any[] }))
vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events')
  class Socket extends EventEmitter {
    static OPEN = 1
    readyState = 1
    frames: any[] = []
    constructor() {
      super()
      wire.sockets.push(this)
      queueMicrotask(() => this.emit('open'))
    }
    send(raw: string, callback?: (error?: Error) => void) {
      const frame = JSON.parse(raw)
      this.frames.push(frame)
      if (frame.method === 'initialize') queueMicrotask(() => this.reply(frame.id, {}))
      callback?.()
    }
    reply(id: number, result: unknown) { this.emit('message', Buffer.from(JSON.stringify({ id, result })), false) }
    terminate() { this.readyState = 3; this.emit('close') }
  }
  return { default: Socket }
})
import { AppServerClient } from './appServerClient'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); wire.sockets.length = 0 })
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }

it.each(['disconnect', 'replacement'] as const)('isolates stale replies and never replays on %s', async cause => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const client = new AppServerClient({
    threadIndex: { call: async (method: string, params: unknown, rpc: (method: string, params: unknown) => Promise<unknown>) => rpc(method, params) }
  } as any)
  const internal = client as any
  try {
    const a = client.rpc('test/unanswered', {})
    const b = client.rpc('test/independent', {})
    const aRejected = expect(a).rejects.toThrow('disconnected')
    const bRejected = expect(b).rejects.toThrow('disconnected')
    await flush()
    const old = wire.sockets[0]!
    expect(old.frames.slice(0, 2).map((f: any) => f.method)).toEqual(['initialize', 'initialized'])
    expect(old.frames.slice(2).map((f: any) => f.method).sort()).toEqual(['test/independent', 'test/unanswered'])
    expect(internal.pending.size).toBe(2)
    expect(internal.transport.pending.size).toBe(0)
    expect(vi.getTimerCount()).toBe(2)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(internal.pending.size).toBe(2)
    expect(wire.sockets).toHaveLength(1)
    const oldIds = old.frames.slice(2).map((f: any) => f.id)
    const generation = internal.connectionGeneration
    if (cause === 'disconnect') old.terminate()
    else await client.reconnect()
    await Promise.all([aRejected, bRejected])
    expect(internal.pending.size).toBe(0)
    expect(internal.connectionGeneration).toBe(generation + 1)
    if (cause === 'disconnect') await client.reconnect()
    const fresh = wire.sockets[1]!
    const c = client.rpc('test/new', {})
    const d = client.rpc('test/new-independent', {})
    await flush()
    const frames = fresh.frames.filter((f: any) => f.method.startsWith('test/'))
    expect(frames.map((f: any) => f.method)).toEqual(['test/new', 'test/new-independent'])
    expect(frames.every((f: any) => !oldIds.includes(f.id))).toBe(true)
    // Even a forged matching *new* ID from the obsolete socket is filtered.
    old.reply(frames[0].id, 'obsolete socket')
    fresh.reply(oldIds[0], 'obsolete request')
    await flush()
    expect(internal.pending.size).toBe(2)
    fresh.reply(frames[1].id, 'independent')
    expect(await d).toBe('independent')
    expect(internal.pending.size).toBe(1)
    fresh.reply(frames[0].id, 'fresh')
    expect(await c).toBe('fresh')
    fresh.reply(frames[0].id, 'duplicate')
    expect(internal.pending.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(old.frames).toHaveLength(4)
  } finally { client.dispose() }
})


it('retains connection metadata and structured RPC errors, and clears metadata on disconnect', async () => {
  const client = new AppServerClient({ threadIndex: { call: (method, params, rpc) => rpc(method, params) } })
  try {
    const call = client.rpc('fs/readFile', { path: '/remote/file' })
    const rejected = expect(call).rejects.toMatchObject({ message: 'Permission denied', code: -32600, data: { path: '/remote/file' } })
    await flush()
    const socket = wire.sockets[0]!
    expect(client.getInitializationMetadata()).toEqual({})
    const frame = socket.frames.find((f: any) => f.method === 'fs/readFile')
    socket.emit('message', Buffer.from(JSON.stringify({ id: frame.id, error: { message: 'Permission denied', code: -32600, data: { path: '/remote/file' } } })), false)
    await rejected
    socket.terminate()
    expect(client.getInitializationMetadata()).toBeNull()
  } finally { client.dispose() }
})

it('expires ordinary calls without replay or cancelling a silent remote command', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const client = new AppServerClient({ threadIndex: { call: (m, p, rpc) => rpc(m, p) } })
  try {
    const ordinary = client.rpc('fs/readFile', { path: '/B/file' })
    const expired = expect(ordinary).rejects.toThrow('outcome unknown')
    const command = client.rpc('command/exec', { command: ['long-turn'], cwd: '/B' })
    await flush()
    await vi.advanceTimersByTimeAsync(60_001)
    await expired
    expect((client as any).pending.size).toBe(1)
    const socket = wire.sockets[0]
    expect(socket.frames.filter((f: any) => f.method === 'command/exec')).toHaveLength(1)
    expect(socket.frames.some((f: any) => /terminate|cancel/.test(f.method))).toBe(false)
    socket.reply(socket.frames.find((f: any) => f.method === 'command/exec').id, 'completed')
    expect(await command).toBe('completed')
  } finally { client.dispose() }
})

it('a missing restored thread never blocks independent RPCs or healthy subscriptions', async () => {
  const client = new AppServerClient({ threadIndex: { call: (m, p, rpc) => rpc(m, p) } })
  try {
    const internal = client as any
    internal.subscribedThreads.add('missing')
    internal.subscribedThreads.add('healthy')
    await client.reconnect()
    await flush()
    const socket = wire.sockets[0]
    const read = client.rpc('model/list', {})
    await flush()
    const missing = socket.frames.find((f: any) => f.params?.threadId === 'missing')
    expect(missing.params.excludeTurns).toBe(true)
    socket.emit('message', Buffer.from(JSON.stringify({ id: missing.id, error: { code: -1, message: 'missing thread' } })), false)
    socket.reply(socket.frames.find((f: any) => f.method === 'model/list').id, 'models')
    expect(await read).toBe('models')
    await flush()
    expect(socket.frames.find((f: any) => f.params?.threadId === 'healthy')).toBeTruthy()
  } finally { client.dispose() }
})

it('coalesces automatic reconnects and never sends an old approval to a reused wire ID', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)
  const client = new AppServerClient({ threadIndex: { call: (m, p, rpc) => rpc(m, p) } })
  try {
    const first = client.rpc('test/read', {})
    await flush()
    const old = wire.sockets[0]
    old.reply(old.frames.find((f: any) => f.method === 'test/read').id, {})
    await first
    const approval = { id: 7, method: 'item/commandExecution/requestApproval', params: { threadId: 't' } }
    old.emit('message', Buffer.from(JSON.stringify(approval)), false)
    const stale = client.listPendingServerRequests()[0].id
    old.terminate()
    await vi.advanceTimersByTimeAsync(500)
    await flush()
    expect(wire.sockets).toHaveLength(2)
    const fresh = wire.sockets[1]
    fresh.emit('message', Buffer.from(JSON.stringify(approval)), false)
    const current = client.listPendingServerRequests()[0].id
    expect(current).not.toBe(stale)
    await expect(client.respondToServerRequest({ id: stale, result: {} })).rejects.toThrow('No pending')
    expect(fresh.frames.some((f: any) => f.id === 7 && !f.method)).toBe(false)
    await client.respondToServerRequest({ id: current, result: { decision: 'accept' } })
    expect(fresh.frames).toContainEqual({ id: 7, result: { decision: 'accept' } })
    expect(wire.sockets).toHaveLength(2)
  } finally { client.dispose(); random.mockRestore() }
})

it.each(['tunnel', 'server restart'])('restores one subscription per thread after %s without replaying in-flight turns', async () => {
  const client = new AppServerClient({ threadIndex: { call: (m, p, rpc) => rpc(m, p) } })
  try {
    const resume = client.rpc('thread/resume', { threadId: 'running' })
    await flush()
    const old = wire.sockets[0]
    old.reply(old.frames.find((f: any) => f.method === 'thread/resume').id, { thread: { id: 'running' } })
    await resume
    const turn = client.rpc('turn/start', { threadId: 'running', input: [] })
    const rejected = expect(turn).rejects.toThrow('disconnected')
    await flush()
    old.terminate()
    await rejected
    await Promise.all([client.reconnect(), client.reconnect()])
    await flush()
    const fresh = wire.sockets[1]
    const frames = fresh.frames.filter((f: any) => f.method === 'thread/resume')
    expect(frames).toHaveLength(1)
    expect(frames[0].params).toEqual({ threadId: 'running', excludeTurns: true })
    expect(fresh.frames.some((f: any) => f.method === 'turn/start')).toBe(false)
    fresh.reply(frames[0].id, { thread: { id: 'running' } })
    await flush()
    expect(wire.sockets).toHaveLength(2)
  } finally { client.dispose() }
})

it('bounds silent resume attempts while healthy threads and unrelated calls recover', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const client = new AppServerClient({ threadIndex: { call: (m, p, rpc) => rpc(m, p) } })
  try {
    const internal = client as any
    for (const id of ['silent', 'b', 'c']) internal.subscribedThreads.add(id)
    await client.reconnect()
    await flush()
    const socket = wire.sockets[0]
    for (const id of ['b', 'c']) socket.reply(socket.frames.find((f: any) => f.params?.threadId === id).id, { thread: { id } })
    const read = client.rpc('model/list', {})
    await flush()
    socket.reply(socket.frames.find((f: any) => f.method === 'model/list').id, 'models')
    expect(await read).toBe('models')
    await vi.advanceTimersByTimeAsync(5001)
    expect(internal.pending.size).toBe(0)
    socket.terminate()
    await client.reconnect()
    await flush()
    expect(internal.recovery.jobs.size).toBe(3)
    expect(internal.pending.size).toBe(3)
    const fresh = wire.sockets[1]
    fresh.terminate()
    await flush()
    expect(internal.recovery.jobs.size).toBe(0)
    expect(internal.pending.size).toBe(0)
    expect(vi.getTimerCount()).toBe(1) // sole transport reconnect timer
  } finally { client.dispose() }
})

it.each([false, true])('recovers a failed restored subscription (persistent=%s) and delivers notifications', async persistent => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const client = new AppServerClient({ threadIndex: { call: (m, p, rpc) => rpc(m, p) } })
  const events: Array<{ method: string; params: any }> = []
  client.onNotification(event => events.push(event))
  try {
    const initial = client.rpc('thread/resume', { threadId: 'recover-me', excludeTurns: true })
    await flush()
    const old = wire.sockets[0]
    old.reply(old.frames.find((f: any) => f.method === 'thread/resume').id, { thread: { id: 'recover-me' } })
    await initial
    old.terminate()
    await client.reconnect()
    await flush()
    const fresh = wire.sockets[1]
    const failLatest = () => {
      const frame = fresh.frames.filter((f: any) => f.method === 'thread/resume').at(-1)
      fresh.emit('message', Buffer.from(JSON.stringify({ id: frame.id, error: { code: -1, message: 'disposable resume failure' } })), false)
    }
    failLatest()
    await flush()
    await vi.advanceTimersByTimeAsync(500)
    if (persistent) {
      failLatest(); await flush()
      await vi.advanceTimersByTimeAsync(1000)
      failLatest(); await flush()
      await vi.advanceTimersByTimeAsync(2000)
      failLatest(); await flush()
      expect(events).toContainEqual(expect.objectContaining({ method: 'app-server/subscriptionRecovery', params: expect.objectContaining({ threadId: 'recover-me', state: 'failed', attempt: 4 }) }))
    }
    const manual = persistent ? client.rpc('thread/resume', { threadId: 'recover-me', excludeTurns: true }) : null
    await flush()
    const last = fresh.frames.filter((f: any) => f.method === 'thread/resume').at(-1)
    fresh.reply(last.id, { thread: { id: 'recover-me' } })
    if (manual) await manual
    await flush()
    fresh.emit('message', Buffer.from(JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'recover-me', itemId: 'after-recovery', delta: 'delivered' } })), false)
    expect(events).toContainEqual(expect.objectContaining({ method: 'app-server/subscriptionRecovery', params: expect.objectContaining({ threadId: 'recover-me', state: 'recovered' }) }))
    expect(events).toContainEqual({ method: 'item/agentMessage/delta', params: { threadId: 'recover-me', itemId: 'after-recovery', delta: 'delivered' } })
    expect(fresh.frames.filter((f: any) => f.method === 'thread/resume')).toHaveLength(persistent ? 5 : 2)
    expect(fresh.frames.some((f: any) => f.method === 'turn/start')).toBe(false)
  } finally { client.dispose() }
})
