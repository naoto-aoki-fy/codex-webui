import { expect, it, vi } from 'vitest'
import { callRpcWithArchiveRecovery } from './codexAppServerBridge'

it('adapts native search workspace metadata without changing cursors, snippets or scope', async () => {
  const rpc = vi.fn(async () => ({
    data: [{ thread: { id: 'older', environments: [{ cwd: '/tmp' }] }, snippet: '日本語 body' }],
    nextCursor: 'opaque', backwardsCursor: 'backwards',
  }))
  const params = { searchTerm: '日本語', archived: false, cursor: 'previous' }
  expect(await callRpcWithArchiveRecovery({ rpc }, 'thread/search', params)).toEqual({
    data: [{ thread: { id: 'older', environments: [{ cwd: '/tmp' }], cwd: '/tmp' }, snippet: '日本語 body' }],
    nextCursor: 'opaque', backwardsCursor: 'backwards',
  })
  expect(rpc).toHaveBeenCalledExactlyOnceWith('thread/search', params)
})
