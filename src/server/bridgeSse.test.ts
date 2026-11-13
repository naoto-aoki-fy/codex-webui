import { backendInstanceId } from './backendInstance'
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
  scope.__codexRemoteSharedBridge__ = { version: 'external-websocket-files-v2', appServer, methodCatalog: {} }
})
afterEach(() => {
  scope.__codexRemoteSharedBridge__ = previous
  vi.restoreAllMocks()
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
  expect(s.write.mock.calls.map(call => [call[0]])).toEqual([[`event: ready\ndata: ${JSON.stringify({ ok: true, backendInstanceId, connectionProfile: 'legacy' })}\n\n`]])
  const values = [{ method: 'first', params: { nested: [1, null], text: 'line\nbreak' } }, { method: 'second', params: null }]
  for (const value of values) emit(value)
  expect(s.write.mock.calls.slice(1).map(call => [call[0]])).toEqual(values.map(value => [`data: ${JSON.stringify({ ...value, atIso: '2026-11-10T00:00:00.000Z' })}\n\n`]))
  expect(appServer.onNotification).toHaveBeenCalledOnce()
  expect(s.next).not.toHaveBeenCalled()
  s.req.emit('close')
  emit(values[0]!)
  expect(s.write).toHaveBeenCalledTimes(3)
})
it.each(['close', 'aborted'])('preserves heartbeat timing and repeated %s cleanup exactly once', async event => {
  const clear = vi.spyOn(globalThis, 'clearInterval')
  const s = streams()
  await createCodexBridgeMiddleware()(...s.args)
  const callback = appServer.onNotification.mock.calls[0]![0]
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
  s.req.emit('close')
  s.req.emit('aborted')
  expect(release).toHaveBeenCalledOnce()
  expect(s.end).toHaveBeenCalledOnce()
  expect(s.req.listenerCount('close')).toBe(0)
  expect(s.req.listenerCount('aborted')).toBe(0)
  expect(clear).toHaveBeenCalledOnce()
  callback({ method: 'late', params: {} })
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
it('releases the subscription if ready writing fails', async () => {
  const owner = createCodexBridgeMiddleware()
  const s = streams()
  s.write.mockImplementation(() => { throw new Error('write failed') })
  await owner(...s.args)
  owner.dispose()
  expect(s.end).toHaveBeenCalledOnce()
  expect(s.res.statusCode).toBe(502)
  expect(s.end).toHaveBeenCalledWith(JSON.stringify({ error: 'write failed' }), undefined, undefined)
  expect(listeners.size).toBe(0)
  expect(release).toHaveBeenCalledOnce()
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
it('closes active SSE on middleware disposal, including late close and repeated disposal', async () => {
  const middleware = createCodexBridgeMiddleware()
  const s = streams()
  await middleware(...s.args)
  middleware.dispose(); middleware.dispose()
  expect(appServer.dispose).toHaveBeenCalledOnce()
  expect(scope.__codexRemoteSharedBridge__).toBeUndefined()
  expect(s.end).toHaveBeenCalledOnce()
  expect(release).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
  expect(s.req.eventNames()).toEqual([])
  s.req.emit('close'); s.req.emit('aborted')
  vi.advanceTimersByTime(30000)
  expect(s.write).toHaveBeenCalledTimes(1)
  expect(release).toHaveBeenCalledOnce()
})
it.each([['POST', '/codex-api/events'], ['GET', '/codex-api/events/']])('keeps route matching exact (%s %s)', async (method, url) => {
  const s = streams(method, url)
  await createCodexBridgeMiddleware()(...s.args)
  expect(s.next).toHaveBeenCalledOnce()
  expect(appServer.onNotification).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['timer', 'listener'])('releases acquired resources after %s setup fails', async stage => {
  const s = streams()
  const failure = new Error('setup failed')
  const spy = stage === 'timer'
    ? vi.spyOn(globalThis, 'setInterval').mockImplementationOnce(() => { throw failure })
    : vi.spyOn(s.req, 'on').mockImplementation((event, listener) => {
      if (event === 'aborted') throw failure
      EventEmitter.prototype.on.call(s.req, event, listener)
      return s.req
    })
  try {
    await createCodexBridgeMiddleware()(...s.args)
    expect(s.res.statusCode).toBe(502)
    expect(release).toHaveBeenCalledOnce()
    expect(listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(s.req.eventNames()).toEqual([])
    const writes = s.write.mock.calls.length
    emit({ method: 'after-failure', params: {} })
    vi.advanceTimersByTime(30000)
    expect(s.write).toHaveBeenCalledTimes(writes)
  } finally { spy.mockRestore() }
})

it('acquires no resources if setting a response header fails', async () => {
  const s = streams()
  s.res.setHeader.mockImplementationOnce(() => { throw new Error('header failed') })
  await createCodexBridgeMiddleware()(...s.args)
  expect(s.res.statusCode).toBe(502)
  expect(appServer.onNotification).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  expect(s.req.eventNames()).toEqual([])
})

it('detaches listeners and clears the timer even if unsubscribe throws', async () => {
  const s = streams()
  await createCodexBridgeMiddleware()(...s.args)
  release.mockImplementationOnce(() => { throw new Error('unsubscribe failed') })
  expect(() => s.req.emit('close')).toThrow('unsubscribe failed')
  expect(vi.getTimerCount()).toBe(0)
  expect(s.req.eventNames()).toEqual([])
  s.req.emit('close'); s.req.emit('aborted')
  expect(release).toHaveBeenCalledOnce()
  expect(s.end).toHaveBeenCalledOnce()
})

it.each(['close', 'aborted'])('removes normally %s streams from owner cleanup', async event => {
  const owner = createCodexBridgeMiddleware()
  const a = streams(), b = streams(), c = streams()
  for (const stream of [a, b, c]) await owner(...stream.args)
  a.req.emit(event)
  owner.dispose()
  expect(release).toHaveBeenCalledTimes(3)
  for (const stream of [a, b, c]) {
    expect(stream.end).toHaveBeenCalledOnce()
    expect(stream.req.eventNames()).toEqual([])
  }
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['subscribe', 'ready'])('disposes during %s setup without retaining resources', async stage => {
  const owner = createCodexBridgeMiddleware()
  const s = streams()
  if (stage === 'ready') s.write.mockImplementationOnce(() => { owner.dispose() })
  else {
    const subscribe = appServer.onNotification.getMockImplementation()!
    appServer.onNotification.mockImplementationOnce(fn => { const off = subscribe(fn); owner.dispose(); return off })
  }
  await owner(...s.args)
  expect(release).toHaveBeenCalledOnce()
  expect(s.end).toHaveBeenCalledOnce()
  expect(s.req.eventNames()).toEqual([])
  expect(vi.getTimerCount()).toBe(0)
  const late = streams()
  await owner(...late.args)
  expect(late.end).toHaveBeenCalledOnce()
  expect(appServer.onNotification).toHaveBeenCalledOnce()
})

it.each(['unsubscribe', 'end'])('releases all streams and runtime even if %s throws', async stage => {
  const owner = createCodexBridgeMiddleware()
  const a = streams(), b = streams()
  await owner(...a.args); await owner(...b.args)
  if (stage === 'unsubscribe') release.mockImplementationOnce(() => { throw new Error('unsubscribe failed') })
  else a.end.mockImplementationOnce(() => { throw new Error('end failed') })
  expect(() => owner.dispose()).not.toThrow()
  owner.dispose()
  expect(release).toHaveBeenCalledTimes(2)
  expect(a.end).toHaveBeenCalledOnce()
  expect(b.end).toHaveBeenCalledOnce()
  expect(a.req.eventNames()).toEqual([])
  expect(b.req.eventNames()).toEqual([])
  expect(vi.getTimerCount()).toBe(0)
  expect(appServer.dispose).toHaveBeenCalledOnce()
})

it('keeps the other owner SSE and browser WebSocket alive until final release', async () => {
  const first = createCodexBridgeMiddleware(), second = createCodexBridgeMiddleware()
  const a = streams(), b = streams()
  await first(...a.args); await second(...b.args)
  const ws = Object.assign(new EventEmitter(), { readyState: WebSocket.OPEN, send: vi.fn() })
  const disposeWs = connectBrowserNotifications(ws as unknown as WebSocket, second.subscribeNotifications)
  first.dispose(); first.dispose()
  expect(a.end).toHaveBeenCalledOnce()
  expect(b.end).not.toHaveBeenCalled()
  expect(release).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(1)
  expect(appServer.dispose).not.toHaveBeenCalled()
  emit({ method: 'survives', params: {} })
  expect(a.write).toHaveBeenCalledTimes(1)
  expect(b.write).toHaveBeenCalledTimes(2)
  expect(ws.send).toHaveBeenCalledTimes(2)
  disposeWs()
  second.dispose(); second.dispose()
  expect(b.end).toHaveBeenCalledOnce()
  expect(release).toHaveBeenCalledTimes(3)
  expect(vi.getTimerCount()).toBe(0)
  expect(appServer.dispose).toHaveBeenCalledOnce()
})

it('stale owner closes only its SSE after runtime replacement', async () => {
  const stale = createCodexBridgeMiddleware(), a = streams()
  await stale(...a.args)
  const oldDispose = appServer.dispose
  const replacementListeners = new Set<(value: Notification) => void>()
  const replacement = {
    version: 'external-websocket-files-v2', methodCatalog: {}, appServer: { dispose: vi.fn(), onNotification: vi.fn((fn: (value: Notification) => void) => {
      replacementListeners.add(fn)
      return () => replacementListeners.delete(fn)
    }) },
  }
  scope.__codexRemoteSharedBridge__ = replacement
  const active = createCodexBridgeMiddleware(), b = streams()
  await active(...b.args)
  stale.dispose(); stale.dispose()
  expect(oldDispose).toHaveBeenCalledOnce()
  expect(a.end).toHaveBeenCalledOnce()
  expect(b.end).not.toHaveBeenCalled()
  expect(replacement.appServer.dispose).not.toHaveBeenCalled()
  expect(scope.__codexRemoteSharedBridge__).toBe(replacement)
  for (const fn of replacementListeners) fn({ method: 'replacement', params: {} })
  expect(b.write).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(1)
  active.dispose()
  expect(b.end).toHaveBeenCalledOnce()
  expect(replacementListeners.size).toBe(0)
  expect(replacement.appServer.dispose).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
