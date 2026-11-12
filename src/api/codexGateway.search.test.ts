import { afterEach, expect, it, vi } from 'vitest'
import { searchThreads } from './codexGateway'
afterEach(() => vi.unstubAllGlobals())
it('pages native content results beyond 100 and returns navigable thread metadata without history reads', async () => {
  const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
    const { method, params } = JSON.parse(String(init.body))
    expect(method).toBe('thread/search')
    expect(params).toMatchObject({ searchTerm: '日本語 body', archived: false, sortKey: 'updated_at', limit: 100 })
    const offset = params.cursor ? 100 : 0
    return new Response(JSON.stringify({ result: {
      data: Array.from({ length: offset ? 2 : 100 }, (_, i) => ({ thread: { id: String(offset + i), preview: 'body', cwd: '/project', createdAt: 1, updatedAt: 2 } })),
      nextCursor: offset ? null : 'older',
    } }))
  })
  vi.stubGlobal('fetch', fetch)
  const result = await searchThreads(' 日本語 body ')
  expect(result.threadIds).toHaveLength(102)
  expect(result.groups.flatMap(group => group.threads).map(thread => thread.id)).toContain('101')
  expect(fetch).toHaveBeenCalledTimes(2)
})
it('handles empty input and no matches', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ result: { data: [], nextCursor: null } })))
  vi.stubGlobal('fetch', fetch)
  expect(await searchThreads(' ')).toEqual({ threadIds: [], groups: [] })
  expect(fetch).not.toHaveBeenCalled()
  expect(await searchThreads('absent')).toEqual({ threadIds: [], groups: [] })
})
it('rejects unsupported APIs and repeated cursors rather than returning partial success', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'experimentalApi required' } }), { status: 400 })))
  await expect(searchThreads('body')).rejects.toThrow()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: { data: [], nextCursor: 'same' } }))))
  await expect(searchThreads('body')).rejects.toThrow('repeated pagination cursor')
})
