import { describe, it, expect, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { createArchivedThreads } from './archivedThreads'
import type { UiThread } from '../types/codex'
const row = (id: string) => ({ id, title: id, projectId: 'native-project' }) as UiThread
const page = (ids: string[], nextCursor: string | null = null) => ({ groups: [{ projectName: 'native-project', threads: ids.map(row) }], nextCursor })
describe('on-demand archives', () => {
  it('does no startup work, paginates, deduplicates and restores only acknowledged rows', async () => {
    const read = vi.fn().mockResolvedValueOnce(page(['a'], 'next')).mockResolvedValueOnce(page(['a', 'b']))
    const restore = vi.fn().mockRejectedValueOnce(new Error('unsupported operation')).mockResolvedValueOnce(undefined)
    const state = createArchivedThreads(ref(0), restore, read)
    expect(read).not.toHaveBeenCalled()
    await state.load(); await state.load(true)
    expect(read.mock.calls).toEqual([[null], ['next']])
    await state.restoreRow('a')
    expect(state.rows.value.map(row => row.id)).toEqual(['a', 'b'])
    expect(state.error.value).toContain('unsupported')
    await state.restoreRow('a')
    expect(state.rows.value.map(row => row.id)).toEqual(['b'])
  })
  it('handles empty, errors and stale connection results', async () => {
    const epoch = ref(0)
    const read = vi.fn().mockResolvedValueOnce(page([])).mockRejectedValueOnce(new Error('permission denied'))
    const state = createArchivedThreads(epoch, vi.fn(), read)
    await state.load(); expect(state.loaded.value).toBe(true); expect(state.rows.value).toEqual([])
    await state.load(); expect(state.error.value).toBe('permission denied')
    let resolve!: (v: ReturnType<typeof page>) => void
    read.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const pending = state.load(); epoch.value++; await nextTick(); resolve(page(['stale'])); await pending
    expect(state.loaded.value).toBe(false); expect(state.rows.value).toEqual([])
  })
})
