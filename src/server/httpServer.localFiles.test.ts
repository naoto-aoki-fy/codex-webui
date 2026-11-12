import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createHttpServer, type Server } from 'node:http'
import { once } from 'node:events'
import { expect, it, vi } from 'vitest'

vi.mock('./codexAppServerBridge', () => ({
  createCodexBridgeMiddleware: () => Object.assign(
    (_req: unknown, _res: unknown, next: () => void) => next(),
    { dispose() {}, subscribeNotifications: () => () => {} },
  ),
}))

import { createServer } from './httpServer'
import { createLocalFileMiddleware } from './localFileHttp'
import type { IncomingMessage, ServerResponse } from 'node:http'

it('preserves file and image access and workspace selection without directory browsing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'local-file-retirement-'))
  const textPath = join(root, 'example.txt')
  const imagePath = join(root, 'example.svg')
  const text = 'unique-local-file-content'
  const image = '<svg xmlns="http://www.w3.org/2000/svg"/>'
  await mkdir(join(root, 'subdirectory'))
  await symlink(root, join(root, 'directory-link'))
  await writeFile(textPath, text)
  await writeFile(imagePath, image)
  await writeFile(join(root, 'binary.bin'), Buffer.from([0, 1, 2]))
  await writeFile(join(root, '.hidden.txt'), text)
  await writeFile(join(root, 'literal%20name.txt'), text)
  const production = createServer()
  // Load the real dev configuration so both route implementations are exercised.
  const { createServer: createViteServer } = await import('vite')
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } })
  const servers: Server[] = []
  try {
    for (const handler of [production.app, vite.middlewares]) {
      const server = createHttpServer(handler)
      servers.push(server)
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address() as { port: number }
      const base = 'http://127.0.0.1:' + address.port
      const browse = '/codex-local-browse' + encodeURI(textPath)
      expect(await (await fetch(base + browse)).text()).toBe(text)
      const listing = await fetch(base + '/codex-local-directories?path=' + encodeURIComponent(root))
      expect(listing.status).toBe(200)
      const folders = (await listing.json() as { data: { entries: { name: string; path: string }[] } }).data.entries
      expect(folders).toContainEqual({ name: 'subdirectory', path: join(root, 'subdirectory') })
      expect(folders.some((entry: { name: string }) => entry.name === 'example.txt')).toBe(false)
      for (const directory of [root, root + '/', join(root, 'subdirectory'), join(root, 'directory-link')]) {
        for (const method of ['GET', 'HEAD']) {
          const response = await fetch(base + '/codex-local-browse' + encodeURI(directory), { method })
          expect(response.status).toBe(404)
          expect(response.headers.get('content-type')).toContain('application/json')
          expect(await response.text()).toBe(method === 'HEAD' ? '' : JSON.stringify({ error: 'File not found.' }))
        }
      }
      const renderedImage = await fetch(base + '/codex-local-image?path=' + encodeURIComponent(imagePath))
      expect(renderedImage.headers.get('content-type')).toContain('image/svg+xml')
      expect(await renderedImage.text()).toBe(image)
      const edit = base + '/codex-local-edit' + encodeURI(textPath)
      for (const method of ['GET', 'HEAD', 'PUT']) {
        const retired = await fetch(edit, { method, ...(method === 'PUT' ? { body: 'must not write' } : {}) })
        expect(await retired.text()).not.toContain('ace.edit')
        expect(retired.headers.get('content-type') ?? '').not.toContain('application/json')
        if (method === 'PUT') expect([404, 503]).toContain(retired.status)
        expect(await readFile(textPath, 'utf8')).toBe(text)
      }
      // Run the same contract against the real development and production mounts.
      for (const route of [
        '/codex-local-browse' + encodeURI(join(root, 'missing.txt')),
        '/codex-local-image?path=' + encodeURIComponent(join(root, 'missing.png')),
        '/codex-local-directories?path=' + encodeURIComponent(join(root, 'missing')),
      ]) expect((await fetch(base + route)).status).toBe(404)
      for (const path of ['relative.png', root + '/..' + '/example.svg', root + '/bad\0.png']) {
        const response = await fetch(base + '/codex-local-image?path=' + encodeURIComponent(path))
        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ error: 'Expected absolute local file path.' })
      }
      expect((await fetch(base + '/codex-local-browse/%ZZ')).status).toBe(400)
      expect((await fetch(base + '/codex-local-browse' + encodeURI(root) + '/%2e%2e%2fexample.txt')).status).toBe(400)
      expect((await fetch(base + '/codex-local-directories?path=' + encodeURIComponent(textPath))).status).toBe(400)
      const head = await fetch(base + browse, { method: 'HEAD' })
      expect(head.status).toBe(200)
      expect(head.headers.get('content-type')).toContain('text/plain')
      expect(await head.text()).toBe('')
      const range = await fetch(base + browse, { headers: { Range: 'bytes=0-5' } })
      expect(range.status).toBe(206)
      expect(await range.text()).toBe(text.slice(0, 6))
      expect(await (await fetch(base + '/codex-local-browse' + encodeURI(join(root, '.hidden.txt')))).text()).toBe(text)
      expect(await (await fetch(base + '/codex-local-browse' + encodeURI(join(root, 'literal%20name.txt')))).text()).toBe(text)
      for (const method of ['GET', 'HEAD']) {
        const retired = await fetch(base + '/codex-local-file?path=' + encodeURIComponent(textPath), { method })
        expect(retired.headers.get('content-disposition')).toBeNull()
        expect(await retired.text()).not.toBe(text)
      }
    }
  } finally {
    for (const server of servers) {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    await vite.close()
    production.dispose()
    await rm(root, { recursive: true, force: true })
  }
}, 30000)

it('passes retired editor requests through without touching request or response bodies', () => {
  const middleware = createLocalFileMiddleware()
  for (const method of ['GET', 'HEAD', 'PUT']) {
    const next = vi.fn()
    middleware({ method, url: '/codex-local-edit/tmp/example.txt' } as IncomingMessage, {} as ServerResponse, next)
    expect(next).toHaveBeenCalledExactlyOnceWith()
  }
})
