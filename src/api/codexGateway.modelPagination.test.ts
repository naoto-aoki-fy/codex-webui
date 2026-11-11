import { afterEach, expect, it, vi } from 'vitest'
import { getAvailableModelIds } from './codexGateway'

const response = (result: unknown) => new Response(JSON.stringify({ result }))
afterEach(() => vi.unstubAllGlobals())

it.each([
  ['self repeat', [' next ', 'next'], [{}, { cursor: 'next' }]],
  ['cycle', ['a', 'b', 'a'], [{}, { cursor: 'a' }, { cursor: 'b' }]],
  ['blank', ['  '], [{}]],
] as const)('terminates %s cursors while retaining page order and duplicate records', async (_name, cursors, params) => {
  const calls: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    expect(body.method).toBe('model/list')
    calls.push(body.params)
    if (calls.length > cursors.length) throw new Error('unexpected extra page')
    return response({ data: [null, {}, { id: ' same ', page: calls.length }, { model: ' alias ' }], nextCursor: cursors[calls.length - 1] })
  }))
  const result = await getAvailableModelIds()
  expect(calls).toEqual(params)
  expect(result.ids).toEqual(['same', 'alias'])
  expect(result.models).toEqual(cursors.flatMap((_cursor, index) => [{ id: ' same ', page: index + 1 }, { model: ' alias ' }]))
})

it('discards partial results after later-page failure and starts retry from the first page', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(response({ data: [{ id: 'partial' }], nextCursor: 'next' }))
    .mockRejectedValueOnce(new Error('page unavailable'))
    .mockResolvedValueOnce(response({ data: [{ id: 'fresh' }] }))
  vi.stubGlobal('fetch', fetch)
  await expect(getAvailableModelIds()).resolves.toEqual({ ids: [], models: [] })
  await expect(getAvailableModelIds()).resolves.toEqual({ ids: ['fresh'], models: [{ id: 'fresh' }] })
  expect(fetch.mock.calls.map(([, init]) => JSON.parse(init.body).params)).toEqual([{}, { cursor: 'next' }, {}])
})

it('keeps overlapping fetches independent when the newer fetch succeeds before the older fails', async () => {
  let reject!: (error: Error) => void
  const fetch = vi.fn()
    .mockImplementationOnce(() => new Promise<Response>((_resolve, no) => { reject = no }))
    .mockResolvedValueOnce(response({ data: [{ id: 'new' }] }))
    .mockResolvedValueOnce(response({ data: [{ id: 'retry' }] }))
  vi.stubGlobal('fetch', fetch)
  const older = getAvailableModelIds()
  const newer = getAvailableModelIds()
  await expect(newer).resolves.toEqual({ ids: ['new'], models: [{ id: 'new' }] })
  reject(new Error('older failed'))
  await expect(older).resolves.toEqual({ ids: [], models: [] })
  await expect(getAvailableModelIds()).resolves.toEqual({ ids: ['retry'], models: [{ id: 'retry' }] })
  expect(fetch).toHaveBeenCalledTimes(3)
})
