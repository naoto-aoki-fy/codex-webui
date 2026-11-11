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

it.each(['disconnect', 'replacement'] as const)('keeps established unanswered calls pending until %s; isolates stale replies and never replays', async cause => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const client = new AppServerClient({
    threadIndex: { call: async (method: string, params: unknown, rpc: (method: string, params: unknown) => Promise<unknown>) => rpc(method, params) },
    metadataStore: { save: vi.fn() },
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
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(120_000)
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

