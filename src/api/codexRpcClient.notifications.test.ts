import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { subscribeRpcNotifications } from './codexRpcClient'

class BrowserSocket {
  static instances: BrowserSocket[] = []
  onopen = () => {}
  onclose = () => {}
  onerror = () => {}
  close = vi.fn()
  constructor(public url: string) { BrowserSocket.instances.push(this) }
}
class BrowserEvents {
  static CLOSED = 2
  static instances: BrowserEvents[] = []
  readyState = 1
  close = vi.fn()
  addEventListener = vi.fn()
  constructor(public url: string) { BrowserEvents.instances.push(this) }
}
beforeEach(() => {
  vi.useFakeTimers()
  BrowserSocket.instances = []
  BrowserEvents.instances = []
  vi.stubGlobal('window', { location: { protocol: 'https:', host: 'example.test' }, setTimeout, clearTimeout })
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
