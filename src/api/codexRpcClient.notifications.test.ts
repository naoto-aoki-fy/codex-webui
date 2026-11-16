import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { subscribeRpcNotifications } from './codexRpcClient'

class BrowserSocket {
  static instances: BrowserSocket[] = []
  onopen = () => {}
  onclose = () => {}
  onerror = () => {}
  onmessage = (_event: { data: string }) => {}
  close = vi.fn()
  constructor(public url: string) { BrowserSocket.instances.push(this) }
}
class BrowserEvents extends EventTarget {
  static CLOSED = 2
  static instances: BrowserEvents[] = []
  readyState = 1
  onmessage = (_event: { data: string }) => {}
  onerror = () => {}
  close = vi.fn()
  constructor(public url: string) { super(); BrowserEvents.instances.push(this) }
}

let browserWindow: EventTarget & { location: { protocol: string; host: string }; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }
let browserDocument: EventTarget & { visibilityState: string }
let browserNavigator: { onLine: boolean }

function setVisibility(visibilityState: string) {
  browserDocument.visibilityState = visibilityState
  browserDocument.dispatchEvent(new Event('visibilitychange'))
}

function pageShow(persisted: boolean) {
  browserWindow.dispatchEvent(Object.assign(new Event('pageshow'), { persisted }))
}

