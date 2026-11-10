import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createCodexBridgeMiddleware } from './codexAppServerBridge'
import { connectBrowserNotifications } from './browserNotificationTransport'
import { WebSocket } from 'ws'

type Notification = { method: string; params: unknown }
const scope = globalThis as typeof globalThis & { __codexRemoteSharedBridge__?: unknown }
let previous: unknown
let listeners: Set<(value: Notification) => void>
let release: ReturnType<typeof vi.fn<() => void>>
let appServer: { onNotification: ReturnType<typeof vi.fn<(fn: (value: Notification) => void) => () => void>>; dispose: ReturnType<typeof vi.fn<() => void>> }
let stop: ReturnType<typeof vi.fn<() => void>>
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-10T00:00:00.000Z'))
  previous = scope.__codexRemoteSharedBridge__
  listeners = new Set()
  release = vi.fn()
  appServer = {
    onNotification: vi.fn((fn: (value: Notification) => void) => {
      listeners.add(fn)
      return () => { release(); listeners.delete(fn) }
    }),
    dispose: vi.fn(() => listeners.clear()),
  }
  stop = vi.fn()
  scope.__codexRemoteSharedBridge__ = { version: 'external-websocket-v1', appServer, telegramBridge: { stop }, methodCatalog: {} }
})
afterEach(() => {
  scope.__codexRemoteSharedBridge__ = previous
  vi.clearAllTimers()
  vi.useRealTimers()
})
function streams(method = 'GET', url = '/codex-api/events') {
  const req = Object.assign(new EventEmitter(), { method, url, headers: {}, socket: { remoteAddress: '127.0.0.1' } })
  const res = Object.assign(new EventEmitter(), { statusCode: 0, setHeader: vi.fn(), write: vi.fn(), end: vi.fn(), writableEnded: false, destroyed: false })
  const next = vi.fn()
  return { req, res, write: res.write, end: res.end, next, args: [req as unknown as IncomingMessage, res as unknown as ServerResponse, next] as const }
}
function emit(value: Notification) { for (const fn of listeners) fn(value) }

