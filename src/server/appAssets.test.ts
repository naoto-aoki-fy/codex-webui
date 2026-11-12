import { mkdir, writeFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { expect, it, vi } from 'vitest'
import { inlineAssetPath, inlineMediaDirectory } from './appAssets'
import { createLocalFileMiddleware } from './localFileHttp'
import { ProjectFileService } from './appServerFileSystem'

it('serves only explicit Web-owned assets and never falls back for project paths', async () => {
  const id = `asset-${crypto.randomUUID()}.svg`
  const path = inlineAssetPath(id)!
  await mkdir(inlineMediaDirectory(), { recursive: true })
  await writeFile(path, '<svg/>')
  const rpc = vi.fn().mockRejectedValue(new Error('No such file or directory'))
  const handler = createLocalFileMiddleware(new ProjectFileService({ rpc }))
  const server = createServer((req, res) => handler(req, res, () => res.end()))
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const response = await fetch(base + '/codex-app-asset?id=' + id)
    expect(response.headers.get('content-type')).toContain('image/svg+xml')
    expect(await response.text()).toBe('<svg/>')
    expect(rpc).not.toHaveBeenCalled()
    expect((await fetch(base + '/codex-app-asset?id=..%2Fsecret')).status).toBe(400)
    expect((await fetch(base + '/codex-local-image?path=' + encodeURIComponent(path))).status).toBe(404)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('fs/getMetadata', { path })
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(path)
  }
})