beforeEach(() => {
  vi.useFakeTimers()
  BrowserSocket.instances = []
  BrowserEvents.instances = []
  browserWindow = Object.assign(new EventTarget(), { location: { protocol: 'https:', host: 'example.test' }, setTimeout, clearTimeout })
  browserDocument = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  browserNavigator = { onLine: true }
  vi.stubGlobal('window', browserWindow)
  vi.stubGlobal('document', browserDocument)
  vi.stubGlobal('navigator', browserNavigator)
  vi.stubGlobal('WebSocket', BrowserSocket)
  vi.stubGlobal('EventSource', BrowserEvents)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it.each(['closed', 'timeout', 'unavailable'])('preserves SSE fallback when WebSocket is %s and cleans it up', (mode) => {
  if (mode === 'unavailable') vi.stubGlobal('WebSocket', undefined)
  const dispose = subscribeRpcNotifications(vi.fn())
  const ws = BrowserSocket.instances[0]
  if (mode === 'closed') ws!.onclose()
  if (mode === 'timeout') { vi.advanceTimersByTime(2500); ws!.onclose() }
  expect(BrowserEvents.instances).toHaveLength(1)
  expect(BrowserEvents.instances[0]!.url).toBe('/codex-api/events')
  dispose()
  expect(BrowserEvents.instances[0]!.close).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('replaces an offline socket on return online even if the old socket never reports close', () => {
  const dispose = subscribeRpcNotifications(vi.fn())
  const first = BrowserSocket.instances[0]!
  first.onopen()
  browserNavigator.onLine = false
  browserWindow.dispatchEvent(new Event('offline'))
  expect(first.close).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(30000)
  expect(BrowserSocket.instances).toHaveLength(1)
  expect(BrowserEvents.instances).toHaveLength(0)
  browserNavigator.onLine = true
  browserWindow.dispatchEvent(new Event('online'))
  vi.advanceTimersByTime(100)
  expect(BrowserSocket.instances).toHaveLength(2)
  first.onclose()
  BrowserSocket.instances[1]!.onopen()
  expect(vi.getTimerCount()).toBe(0)
  dispose()
})

it('waits for online before connecting when the subscription starts offline', () => {
  browserNavigator.onLine = false
  const dispose = subscribeRpcNotifications(vi.fn())
  vi.advanceTimersByTime(30000)
  expect(BrowserSocket.instances).toHaveLength(0)
  expect(BrowserEvents.instances).toHaveLength(0)
  browserNavigator.onLine = true
  browserWindow.dispatchEvent(new Event('online'))
  vi.advanceTimersByTime(100)
  expect(BrowserSocket.instances).toHaveLength(1)
  dispose()
})

it.each(['ws', 'sse'])('preserves ordinary initial ready params on %s', (transport) => {
  if (transport === 'sse') vi.stubGlobal('WebSocket', undefined)
  const notify = vi.fn()
  const dispose = subscribeRpcNotifications(notify)
  const params = { ok: true, session: 'initial' }
  if (transport === 'ws') {
    BrowserSocket.instances[0]!.onopen()
    BrowserSocket.instances[0]!.onmessage({ data: JSON.stringify({ method: 'ready', params }) })
  } else {
    BrowserEvents.instances[0]!.dispatchEvent(new MessageEvent('ready', { data: JSON.stringify(params) }))
  }
  expect(notify).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ method: 'ready', params }))
  dispose()
})

it.each(['ws', 'sse'])('marks the first ready after an offline interruption as reconnected on %s', (transport) => {
  if (transport === 'sse') vi.stubGlobal('WebSocket', undefined)
  const notify = vi.fn()
  const dispose = subscribeRpcNotifications(notify)
  browserNavigator.onLine = false
  browserWindow.dispatchEvent(new Event('offline'))
  browserNavigator.onLine = true
  browserWindow.dispatchEvent(new Event('online'))
  vi.advanceTimersByTime(100)
  const params = { ok: true, session: 'recovered' }
  const ready = JSON.stringify({ method: 'ready', params })
  const progress = JSON.stringify({ method: 'turn/completed', params: { threadId: 'thread-1' } })
  if (transport === 'ws') {
    const current = BrowserSocket.instances[1]!
    current.onopen()
    current.onmessage({ data: ready })
    current.onmessage({ data: progress })
  } else {
    const current = BrowserEvents.instances[1]!
    current.dispatchEvent(new MessageEvent('ready', { data: JSON.stringify(params) }))
    current.onmessage({ data: progress })
  }
  expect(notify).toHaveBeenNthCalledWith(1, expect.objectContaining({
    method: 'ready', params: { ...params, reconnected: true },
  }))
  expect(notify).toHaveBeenNthCalledWith(2, expect.objectContaining({
    method: 'turn/completed', params: { threadId: 'thread-1' },
  }))
  dispose()
})

it.each(['ws', 'sse'])('marks ready after a transport retry before any previous ready on %s', (transport) => {
  if (transport === 'sse') vi.stubGlobal('WebSocket', undefined)
  const notify = vi.fn()
  const dispose = subscribeRpcNotifications(notify)
  if (transport === 'ws') {
    const first = BrowserSocket.instances[0]!
    first.onopen()
    first.onclose()
    vi.advanceTimersByTime(1000)
    const current = BrowserSocket.instances[1]!
    current.onopen()
    current.onmessage({ data: '{"method":"ready","params":{"ok":true}}' })
  } else {
    const current = BrowserEvents.instances[0]!
    // EventSource retries internally while CONNECTING, without creating a new instance.
    current.readyState = 0
    current.onerror()
    current.readyState = 1
    current.dispatchEvent(new MessageEvent('ready', { data: '{"ok":true}' }))
  }
  expect(notify).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    method: 'ready', params: { ok: true, reconnected: true },
  }))
  dispose()
})

it('replaces a silently suspended socket on hidden-to-visible without closing it while hidden', () => {
  const dispose = subscribeRpcNotifications(vi.fn())
  const first = BrowserSocket.instances[0]!
  first.onopen()
  setVisibility('hidden')
  vi.advanceTimersByTime(30000)
  expect(first.close).not.toHaveBeenCalled()
  setVisibility('visible')
  vi.advanceTimersByTime(100)
  expect(first.close).toHaveBeenCalledOnce()
  expect(BrowserSocket.instances).toHaveLength(2)
  dispose()
})

it('rechecks network status on resume when the online event was missed while suspended', () => {
  const dispose = subscribeRpcNotifications(vi.fn())
  BrowserSocket.instances[0]!.onopen()
  browserNavigator.onLine = false
  browserWindow.dispatchEvent(new Event('offline'))
  browserNavigator.onLine = true
  browserDocument.dispatchEvent(new Event('resume'))
  vi.advanceTimersByTime(100)
  expect(BrowserSocket.instances).toHaveLength(2)
  dispose()
})

