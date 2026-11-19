import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readQueueSubmissionReceipts, writeQueueSubmissionReceipt } from './queueSubmissionReceipts'

// Mock the transaction boundary. The browser fixture exercises actual IndexedDB
// serialization across independent documents.
const records = vi.hoisted(() => new Map<string, unknown>())
vi.mock('./browserTransactionalRecords', () => {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    readBrowserRecord: async (name: string, initial: unknown) => structuredClone(records.get(name) ?? initial),
    updateBrowserRecord: (name: string, initial: unknown, change: (current: unknown) => unknown) => {
      const result = tail.then(() => {
        const next = change(structuredClone(records.get(name) ?? initial))
        records.set(name, structuredClone(next))
        return next
      })
      tail = result.catch(() => {})
      return result
    },
  }
})
beforeEach(() => records.clear())
afterEach(() => vi.unstubAllGlobals())

it('serializes concurrent receipts, refuses same-thread reservation and compare-clears exact identities', async () => {
  await Promise.all(Array.from({ length: 20 }, (_, i) => writeQueueSubmissionReceipt(`thread-${i}`, `client-${i}`)))
  expect(Object.keys(await readQueueSubmissionReceipts())).toHaveLength(20)
  await expect(writeQueueSubmissionReceipt('thread-0', 'replacement')).rejects.toThrow('Pending')
  await expect(writeQueueSubmissionReceipt('extra', 'client')).rejects.toThrow('Resolve')
  await writeQueueSubmissionReceipt('thread-0', null, 'wrong-client')
  expect((await readQueueSubmissionReceipts())['thread-0']).toBe('client-0')
  await Promise.all([writeQueueSubmissionReceipt('thread-0', null, 'client-0'), writeQueueSubmissionReceipt('thread-1', null, 'client-1')])
  expect(Object.keys(await readQueueSubmissionReceipts())).toHaveLength(18)
})

it('fails closed on malformed IndexedDB records and unavailable transaction storage', async () => {
  records.set('codex-unbound.codex-web-local.queue-submissions.v1', { thread: 42 })
  await expect(writeQueueSubmissionReceipt('thread', 'client')).rejects.toThrow('unreadable')
  vi.stubGlobal('indexedDB', undefined)
  const { updateBrowserRecord } = await vi.importActual<typeof import('./browserTransactionalRecords')>('./browserTransactionalRecords')
  await expect(updateBrowserRecord('queue', {}, value => value)).rejects.toThrow('Atomic browser')
})
