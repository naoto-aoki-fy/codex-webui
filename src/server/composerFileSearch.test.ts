import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { expect, it, vi } from 'vitest'
import { createCodexBridgeMiddleware } from './codexAppServerBridge.js'
import { ProjectFileService } from './appServerFileSystem.js'
vi.mock('node:child_process', () => ({ spawn: () => { throw new Error('Unexpected local command') }, spawnSync: () => { throw new Error('Unexpected local command') } }))
it.each([false, true])('searches remote-only files without local rg, unsupported=%s', async unsupported => {
  const scope = globalThis as any
  const previous = scope.__codexRemoteSharedBridge__
  const rpc = vi.fn(async (method: string) => {
    if (method === 'fs/getMetadata') return { isDirectory: true, isFile: false }
    if (method === 'fuzzyFileSearch') {
      if (unsupported) throw Object.assign(new Error('fuzzyFileSearch unavailable on connected server'), { code: -32601 })
      return { files: [{ path: 'remote-only.txt' }] }
    }
    throw new Error('Unexpected RPC ' + method)
  })
  scope.__codexRemoteSharedBridge__ = { version: 'external-websocket-files-v2', appServer: { rpc }, files: new ProjectFileService({ rpc }), methodCatalog: {} }
  const middleware = createCodexBridgeMiddleware()
  try {
    const req = Object.assign(Readable.from([JSON.stringify({ cwd: '/only-on-B', query: 'remote' })]), { method: 'POST', url: '/codex-api/composer-file-search', headers: {} }) as unknown as IncomingMessage
    let body = ''
    const res = Object.assign(new EventEmitter(), { statusCode: 200, setHeader: vi.fn(), write: vi.fn(), end: (chunk: unknown) => { body += chunk ?? '' } }) as unknown as ServerResponse
    await middleware(req, res, vi.fn())
    expect(res.statusCode).toBe(unsupported ? 500 : 200)
    expect(JSON.parse(body)).toEqual(unsupported ? { error: 'fuzzyFileSearch unavailable on connected server' } : { data: [{ path: 'remote-only.txt' }] })
    expect(rpc).toHaveBeenCalledWith('fuzzyFileSearch', { roots: ['/only-on-B'], query: 'remote', cancellationToken: null })
  } finally { scope.__codexRemoteSharedBridge__ = previous }
})