it('coalesces online, resume, visible and BFCache restoration into one replacement', () => {
  const dispose = subscribeRpcNotifications(vi.fn())
  BrowserSocket.instances[0]!.onopen()
  setVisibility('hidden')
  browserDocument.dispatchEvent(new Event('freeze'))
  browserWindow.dispatchEvent(new Event('online'))
  browserDocument.dispatchEvent(new Event('resume'))
  setVisibility('visible')
  pageShow(true)
  vi.advanceTimersByTime(100)
  expect(BrowserSocket.instances).toHaveLength(2)
  BrowserSocket.instances[1]!.onopen()
  expect(vi.getTimerCount()).toBe(0)
  dispose()
})

it('does not reconnect for initial visibility, ordinary pageshow or focus', () => {
  const dispose = subscribeRpcNotifications(vi.fn())
  BrowserSocket.instances[0]!.onopen()
  setVisibility('visible')
  pageShow(false)
  browserWindow.dispatchEvent(new Event('focus'))
  vi.advanceTimersByTime(30000)
  expect(BrowserSocket.instances).toHaveLength(1)
  expect(vi.getTimerCount()).toBe(0)
  dispose()
})

it('cancels a pending WebSocket fallback before a lifecycle replacement', () => {
  const dispose = subscribeRpcNotifications(vi.fn())
  const first = BrowserSocket.instances[0]!
  vi.advanceTimersByTime(2450)
  browserWindow.dispatchEvent(new Event('online'))
  vi.advanceTimersByTime(100)
  expect(first.close).toHaveBeenCalledOnce()
  expect(BrowserSocket.instances).toHaveLength(2)
  expect(BrowserEvents.instances).toHaveLength(0)
  BrowserSocket.instances[1]!.onopen()
  expect(vi.getTimerCount()).toBe(0)
  dispose()
})

it('ignores callbacks from obsolete sockets, including ready and late open during a new retry', () => {
  const notify = vi.fn()
  const dispose = subscribeRpcNotifications(notify)
  const first = BrowserSocket.instances[0]!
  first.onopen()
  setVisibility('hidden')
  setVisibility('visible')
  vi.advanceTimersByTime(100)
  const second = BrowserSocket.instances[1]!
  second.onopen()
  second.onclose()
  first.onopen()
  first.onmessage({ data: JSON.stringify({ method: 'ready', params: { ok: true } }) })
  first.onmessage({ data: JSON.stringify({ method: 'turn/completed', params: { threadId: 'old' } }) })
  first.onclose()
  vi.advanceTimersByTime(1000)
  expect(notify).not.toHaveBeenCalled()
  expect(BrowserSocket.instances).toHaveLength(3)
  expect(BrowserEvents.instances).toHaveLength(0)
  dispose()
})

it('recovers using SSE after fallback and ignores stale SSE ready/message callbacks', () => {
  const notify = vi.fn()
  const dispose = subscribeRpcNotifications(notify)
  BrowserSocket.instances[0]!.onclose()
  const first = BrowserEvents.instances[0]!
  first.dispatchEvent(new MessageEvent('ready', { data: '{"ok":true}' }))
  expect(notify).toHaveBeenCalledOnce()
  notify.mockClear()
  setVisibility('hidden')
  setVisibility('visible')
  vi.advanceTimersByTime(100)
  expect(BrowserSocket.instances).toHaveLength(1)
  expect(BrowserEvents.instances).toHaveLength(2)
  expect(first.close).toHaveBeenCalledOnce()
  first.onmessage({ data: '{"method":"turn/completed","params":null}' })
  first.dispatchEvent(new MessageEvent('ready', { data: '{"ok":true}' }))
  first.readyState = BrowserEvents.CLOSED
  first.onerror()
  vi.advanceTimersByTime(10000)
  expect(notify).not.toHaveBeenCalled()
  expect(BrowserEvents.instances).toHaveLength(2)
  const second = BrowserEvents.instances[1]!
  second.dispatchEvent(new MessageEvent('ready', { data: '{"ok":true}' }))
  second.dispatchEvent(new MessageEvent('ready', { data: '{"ok":true}' }))
  expect(notify).toHaveBeenCalledTimes(2)
  dispose()
})

