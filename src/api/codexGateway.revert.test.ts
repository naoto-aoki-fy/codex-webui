import { afterEach, expect, it, vi } from 'vitest'
import { revertThreadHistory, validateThreadRevert } from './codexGateway'

afterEach(() => vi.unstubAllGlobals())

it.each([
  { historyMode: 'legacy', ephemeral: false },
  { historyMode: 'paginated', ephemeral: true },
  { historyMode: undefined, ephemeral: false },
])('rejects unsupported metadata before reading history: %j', async metadata => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: { thread: metadata } })))
  vi.stubGlobal('fetch', fetch)
  await expect(validateThreadRevert('unsupported', 'target')).rejects.toThrow('persisted paginated')
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({
    method: 'thread/resume', params: { threadId: 'unsupported', excludeTurns: true },
  })
})

it('uses beforeTurnId and accepts an empty revert response without normalizing history', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    result: { thread: { id: 'persisted', turns: [] }, turnsBackwardsCursor: 'retained' },
  })))
  vi.stubGlobal('fetch', fetch)
  await expect(revertThreadHistory('persisted', 'target')).resolves.toBeUndefined()
  expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({
    method: 'thread/revert', params: { threadId: 'persisted', beforeTurnId: 'target' },
  })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('validates an older persisted turn using the opaque cursor without loading message bodies', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ result: { thread: { historyMode: 'paginated', ephemeral: false, status: { type: 'idle' } } } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ result: { data: [{ id: 'recent' }], nextCursor: 'opaque-oldest' } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ result: { data: [{ id: 'target' }], nextCursor: null } })))
  vi.stubGlobal('fetch', fetch)
  await expect(validateThreadRevert('persisted', 'target')).resolves.toBeUndefined()
  expect(fetch.mock.calls.slice(1).map(([, init]) => JSON.parse(init.body))).toEqual([
    { method: 'thread/turns/list', params: { threadId: 'persisted', cursor: null, limit: 100, itemsView: 'notLoaded', sortDirection: 'desc' } },
    { method: 'thread/turns/list', params: { threadId: 'persisted', cursor: 'opaque-oldest', limit: 100, itemsView: 'notLoaded', sortDirection: 'desc' } },
  ])
})
