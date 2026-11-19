import { performance } from 'node:perf_hooks'
import { expect, it } from 'vitest'
import { ProjectFileService } from './appServerFileSystem'

// Reproducible transport fixture, not a WAN benchmark. Two milliseconds of
// synthetic RTT per RPC exposes request overhead without needing credentials.
it('reports before/after large-file transfer measurements', async () => {
  const metadata = { isFile: true, isDirectory: false, isSymlink: false, createdAtMs: 1, modifiedAtMs: 1 }
  const dataBase64 = Buffer.alloc(8 * 1024 * 1024, 'x').toString('base64')
  let requests = 0
  let bytes = 0
  const rpc = async (method: string, params: unknown): Promise<unknown> => {
    requests++
    await new Promise(resolve => setTimeout(resolve, 2))
    let result: unknown
    if (method === 'fs/getMetadata') result = metadata
    else if (method === 'fs/readFile') result = { dataBase64 }
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
  expect(fileBefore.requests).toBe(10)
  expect(fileAfter.requests).toBe(6)
  expect(fileAfter.upstreamResponseBytes).toBeLessThan(fileBefore.upstreamResponseBytes / 4)
  console.log(JSON.stringify({ fixture: '8MiB file x5; synthetic RTT2ms', fileBefore, fileAfter, fileCache: files.getCacheStats() }, null, 2))
})