it('cancels retry and lifecycle timers and removes listeners on disposal', () => {
  const removeWindowListener = vi.spyOn(browserWindow, 'removeEventListener')
  const removeDocumentListener = vi.spyOn(browserDocument, 'removeEventListener')
  const notify = vi.fn()
  const dispose = subscribeRpcNotifications(notify)
  const first = BrowserSocket.instances[0]!
  first.onopen()
  first.onclose()
  setVisibility('hidden')
  setVisibility('visible')
  dispose()
  dispose()
  expect(first.close).toHaveBeenCalledOnce()
  first.onmessage({ data: '{"method":"ready","params":null}' })
  browserWindow.dispatchEvent(new Event('online'))
  pageShow(true)
  browserDocument.dispatchEvent(new Event('resume'))
  setVisibility('hidden')
  setVisibility('visible')
  vi.advanceTimersByTime(30000)
  expect(notify).not.toHaveBeenCalled()
  expect(BrowserSocket.instances).toHaveLength(1)
  expect(vi.getTimerCount()).toBe(0)
  expect(removeWindowListener.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(['online', 'offline', 'pageshow']))
  expect(removeDocumentListener.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(['visibilitychange', 'resume']))
})

it('reconnects an opened WebSocket once after close and cancels pending reconnect on disposal', () => {
  const dispose = subscribeRpcNotifications(vi.fn())
  const first = BrowserSocket.instances[0]!
  expect(first.url).toBe('wss://example.test/codex-api/ws')
  first.onopen()
  first.onerror()
  expect(vi.getTimerCount()).toBe(0)
  first.onclose()
  vi.advanceTimersByTime(1000)
  expect(BrowserSocket.instances).toHaveLength(2)
  expect(BrowserEvents.instances).toHaveLength(0)
  const second = BrowserSocket.instances[1]!
  second.onopen()
  second.onclose()
  dispose()
  vi.advanceTimersByTime(10000)
  expect(BrowserSocket.instances).toHaveLength(2)
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['ws', 'sse'])('reports independent browser status, deduplicates failures and waits for ready on %s', transport => {
  if (transport === 'sse') vi.stubGlobal('WebSocket', undefined)
  const status = vi.fn()
  const notify = vi.fn()
  const dispose = subscribeRpcNotifications(notify, status)
  const ready = () => {
    if (transport === 'ws') BrowserSocket.instances[BrowserSocket.instances.length - 1]!.onmessage({ data: '{"method":"ready","params":{"ok":true}}' })
    else BrowserEvents.instances[BrowserEvents.instances.length - 1]!.dispatchEvent(new MessageEvent('ready', { data: '{"ok":true}' }))
  }
  if (transport === 'ws') BrowserSocket.instances[0]!.onopen()
  expect(status).not.toHaveBeenCalled()
  ready()
  expect(status).toHaveBeenLastCalledWith('connected')
  if (transport === 'ws') BrowserSocket.instances[0]!.onclose()
  else { BrowserEvents.instances[0]!.readyState = 0; BrowserEvents.instances[0]!.onerror(); BrowserEvents.instances[0]!.onerror() }
  expect(status.mock.calls.map(row => row[0])).toEqual(['connected', transport === 'ws' ? 'disconnected' : 'reconnecting'])
  if (transport === 'ws') {
    vi.advanceTimersByTime(1000)
    BrowserSocket.instances[BrowserSocket.instances.length - 1]!.onopen()
  }
  vi.advanceTimersByTime(60000)
  expect(status).not.toHaveBeenLastCalledWith('connected')
  expect(status).not.toHaveBeenLastCalledWith('connected')
  ready()
  expect(status).toHaveBeenLastCalledWith('connected')
  expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'ready', params: { ok: true, reconnected: true } }))
  ready()
  expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'ready', params: { ok: true } }))
  expect(status.mock.calls.filter(row => row[0] === 'connected')).toHaveLength(2)
  dispose()
})

