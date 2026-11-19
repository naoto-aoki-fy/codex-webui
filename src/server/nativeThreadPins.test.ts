import { expect, it, vi } from 'vitest'
import { readPinnedThreadIds, PINNED_THREAD_SECTION_ID } from './nativeThreadPins'

it('reads native section order through every cursor', async () => {
  const rpc = vi.fn(async (_method: string, params: unknown) => {
    const { cursor } = params as { cursor: string | null }
    return { data: [{ id: cursor ? 'b' : 'a' }], nextCursor: cursor ? null : 'next' }
  })
  expect(await readPinnedThreadIds(rpc)).toEqual(['a', 'b'])
  const params = { sectionId: PINNED_THREAD_SECTION_ID, sortKey: 'section_position', limit: 100 }
  expect(rpc.mock.calls).toEqual([
    ['thread/list', { ...params, cursor: null }],
    ['thread/list', { ...params, cursor: 'next' }],
  ])
})

it('distinguishes failed native reads, missing methods, and invalid pages', async () => {
  await expect(readPinnedThreadIds(async () => { throw new Error('Permission denied') })).rejects.toThrow('Permission denied')
  await expect(readPinnedThreadIds(async () => { throw Object.assign(new Error('missing'), { code: -32601 }) })).rejects.toThrow('Upgrade Codex')
  await expect(readPinnedThreadIds(async () => ({}))).rejects.toThrow('Malformed')
})
