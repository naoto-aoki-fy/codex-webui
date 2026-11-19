import { afterEach, expect, it, vi } from 'vitest'
import { rpcCall } from '../api/codexRpcClient'
import { createBackendModelPreferences } from './backendModelPreferences'
import { emptyModelPreferences } from '../modelPreferences'
vi.mock('../api/codexRpcClient', () => ({ rpcCall: vi.fn() }))
afterEach(() => vi.resetAllMocks())
const snapshot = (revision: number) => ({ ...emptyModelPreferences(), revision })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }

it('coalesces startup/reconnect reads and rejects out-of-order snapshots after a push', async () => {
  const pending = deferred<ReturnType<typeof snapshot>>()
  vi.mocked(rpcCall).mockReturnValueOnce(pending.promise)
  const apply = vi.fn(), client = createBackendModelPreferences(apply)
  const a = client.refresh(), b = client.refresh()
  client.observe(snapshot(3)); pending.resolve(snapshot(1))
  await Promise.all([a, b])
  await client.ensureHydrated()
  expect(rpcCall).toHaveBeenCalledTimes(1)
  expect(client.state.value.revision).toBe(3)
  expect(apply).toHaveBeenCalledTimes(1)
})

it('retains pending optimistic reasoning edits across intermediate update notifications', async () => {
  vi.mocked(rpcCall).mockResolvedValueOnce(snapshot(1))
  const apply = vi.fn(), client = createBackendModelPreferences(apply)
  await client.refresh()
  const first = deferred<ReturnType<typeof snapshot>>()
  vi.mocked(rpcCall).mockReturnValueOnce(first.promise).mockResolvedValueOnce(snapshot(3))
  client.update({ reasoning: { providerId: 'p', modelId: 'm', effort: 'low' } })
  const done = client.update({ reasoning: { providerId: 'p', modelId: 'm', effort: 'high' } })
  await Promise.resolve()
  client.observe(snapshot(2))
  expect(apply.mock.lastCall?.[0].reasoningByModel['["p","m"]']).toBe('high')
  first.resolve({ ...snapshot(2), reasoningByModel: { '["p","m"]': 'low' } })
  await done
  expect(client.error.value).toBe('')
})

it('does not write after failed hydration or replay failed updates automatically', async () => {
  vi.mocked(rpcCall).mockRejectedValue(new Error('offline'))
  const client = createBackendModelPreferences(vi.fn())
  await client.update({ reasoning: { providerId: 'p', modelId: 'm', effort: 'high' } })
  expect(vi.mocked(rpcCall).mock.calls.map(([method]) => method)).toEqual(['model-preferences/read'])
  expect(client.error.value).toContain('unavailable')
  vi.mocked(rpcCall).mockResolvedValueOnce(snapshot(2))
  await client.refresh()
  expect(client.error.value).toBe('')
  expect(rpcCall).toHaveBeenCalledTimes(2)
})

it('ignores disposed reads and allows a new lifecycle to refresh independently', async () => {
  const pending = deferred<ReturnType<typeof snapshot>>()
  vi.mocked(rpcCall).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(snapshot(2))
  const apply = vi.fn(), client = createBackendModelPreferences(apply)
  const old = client.refresh(); client.dispose(); client.resume()
  await client.refresh(); pending.resolve(snapshot(4)); await old
  expect(client.state.value.revision).toBe(2)
  expect(apply).toHaveBeenCalledTimes(1)
})
