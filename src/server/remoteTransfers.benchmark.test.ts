import { performance } from 'node:perf_hooks'
import { expect, it } from 'vitest'
import { ProjectFileService } from './appServerFileSystem'
import { RemoteHistoryPager } from './remoteHistoryPager'

// Reproducible transport fixture, not a WAN benchmark. Two milliseconds of
// synthetic RTT per RPC exposes request overhead without needing credentials.
it('reports before/after large-file and long-history transfer measurements', async () => {
  const metadata = { isFile: true, isDirectory: false, isSymlink: false, createdAtMs: 1, modifiedAtMs: 1 }
  const dataBase64 = Buffer.alloc(8 * 1024 * 1024, 'x').toString('base64')
  const turns = Array.from({ length: 1000 }, (_, i) => ({ id: `turn-${i}`, status: 'completed', items: [{ type: 'agentMessage', text: 'x'.repeat(4096) }] }))
  let requests = 0
  let bytes = 0
  const rpc = async (method: string, params: unknown): Promise<unknown> => {
    requests++
    await new Promise(resolve => setTimeout(resolve, 2))
    const p = params as Record<string, any>
    let result: unknown
    if (method === 'fs/getMetadata') result = metadata
    else if (method === 'fs/readFile') result = { dataBase64 }
    else if (method === 'thread/read') result = { thread: { id: 'thread', turns: p.includeTurns ? turns : [] } }
    else {
      const sorted = p.sortDirection === 'desc' ? [...turns].reverse() : turns
      const offset = Number(p.cursor ?? 0)
      result = { data: sorted.slice(offset, offset + p.limit).map(turn => p.itemsView === 'notLoaded' ? { ...turn, items: [], itemsView: 'notLoaded' } : turn), nextCursor: offset + p.limit < turns.length ? String(offset + p.limit) : null }
    }
    bytes += Buffer.byteLength(JSON.stringify(result))
    return result
  }
  const run = async (action: () => Promise<void>) => {
    requests = 0; bytes = 0
    const started = performance.now()
    await action()
    return { requests, upstreamResponseBytes: bytes, elapsedMs: Math.round((performance.now() - started) * 10) / 10 }
  }
  const files = new ProjectFileService({ rpc })
  const fileBefore = await run(async () => {
    for (let i = 0; i < 5; i++) { await files.getMetadata('/remote/large'); await files.readFile('/remote/large') }
  })
  const fileAfter = await run(async () => {
    for (let i = 0; i < 5; i++) { const meta = await files.getMetadata('/remote/large'); await files.readFile('/remote/large', meta) }
  })
  const historyBefore = await run(async () => {
    for (let i = 0; i < 4; i++) await rpc('thread/read', { threadId: 'thread', includeTurns: true })
  })
  const pager = new RemoteHistoryPager({ rpc, readThreadForTurnPage: () => rpc('thread/read', { includeTurns: true }), getConnectionGeneration: () => 1 })
  const historyAfter = await run(async () => {
    await pager.read('thread')
    for (const before of ['turn-990', 'turn-980', 'turn-970']) await pager.read('thread', before, 10)
  })
  expect(fileBefore.requests).toBe(10)
  expect(fileAfter.requests).toBe(6)
  expect(fileAfter.upstreamResponseBytes).toBeLessThan(fileBefore.upstreamResponseBytes / 4)
  expect(historyAfter.upstreamResponseBytes).toBeLessThan(historyBefore.upstreamResponseBytes / 20)
  console.log(JSON.stringify({ fixture: '8MiB file x5; 1000 turns x4KiB, recent +3 older pages; synthetic RTT2ms', fileBefore, fileAfter, fileCache: files.getCacheStats(), historyBefore, historyAfter, historyCache: pager.getCacheStats() }, null, 2))
})
