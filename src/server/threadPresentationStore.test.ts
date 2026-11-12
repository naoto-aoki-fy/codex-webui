import { beforeEach, expect, it, vi } from 'vitest'
import { createThreadPresentationStore, PINNED_THREAD_SECTION_ID } from './threadPresentationStore.js'
const state = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('./codexGlobalState.js', () => ({
  readCodexGlobalState: async () => state.value,
  updateCodexGlobalState: async (update: (value: Record<string, unknown>) => void) => update(state.value),
}))
beforeEach(() => { state.value = { unrelated: 42, 'pinned-thread-ids': ['a', 'b'] } })
it('migrates once, preserving unrelated state, and reads native pagination', async () => {
  const rpc = vi.fn(async (method: string, params: any): Promise<any> => method === 'thread/list'
    ? { data: [{ id: params.cursor ? 'b' : 'a' }], nextCursor: params.cursor ? null : 'next' } : {})
  const store = createThreadPresentationStore()
  expect(await store.readPinnedThreadIds(rpc)).toEqual(['a', 'b'])
  expect(state.value).toEqual({ unrelated: 42 })
  expect(rpc).toHaveBeenCalledWith('thread/section/move', { threadId: 'a', sectionId: PINNED_THREAD_SECTION_ID })
  rpc.mockClear()
  await store.readPinnedThreadIds(rpc)
  expect(rpc.mock.calls.every(([method]) => method === 'thread/list')).toBe(true)
})
it('retains legacy state on unsupported or failed migration', async () => {
  const rpc = vi.fn(async () => { throw new Error('unsupported') })
  await expect(createThreadPresentationStore().readPinnedThreadIds(rpc)).rejects.toThrow('unsupported')
  expect(state.value['pinned-thread-ids']).toEqual(['a', 'b'])
})
