import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { useSidebarMessageSearch } from '../composables/useSidebarMessageSearch'

let scope: ReturnType<typeof effectScope>
beforeEach(() => {
  scope = effectScope()
  vi.useFakeTimers()
})
afterEach(() => {
  scope.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function start(query: string) {
  const term = ref(query)
  return { term, ...scope.run(() => useSidebarMessageSearch(term))! }
}

function response(ids: string[], nextCursor: string | null) {
  return new Response(JSON.stringify({ result: {
    data: ids.map(id => ({ thread: { id, preview: 'body', cwd: '/project', createdAt: 1, updatedAt: 2 } })),
    nextCursor,
  } }))
}

it('debounces and publishes pages in native order with no history reads', async () => {
  let releaseOlder!: (result: Response) => void
  const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
    const { method, params } = JSON.parse(String(init.body))
    expect(method).toBe('thread/search')
    expect(params).toMatchObject({ searchTerm: '日本語 body', archived: false, sortKey: 'updated_at', sortDirection: 'desc', limit: 100 })
    if (params.cursor === 'older') return new Promise<Response>(resolve => { releaseOlder = resolve })
    return response(Array.from({ length: 100 }, (_, i) => String(i)), 'older')
  })
  vi.stubGlobal('fetch', fetch)
  const search = start('日本語 body')
  await vi.advanceTimersByTimeAsync(199)
  expect(fetch).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(search.threads.value).toHaveLength(100)
  expect(search.pending.value).toBe(true)
  releaseOlder(response(['99', '100', '101'], null))
  await vi.advanceTimersByTimeAsync(0)
  expect(search.threads.value).toHaveLength(102)
  expect(search.threads.value[101]).toMatchObject({ id: '101', cwd: '/project' })
  expect(search.pending.value).toBe(false)
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('discards stale responses and stops their cursors even when a transport ignores abort', async () => {
  let releaseStale!: (result: Response) => void
  const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
    const { params } = JSON.parse(String(init.body))
    if (params.searchTerm === 'old') return new Promise<Response>(resolve => { releaseStale = resolve })
    return response(['current'], null)
  })
  vi.stubGlobal('fetch', fetch)
  const search = start('old')
  await vi.advanceTimersByTimeAsync(200)
  search.term.value = ''
  expect(fetch.mock.calls[0]?.[1].signal?.aborted).toBe(true)
  search.term.value = 'new'
  await vi.advanceTimersByTimeAsync(200)
  releaseStale(response(['stale'], 'stale-cursor'))
  await vi.advanceTimersByTimeAsync(0)
  expect(search.threads.value.map(thread => thread.id)).toEqual(['current'])
  expect(search.error.value).toBe('')
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('shows unsupported servers and later pagination failures while preserving retrieved rows', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Method not found', rpcCode: -32601 }), { status: 502 }))
    .mockResolvedValueOnce(response(['first'], 'same'))
    .mockResolvedValueOnce(response(['second'], 'same'))
    .mockResolvedValueOnce(response([], null))
  vi.stubGlobal('fetch', fetch)
  const search = start('')
  await vi.advanceTimersByTimeAsync(200)
  expect(fetch).not.toHaveBeenCalled()
  search.term.value = 'unsupported'
  await vi.advanceTimersByTimeAsync(200)
  expect(search.error.value).toContain('experimentalApi')
  search.term.value = 'repeat'
  await vi.advanceTimersByTimeAsync(200)
  expect(search.error.value).toContain('repeated pagination cursor')
  expect(search.threads.value.map(thread => thread.id)).toEqual(['first', 'second'])
  search.term.value = 'absent'
  await vi.advanceTimersByTimeAsync(200)
  expect(search.threads.value).toEqual([])
  expect(search.error.value).toBe('')
  expect(search.pending.value).toBe(false)
  expect(fetch).toHaveBeenCalledTimes(4)
})
