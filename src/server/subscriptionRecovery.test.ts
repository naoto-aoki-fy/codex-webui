import { afterEach, expect, it, vi } from 'vitest'
import { SubscriptionRecovery } from './subscriptionRecovery'
afterEach(() => vi.useRealTimers())
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
it('deduplicates transient failures and releases workers during backoff', async () => {
  vi.useFakeTimers()
  const call = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValue('ok')
  const status = vi.fn()
  const recovery = new SubscriptionRecovery(call, status)
  const first = recovery.request('a', {})
  expect(recovery.request('a', {})).toBe(first)
  await flush()
  await expect(recovery.request('b', {})).resolves.toBe('ok')
  await vi.advanceTimersByTimeAsync(500)
  await expect(first).resolves.toBe('ok')
  expect(status).toHaveBeenCalledWith('a', 'recovered', 2)
  expect(vi.getTimerCount()).toBe(0)
})
it('exhausts attempts and supports a fresh manual retry', async () => {
  vi.useFakeTimers()
  const call = vi.fn().mockRejectedValue(new Error('missing'))
  const status = vi.fn()
  const recovery = new SubscriptionRecovery(call, status)
  const result = recovery.request('a', {})
  const rejected = expect(result).rejects.toThrow('missing')
  await vi.runAllTimersAsync()
  await rejected
  expect(call).toHaveBeenCalledTimes(4)
  expect(status).toHaveBeenCalledWith('a', 'failed', 4, 'missing')
  call.mockResolvedValue('restored')
  await expect(recovery.request('a', {})).resolves.toBe('restored')
})
it('invalidates queued timers and late results on another disconnect', async () => {
  vi.useFakeTimers()
  let resolve!: (value: unknown) => void
  const status = vi.fn()
  const recovery = new SubscriptionRecovery(() => new Promise(yes => { resolve = yes }), status)
  const result = recovery.request('a', {})
  const rejected = expect(result).rejects.toThrow('invalidated')
  recovery.cancel()
  resolve('old connection')
  await rejected
  await flush()
  expect(status).not.toHaveBeenCalledWith('a', 'recovered', 1)
  expect(vi.getTimerCount()).toBe(0)
})
