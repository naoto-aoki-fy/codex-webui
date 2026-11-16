import { afterEach, expect, it, vi } from 'vitest'
import { readQueueSubmissionReceipts, writeQueueSubmissionReceipt } from './queueSubmissionReceipts'


// These controller tests mock the atomic-storage boundary; the browser fixture
// exercises actual IndexedDB serialization across independent documents.
vi.mock('./browserStorageLock', () => {
 let tail: Promise<unknown> = Promise.resolve()
 return { withBrowserStorageLock: (_name: string, action: () => unknown) => {
  const result = tail.then(action); tail = result.catch(() => {}); return result
 } }
})
afterEach(() => vi.unstubAllGlobals())
function setup() {
  const data = new Map<string, string>()
  let tail: Promise<unknown> = Promise.resolve()
  vi.stubGlobal('window', { localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) } })
  vi.stubGlobal('navigator', { locks: { request: (_name: string, action: () => unknown) => {
    const result = tail.then(action); tail = result.catch(() => {}); return result
  } } })
  return data
}
it('serializes concurrent receipts, refuses same-thread reservation and compare-clears exact identities', async () => {
  setup()
  await Promise.all(Array.from({ length: 20 }, (_, i) => writeQueueSubmissionReceipt(`thread-${i}`, `client-${i}`)))
  expect(Object.keys(readQueueSubmissionReceipts())).toHaveLength(20)
  await expect(writeQueueSubmissionReceipt('thread-0', 'replacement')).rejects.toThrow('Pending')
  await expect(writeQueueSubmissionReceipt('extra', 'client')).rejects.toThrow('Resolve')
  await writeQueueSubmissionReceipt('thread-0', null, 'wrong-client')
  expect(readQueueSubmissionReceipts()['thread-0']).toBe('client-0')
  await Promise.all([writeQueueSubmissionReceipt('thread-0', null, 'client-0'), writeQueueSubmissionReceipt('thread-1', null, 'client-1')])
  expect(Object.keys(readQueueSubmissionReceipts())).toHaveLength(18)
})
it('fails closed on malformed legacy records and unavailable locking', async () => {
  const data = setup()
  data.set('codex-web-local.queue-submissions.v1', '{')
  await expect(writeQueueSubmissionReceipt('thread', 'client')).rejects.toThrow()
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('indexedDB', undefined)
  const { withBrowserStorageLock } = await vi.importActual<typeof import('./browserStorageLock')>('./browserStorageLock')
  await expect(withBrowserStorageLock('queue', () => {})).rejects.toThrow('Atomic browser')
})
