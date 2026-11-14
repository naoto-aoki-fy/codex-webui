import { afterEach, expect, it, vi } from 'vitest'
import { getThreadDetailForRevert, startThread } from './codexGateway'
afterEach(() => vi.unstubAllGlobals())
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
it('retries a materialization/index race once using only read requests against the same ID', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ error: 'History changed while loading. Refresh the thread.' }, 502))
    .mockResolvedValueOnce(response({ result: { thread: { id: 'fork', turns: [{ id: 'kept', status: 'completed', items: [{ type: 'agentMessage', id: 'answer', text: 'native content' }] }] } } }))
  vi.stubGlobal('fetch', fetch)
  const detail = await getThreadDetailForRevert('fork')
  expect(detail.messages[0]?.text).toBe('native content')
  expect(fetch.mock.calls.map(([, init]) => JSON.parse(init.body))).toEqual([
    { method: 'thread/read', params: { threadId: 'fork', includeTurns: true } },
    { method: 'thread/read', params: { threadId: 'fork', includeTurns: true } },
  ])
})
it.each(['Permission denied', 'History changed while loading. Refresh the thread.'])('bounds retries and preserves errors for %s', async error => {
  const fetch = vi.fn().mockImplementation(async () => response({ error }, 502)); vi.stubGlobal('fetch', fetch)
  await expect(getThreadDetailForRevert('fork')).rejects.toThrow(error)
  expect(fetch).toHaveBeenCalledTimes(error.startsWith('History changed') ? 2 : 1)
})
it('submits explicit native identity independently of cwd and preserves it in the returned thread', async () => {
  const fetch = vi.fn().mockResolvedValue(response({ result: { thread: { id: 'new', projectId: 'native-project' }, model: 'model', modelProvider: 'provider' } }))
  vi.stubGlobal('fetch', fetch)
  expect(await startThread('/execution/path', 'model', 'provider', 'native-project')).toMatchObject({ threadId: 'new', projectId: 'native-project' })
  expect(JSON.parse(fetch.mock.calls[0]![1].body).params).toMatchObject({ projectId: 'native-project', cwd: '/execution/path' })
})
