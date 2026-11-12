import { afterEach, expect, it, vi } from 'vitest'
import { markNativeThreadRead } from './codexGateway'
afterEach(() => vi.unstubAllGlobals())
it('marks the observed revision read using the native tagged operation', async () => {
  const readState = { firstUnread: null, revision: 'next' }
  const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
    expect(JSON.parse(String(init.body))).toMatchObject({ method: 'thread/readState/update', params: {
      threadId: 't', operation: { type: 'read' }, expectedRevision: 'seen',
    } })
    return new Response(JSON.stringify({ result: { readState } }))
  })
  vi.stubGlobal('fetch', fetch)
  expect(await markNativeThreadRead('t', 'seen')).toEqual(readState)
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('does not retry a conflicting revision or silently write browser state', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'revision conflict' } }), { status: 409 }))
  vi.stubGlobal('fetch', fetch)
  await expect(markNativeThreadRead('t', 'old')).rejects.toThrow()
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('preserves native receipts through list normalization for both direct and indexed pages', async () => {
  const { normalizeThreadGroupsV2 } = await import('./normalizers/v2')
  const receipt = { firstUnread: { type: 'threadStart' as const }, revision: 'seen' }
  const thread = { id: 't', cwd: '/project', createdAt: 1, updatedAt: 2, preview: 'hello' }
  for (const page of [
    { data: [thread], readStates: { t: receipt }, nextCursor: null },
    { data: [{ ...thread, readState: receipt }], nextCursor: null },
  ]) {
    const groups = normalizeThreadGroupsV2(page as any)
    expect(groups[0]?.threads[0]?.nativeReadState).toEqual(receipt)
  }
  expect(normalizeThreadGroupsV2({ data: [thread], nextCursor: null } as any)[0]?.threads[0]?.nativeReadState).toBeUndefined()
})
