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
