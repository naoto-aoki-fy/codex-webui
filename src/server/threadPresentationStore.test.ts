import { beforeEach, expect, it, vi } from 'vitest'
import { createThreadPresentationStore, PINNED_THREAD_SECTION_ID } from './threadPresentationStore.js'
const state = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('./codexGlobalState.js', () => ({
  readCodexGlobalState: async () => state.value,
  updateCodexGlobalState: async (update: (value: Record<string, unknown>) => void) => update(state.value),
}))
beforeEach(() => { state.value = { unrelated: 42 } })
it('reads native pins across reload without modifying historical state', async () => {
  const rpc = vi.fn(async (method: string, params: any): Promise<any> => method === 'thread/list'
    ? { data: [{ id: params.cursor ? 'b' : 'a' }], nextCursor: params.cursor ? null : 'next' } : {})
  const store = createThreadPresentationStore()
  expect(await store.readPinnedThreadIds(rpc)).toEqual(['a', 'b'])
  expect(state.value).toEqual({ unrelated: 42 })
  expect(rpc).toHaveBeenCalledWith('thread/list', { sectionId: PINNED_THREAD_SECTION_ID, sortKey: 'section_position', limit: 100, cursor: null })
  rpc.mockClear()
  await store.readPinnedThreadIds(rpc)
  expect(rpc.mock.calls.every(([method]) => method === 'thread/list')).toBe(true)
})
it('preserves errors and legacy state on failed native reads', async () => {
  const rpc = vi.fn(async () => { throw new Error('unsupported') })
  await expect(createThreadPresentationStore().readPinnedThreadIds(rpc)).rejects.toThrow('unsupported')
  expect(state.value).toEqual({ unrelated: 42 })
})

it('reports explicit missing native APIs separately from malformed results', async () => {
  await expect(createThreadPresentationStore().readPinnedThreadIds(async () => { throw Object.assign(new Error('missing'), { code: -32601 }) })).rejects.toThrow('Upgrade Codex')
  await expect(createThreadPresentationStore().readPinnedThreadIds(async () => ({}))).rejects.toThrow('Malformed')
})

it.each([false, true])('rejects remaining legacy pins independently of completed Projects=%s', async completed => {
  state.value = { unrelated: 42, 'pinned-thread-ids': ['legacy-pin'], ...(completed ? { 'codexapp-native-project-migrations-v1': { connection: { completed: true } } } : {}) }
  const before = JSON.stringify(state.value)
  const rpc = vi.fn()
  await expect(createThreadPresentationStore().readPinnedThreadIds(rpc)).rejects.toThrow('3f659043')
  expect(JSON.stringify(state.value)).toBe(before)
  expect(rpc).not.toHaveBeenCalled()
})
