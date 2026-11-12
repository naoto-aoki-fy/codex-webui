import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import { AppServerClient, createCodexBridgeMiddleware } from './codexAppServerBridge'

const scope = globalThis as typeof globalThis & { __codexRemoteSharedBridge__?: any }
const previous = scope.__codexRemoteSharedBridge__
afterEach(() => { scope.__codexRemoteSharedBridge__ = previous; vi.unstubAllEnvs() })
function seed() {
  const client = new AppServerClient()
  const runtime = { version: 'external-websocket-files-v2', appServer: client, methodCatalog: {} }
  scope.__codexRemoteSharedBridge__ = runtime
  return { client, runtime, dispose: vi.spyOn(client, 'dispose') }
}

it('keeps RPCs, pending calls and notifications alive until the final owner releases the one shared connection', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>(resolve => server.once('listening', resolve))
  vi.stubEnv('CODEXUI_APP_SERVER_URL', `ws://127.0.0.1:${(server.address() as { port: number }).port}`)
  let connections = 0
  let pendingSent!: () => void
  const sent = new Promise<void>(resolve => { pendingSent = resolve })
  server.on('connection', socket => {
    connections++
    socket.on('message', raw => {
      const frame = JSON.parse(String(raw))
      if (!frame.id) return
      if (frame.method === 'test/pending') { pendingSent(); return }
      socket.send(JSON.stringify({ id: frame.id, result: { ok: true } }))
    })
  })
  const { client, runtime, dispose } = seed()
  const a = createCodexBridgeMiddleware(), b = createCodexBridgeMiddleware()
  const listener = vi.fn()
  const unsubscribe = b.subscribeNotifications(listener)
  try {
    await client.rpc('test/ready', {})
    const pending = client.rpc('test/pending', {})
    const rejected = pending.catch(error => error)
    await sent
    a.dispose(); a.dispose()
    expect(dispose).not.toHaveBeenCalled()
    expect(scope.__codexRemoteSharedBridge__).toBe(runtime)
    const req = Readable.from([JSON.stringify({ method: 'test/echo', params: {} })])
    Object.assign(req, { method: 'POST', url: '/codex-api/rpc', headers: {} })
    const end = vi.fn()
    const res = Object.assign(new EventEmitter(), { setHeader: vi.fn(), write: vi.fn(), end })
    await b(req as unknown as IncomingMessage, res as unknown as ServerResponse, vi.fn())
    expect(JSON.parse(end.mock.calls[0]![0])).toEqual({ result: { ok: true } })
    ;(client as any).emitNotification({ method: 'test/event', params: {} })
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ method: 'test/event' }))
    expect(connections).toBe(1)
    b.dispose(); b.dispose(); a.dispose()
    expect(await rejected).toEqual(expect.objectContaining({ message: expect.stringMatching(/disposed|disconnected/i) }))
    expect(dispose).toHaveBeenCalledOnce()
    expect(scope.__codexRemoteSharedBridge__).toBeUndefined()
  } finally {
    unsubscribe(); a.dispose(); b.dispose()
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

it('cannot remove or dispose a replacement registration from a stale owner', () => {
  const old = seed()
  const stale = createCodexBridgeMiddleware()
  const replacement = seed()
  const active = createCodexBridgeMiddleware()
  try {
    stale.dispose(); stale.dispose()
    expect(scope.__codexRemoteSharedBridge__).toBe(replacement.runtime)
    expect(old.dispose).toHaveBeenCalledOnce()
    expect(replacement.dispose).not.toHaveBeenCalled()
    active.dispose()
    expect(replacement.dispose).toHaveBeenCalledOnce()
  } finally { stale.dispose(); active.dispose() }
})

it('shares ownership across compatible module reloads and releases a single owner exactly once', async () => {
  const { runtime, dispose } = seed()
  const a = createCodexBridgeMiddleware()
  vi.resetModules()
  const reloaded = await import('./codexAppServerBridge')
  const b = reloaded.createCodexBridgeMiddleware()
  expect(scope.__codexRemoteSharedBridge__).toBe(runtime)
  a.dispose()
  expect(dispose).not.toHaveBeenCalled()
  b.dispose(); b.dispose()
  expect(dispose).toHaveBeenCalledOnce()
  expect(scope.__codexRemoteSharedBridge__).toBeUndefined()

  const single = seed()
  const only = reloaded.createCodexBridgeMiddleware()
  only.dispose(); only.dispose()
  expect(single.dispose).toHaveBeenCalledOnce()
  expect(scope.__codexRemoteSharedBridge__).toBeUndefined()
})
