import { afterEach, expect, it, vi } from 'vitest'
import { getAvailableModelIds } from './codexGateway'

const response = (result: unknown) => new Response(JSON.stringify({ result }))
afterEach(() => vi.unstubAllGlobals())

it.each([
  ['self repeat', [' next ', 'next'], [{ includeHidden: true }, { includeHidden: true, cursor: 'next' }]],
  ['cycle', ['a', 'b', 'a'], [{ includeHidden: true }, { includeHidden: true, cursor: 'a' }, { includeHidden: true, cursor: 'b' }]],
  ['blank', ['  '], [{ includeHidden: true }]],
] as const)('terminates %s cursors while retaining page order and duplicate records', async (_name, cursors, params) => {
  const calls: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    if (body.method === 'modelProvider/list' || body.method === 'config/read') return new Response('Method not found', { status: 400 })
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
  vi.stubGlobal('fetch', vi.fn((url, init) => ['modelProvider/list', 'config/read'].includes(JSON.parse(String(init.body)).method)
    ? Promise.resolve(new Response('Method not found', { status: 400 })) : fetch(url, init)))
  await expect(getAvailableModelIds()).resolves.toEqual({ ids: [], models: [] })
  await expect(getAvailableModelIds()).resolves.toEqual({ ids: ['fresh'], models: [{ id: 'fresh' }] })
  expect(fetch.mock.calls.map(([, init]) => JSON.parse(init.body).params)).toEqual([{ includeHidden: true }, { includeHidden: true, cursor: 'next' }, { includeHidden: true }])
})

it('coalesces overlapping catalog requests and retries after completion', async () => {
  let resolve!: (response: Response) => void
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>((yes) => { resolve = yes }))
    .mockResolvedValueOnce(response({ data: [{ id: 'new' }] }))
  vi.stubGlobal('fetch', vi.fn((url, init) => ['modelProvider/list', 'config/read'].includes(JSON.parse(String(init.body)).method)
    ? Promise.resolve(new Response('Method not found', { status: 400 })) : fetch(url, init)))
  const older = getAvailableModelIds()
  const newer = getAvailableModelIds()
  expect(newer).toBe(older)
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  resolve(response({ data: [{ id: 'shared' }] }))
  await expect(older).resolves.toEqual({ ids: ['shared'], models: [{ id: 'shared' }] })
  await expect(getAvailableModelIds()).resolves.toEqual({ ids: ['new'], models: [{ id: 'new' }] })
})