it.each(['ws', 'sse'])('reports offline, online and suspended-tab recovery on %s without trusting stale readiness', transport => {
  if (transport === 'sse') vi.stubGlobal('WebSocket', undefined)
  const status = vi.fn()
  const dispose = subscribeRpcNotifications(vi.fn(), status)
  browserNavigator.onLine = false
  browserWindow.dispatchEvent(new Event('offline'))
  expect(status).toHaveBeenLastCalledWith('disconnected')
  vi.advanceTimersByTime(60000)
  expect(status).toHaveBeenCalledTimes(1)
  browserNavigator.onLine = true
  browserWindow.dispatchEvent(new Event('online'))
  expect(status).toHaveBeenLastCalledWith('reconnecting')
  vi.advanceTimersByTime(100)
  const ready = () => {
    if (transport === 'ws') BrowserSocket.instances[BrowserSocket.instances.length - 1]!.onmessage({ data: '{"method":"ready"}' })
    else BrowserEvents.instances[BrowserEvents.instances.length - 1]!.dispatchEvent(new MessageEvent('ready', { data: '{}' }))
  }
  ready()
  expect(status).toHaveBeenLastCalledWith('connected')
  setVisibility('hidden')
  setVisibility('visible')
  expect(status).toHaveBeenLastCalledWith('reconnecting')
  if (transport === 'ws') BrowserSocket.instances[BrowserSocket.instances.length - 1]!.onmessage({ data: '{"method":"ready"}' })
  else BrowserEvents.instances[BrowserEvents.instances.length - 1]!.dispatchEvent(new MessageEvent('ready', { data: '{}' }))
  expect(status).toHaveBeenLastCalledWith('reconnecting')
  vi.advanceTimersByTime(100)
  ready()
  expect(status).toHaveBeenLastCalledWith('connected')
  dispose()
})

it('shows startup offline status immediately and cannot clear it with a retired callback', () => {
  browserNavigator.onLine = false
  const status = vi.fn()
  const dispose = subscribeRpcNotifications(vi.fn(), status)
  expect(status).toHaveBeenCalledExactlyOnceWith('disconnected')
  vi.advanceTimersByTime(60000)
  expect(BrowserSocket.instances).toHaveLength(0)
  dispose()
  browserWindow.dispatchEvent(new Event('online'))
  expect(status).toHaveBeenCalledTimes(1)
})

it('keeps the fallback warning until SSE ready and ignores a retired WebSocket ready', () => {
  const status = vi.fn()
  const dispose = subscribeRpcNotifications(vi.fn(), status)
  const retired = BrowserSocket.instances[0]!
  vi.advanceTimersByTime(2500)
  expect(status).toHaveBeenLastCalledWith('disconnected')
  retired.onmessage({ data: '{"method":"ready"}' })
  expect(status).toHaveBeenLastCalledWith('disconnected')
  const source = BrowserEvents.instances[0]!
  source.dispatchEvent(new MessageEvent('ready', { data: '{}' }))
  expect(status).toHaveBeenLastCalledWith('connected')
  source.readyState = BrowserEvents.CLOSED
  source.onerror()
  expect(status).toHaveBeenLastCalledWith('disconnected')
  vi.advanceTimersByTime(1000)
  expect(status).toHaveBeenLastCalledWith('reconnecting')
  BrowserEvents.instances[1]!.dispatchEvent(new MessageEvent('ready', { data: '{}' }))
  expect(status).toHaveBeenLastCalledWith('connected')
  dispose()
  source.onerror()
  expect(status).toHaveBeenLastCalledWith('connected')
  expect(vi.getTimerCount()).toBe(0)
})