it('preserves exact headers, ready, ordered envelopes and no replay without extra subscriptions', async () => {
  const middleware = createCodexBridgeMiddleware()
  emit({ method: 'old', params: {} })
  const s = streams('GET', '/codex-api/events?reconnect=1')
  await middleware(...s.args)
  expect(s.res.statusCode).toBe(200)
  expect(s.res.setHeader.mock.calls).toEqual([
    ['Content-Type', 'text/event-stream; charset=utf-8'], ['Cache-Control', 'no-cache, no-transform'],
    ['Connection', 'keep-alive'], ['X-Accel-Buffering', 'no'],
  ])
  expect(s.write.mock.calls.map(call => [call[0]])).toEqual([['event: ready\ndata: {"ok":true}\n\n']])
  const values = [{ method: 'first', params: { nested: [1, null], text: 'line\nbreak' } }, { method: 'second', params: null }]
  for (const value of values) emit(value)
  expect(s.write.mock.calls.slice(1).map(call => [call[0]])).toEqual(values.map(value => [`data: ${JSON.stringify({ ...value, atIso: '2026-11-10T00:00:00.000Z' })}\n\n`]))
  expect(appServer.onNotification).toHaveBeenCalledOnce()
  expect(s.next).not.toHaveBeenCalled()
  s.req.emit('close')
  emit(values[0]!)
  expect(s.write).toHaveBeenCalledTimes(3)
})
it.each(['close', 'aborted'])('preserves heartbeat timing and repeated %s cleanup with retained listeners', async event => {
  const s = streams()
  await createCodexBridgeMiddleware()(...s.args)
  expect(vi.getTimerCount()).toBe(1)
  vi.advanceTimersByTime(14999)
  expect(s.write).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(1)
  expect(s.write).toHaveBeenLastCalledWith(': ping\n\n', undefined, undefined)
  vi.advanceTimersByTime(15000)
  expect(s.write).toHaveBeenCalledTimes(3)
  s.req.emit(event)
  expect(release).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
  expect(listeners.size).toBe(0)
  expect(s.end).toHaveBeenCalledOnce()
  s.res.writableEnded = true
  s.req.emit('close')
  s.req.emit('aborted')
  expect(release).toHaveBeenCalledTimes(3)
  expect(s.end).toHaveBeenCalledOnce()
  expect(s.req.listenerCount('close')).toBe(1)
  expect(s.req.listenerCount('aborted')).toBe(1)
  expect(s.res.eventNames()).toEqual(['finish', 'close']) // Bridge response instrumentation remains attached.
  vi.advanceTimersByTime(30000)
  expect(s.write).toHaveBeenCalledTimes(3)
})
it('skips notifications on ended/destroyed responses but leaves heartbeat unguarded', async () => {
  const s = streams()
  await createCodexBridgeMiddleware()(...s.args)
  s.res.destroyed = true
  emit({ method: 'ignored', params: {} })
  s.res.destroyed = false
  s.res.writableEnded = true
  emit({ method: 'ignored', params: {} })
  expect(s.write).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(15000)
  expect(s.write).toHaveBeenLastCalledWith(': ping\n\n', undefined, undefined)
  s.req.emit('aborted')
  expect(s.end).not.toHaveBeenCalled()
})
it('maps subscription failure through the existing bridge error handler before ready or timer setup', async () => {
  appServer.onNotification.mockImplementation(() => { throw new Error('subscription failed') })
  const s = streams()
  await createCodexBridgeMiddleware()(...s.args)
  expect(s.res.statusCode).toBe(502)
  expect(s.end).toHaveBeenCalledWith(JSON.stringify({ error: 'subscription failed' }), undefined, undefined)
  expect(s.write).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  expect(s.req.eventNames()).toEqual([])
})
it('preserves the existing subscription leak if ready writing fails before cleanup registration', async () => {
  const s = streams()
  s.write.mockImplementation(() => { throw new Error('write failed') })
  await createCodexBridgeMiddleware()(...s.args)
  expect(s.res.statusCode).toBe(502)
  expect(s.end).toHaveBeenCalledWith(JSON.stringify({ error: 'write failed' }), undefined, undefined)
  expect(listeners.size).toBe(1)
  expect(release).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  expect(s.req.eventNames()).toEqual([])
})
it('shares one runtime across middleware and keeps SSE and browser WebSocket subscriptions independent', async () => {
  const first = createCodexBridgeMiddleware()
  const second = createCodexBridgeMiddleware()
  const a = streams(), b = streams()
  await first(...a.args)
  await second(...b.args)
  const ws = Object.assign(new EventEmitter(), { readyState: WebSocket.OPEN, send: vi.fn() })
  const disposeWs = connectBrowserNotifications(ws as unknown as WebSocket, second.subscribeNotifications)
  expect(listeners.size).toBe(3)
  expect(vi.getTimerCount()).toBe(2)
  emit({ method: 'live', params: {} })
  expect(a.write).toHaveBeenCalledTimes(2)
  expect(b.write).toHaveBeenCalledTimes(2)
  expect(ws.send).toHaveBeenCalledTimes(2)
  a.req.emit('close')
  emit({ method: 'later', params: {} })
  expect(a.write).toHaveBeenCalledTimes(2)
  expect(b.write).toHaveBeenCalledTimes(3)
  expect(ws.send).toHaveBeenCalledTimes(3)
  disposeWs()
  expect(listeners.size).toBe(1)
  expect(vi.getTimerCount()).toBe(1)
  b.req.emit('aborted')
  expect(listeners.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
  expect(appServer.dispose).not.toHaveBeenCalled()
})
it('does not close active SSE or clear its timer on middleware disposal; request cleanup still releases it', async () => {
  const middleware = createCodexBridgeMiddleware()
  const s = streams()
  await middleware(...s.args)
  middleware.dispose()
  expect(appServer.dispose).toHaveBeenCalledOnce()
  expect(stop).toHaveBeenCalledOnce()
  expect(scope.__codexRemoteSharedBridge__).toBeUndefined()
  expect(s.end).not.toHaveBeenCalled()
  expect(release).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(1)
  vi.advanceTimersByTime(15000)
  expect(s.write).toHaveBeenLastCalledWith(': ping\n\n', undefined, undefined)
  s.req.emit('close')
  expect(release).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
it.each([['POST', '/codex-api/events'], ['GET', '/codex-api/events/']])('keeps route matching exact (%s %s)', async (method, url) => {
  const s = streams(method, url)
  await createCodexBridgeMiddleware()(...s.args)
  expect(s.next).toHaveBeenCalledOnce()
  expect(appServer.onNotification).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
