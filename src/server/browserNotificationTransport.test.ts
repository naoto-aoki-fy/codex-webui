import { backendInstanceId } from './backendInstance'
import { EventEmitter, once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { attachBrowserNotificationTransport, connectBrowserNotifications } from './browserNotificationTransport'

const productionRelease = vi.hoisted(() => vi.fn())
vi.mock('./codexAppServerBridge', () => ({
  createCodexBridgeMiddleware: () => Object.assign(
    (_req: unknown, _res: unknown, next: () => void) => next(),
    { dispose: vi.fn(), subscribeNotifications: () => productionRelease },
  ),
}))
import { createServer as createProductionServer } from './httpServer'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const notification = { method: 'turn/completed', params: { threadId: 'test', nested: [1, null] }, atIso: '2026-11-08T00:00:00.000Z' }

it('sends ready first, forwards unchanged frames only while open, and cleans up once after error and close', () => {
  const ws = Object.assign(new EventEmitter(), { readyState: WebSocket.OPEN as number, send: vi.fn() })
  let listener!: (value: typeof notification) => void
  const unsubscribe = vi.fn()
  const dispose = connectBrowserNotifications(ws as unknown as WebSocket, (fn) => { listener = fn; return unsubscribe })
  expect(JSON.parse(ws.send.mock.calls[0]![0])).toEqual({ method: 'ready', params: { ok: true, backendInstanceId, connectionProfile: 'legacy' }, atIso: expect.any(String) })
  listener(notification)
  expect(ws.send).toHaveBeenLastCalledWith(JSON.stringify(notification))
  for (const state of [WebSocket.CONNECTING, WebSocket.CLOSING, WebSocket.CLOSED]) {
    ws.readyState = state
    listener(notification)
  }
  expect(ws.send).toHaveBeenCalledTimes(2)
  ws.emit('error', new Error('disconnected'))
  ws.emit('error', new Error('second error'))
  ws.emit('close')
  dispose()
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(ws.listenerCount('error')).toBe(0)
})

async function listen(server: Server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanup.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  return `ws://127.0.0.1:${(server.address() as { port: number }).port}`
}
async function connect(url: string, options?: { headers: Record<string, string> }) {
  const ws = new WebSocket(url, options)
  cleanup.push(() => { ws.terminate() })
  const [frame] = await once(ws, 'message')
  expect(JSON.parse(String(frame))).toEqual({ method: 'ready', params: { ok: true, backendInstanceId, connectionProfile: 'legacy' }, atIso: expect.any(String) })
  return ws
}

it('routes only the notification endpoint, preserves auth, reconnects without stale subscriptions, and releases on disposal', async () => {
  const server = createServer()
  const active = new Set<(value: typeof notification) => void>()
  const unsubscribe = vi.fn()
  const dispose = attachBrowserNotificationTransport(server, (fn) => {
    active.add(fn)
    return () => { unsubscribe(); active.delete(fn) }
  }, (req) => req.headers.cookie === 'session=valid')
  const base = await listen(server)
  cleanup.push(dispose)
  const denied = new WebSocket(base + '/codex-api/ws')
  cleanup.push(() => denied.terminate())
  denied.on('error', () => {})
  const [, response] = await once(denied, 'unexpected-response')
  expect(response.statusCode).toBe(401)
  expect(active.size).toBe(0)
  // A second upgrade owner must still receive its endpoint (e.g. Vite HMR).
  const otherUpgrade = vi.fn((_req, socket) => { socket.end('HTTP/1.1 418 Teapot\r\nContent-Length: 0\r\n\r\n') })
  server.on('upgrade', (req, socket) => { if (req.url === '/other') otherUpgrade(req, socket) })
  const other = new WebSocket(base + '/other')
  cleanup.push(() => other.terminate())
  other.on('error', () => {})
  const [, otherResponse] = await once(other, 'unexpected-response')
  expect(otherResponse.statusCode).toBe(418)
  expect(otherUpgrade).toHaveBeenCalledOnce()
  for (let i = 0; i < 2; i++) {
    const ws = await connect(base + '/codex-api/ws?browser=1', { headers: { Cookie: 'session=valid' } })
    expect(active.size).toBe(1)
    const frame = once(ws, 'message')
    for (const fn of active) fn(notification)
    expect(JSON.parse(String((await frame)[0]))).toEqual(notification)
    const closed = once(ws, 'close')
    ws.close()
    await closed
    await vi.waitFor(() => expect(active.size).toBe(0))
  }
  const ws = await connect(base + '/codex-api/ws', { headers: { Cookie: 'session=valid' } })
  dispose()
  dispose()
  expect(active.size).toBe(0)
  expect(unsubscribe).toHaveBeenCalledTimes(3)
  expect(server.listenerCount('upgrade')).toBe(1) // Other owner survives.
  expect(ws.readyState).toBe(WebSocket.OPEN) // Disposal does not force-terminate clients.
})

it('releases active subscriptions and upgrade listeners when the host closes', async () => {
  const server = createServer()
  const unsubscribe = vi.fn()
  const dispose = attachBrowserNotificationTransport(server, () => unsubscribe)
  const base = await listen(server)
  cleanup.push(dispose)
  await connect(base + '/codex-api/ws')
  // Node normally emits close after HTTP connections drain; exercise that lifecycle
  // event directly so the client remains active during transport cleanup.
  server.emit('close')
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(server.listenerCount('upgrade')).toBe(0)
  dispose()
  expect(unsubscribe).toHaveBeenCalledOnce()
})

it('keeps production authentication and wires instance disposal to transport cleanup', async () => {
  const production = createProductionServer({ password: 'test-password' })
  cleanup.push(production.dispose)
  const server = createServer(production.app)
  production.attachWebSocket(server)
  const base = await listen(server)
  const denied = new WebSocket(base + '/codex-api/ws')
  denied.on('error', () => {})
  cleanup.push(() => denied.terminate())
  const [, response] = await once(denied, 'unexpected-response')
  expect(response.statusCode).toBe(401)
  production.dispose()
  expect(server.listenerCount('upgrade')).toBe(0)
})

it('releases a connected production browser subscription when the instance is disposed', async () => {
  productionRelease.mockClear()
  const production = createProductionServer()
  cleanup.push(production.dispose)
  const server = createServer(production.app)
  production.attachWebSocket(server)
  const base = await listen(server)
  const ws = await connect(base + '/codex-api/ws')
  production.dispose()
  production.dispose()
  expect(productionRelease).toHaveBeenCalledOnce()
  const closed = once(ws, 'close')
  ws.close()
  await closed
  expect(productionRelease).toHaveBeenCalledOnce()
})

it('forwards the current App Server snapshot to a newly ready browser without a network probe', () => {
  const ws = Object.assign(new EventEmitter(), { readyState: WebSocket.OPEN, send: vi.fn() })
  const snapshot = { method: 'app-server/transportState', params: { state: 'disconnected' }, atIso: notification.atIso }
  const dispose = connectBrowserNotifications(ws as unknown as WebSocket, listener => {
    listener(snapshot)
    return vi.fn()
  })
  expect(ws.send.mock.calls.map(([frame]) => JSON.parse(frame).method)).toEqual(['ready', 'app-server/transportState'])
  expect(JSON.parse(ws.send.mock.calls[1]![0])).toEqual(snapshot)
  dispose()
})
