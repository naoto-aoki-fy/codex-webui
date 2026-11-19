import { access } from 'node:fs/promises'
import { ProjectFileService } from './appServerFileSystem'
import { join } from 'node:path'
import { createServer as createHttpServer, type Server } from 'node:http'
import { once } from 'node:events'
import { expect, it, vi } from 'vitest'

const remote = vi.hoisted(() => ({ files: new Map<string, Buffer>(), directories: new Set<string>(), calls: [] as string[] }))
const remoteRpc = async (method: string, params: unknown) => {
  const { path } = params as { path: string }
  remote.calls.push(method)
  if (path.endsWith('/unsupported')) throw Object.assign(new Error('Method not found'), { code: -32601, data: { method } })
  if (path.endsWith('/offline')) throw new Error('Cannot connect to app-server: no such file or directory')
  if (path.endsWith('/denied')) throw Object.assign(new Error('Permission denied'), { code: -32600 })
  if (!remote.files.has(path) && !remote.directories.has(path)) throw new Error('No such file or directory')
  if (method === 'fs/getMetadata') return { isFile: remote.files.has(path), isDirectory: remote.directories.has(path), isSymlink: false, createdAtMs: 0, modifiedAtMs: 1000 }
  if (method === 'fs/readFile') return { dataBase64: remote.files.get(path)!.toString('base64') }
  if (method === 'fs/readDirectory') return { entries: [...remote.directories, ...remote.files.keys()].filter(p => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/')).map(p => ({ fileName: p.slice(path.length + 1), isDirectory: remote.directories.has(p), isFile: remote.files.has(p) })) }
  throw new Error('Unexpected RPC ' + method)
}

import { createServer } from './httpServer'
import { createLocalFileMiddleware } from './localFileHttp'
import type { IncomingMessage, ServerResponse } from 'node:http'

it('preserves file and image access and workspace selection without directory browsing', async () => {
  const root = '/remote-only-project-' + crypto.randomUUID()
  await expect(access(root)).rejects.toThrow()
  remote.files.clear()
  remote.directories.clear()
  remote.directories.add(root)
  const writeFile = async (path: string, bytes: string | Buffer) => { remote.files.set(path, Buffer.from(bytes)) }
  const mkdir = async (path: string) => { remote.directories.add(path) }
  const readFile = async (path: string, _encoding: string) => remote.files.get(path)!.toString()
  const textPath = join(root, 'example.txt')
  const imagePath = join(root, 'example.svg')
  const text = 'unique-local-file-content'
  const image = '<svg xmlns="http://www.w3.org/2000/svg"/>'
  await mkdir(join(root, 'subdirectory'))
  remote.directories.add(join(root, 'directory-link'))
  await writeFile(textPath, text)
  await writeFile(imagePath, image)
  await writeFile(join(root, 'binary.bin'), Buffer.from([0, 1, 2]))
  await writeFile(join(root, '.hidden.txt'), text)
  await writeFile(join(root, 'literal%20name.txt'), text)
  await writeFile('C:/remote/windows.txt', text)
  const files = new ProjectFileService({ rpc: remoteRpc })
  ;(globalThis as any).__codexRemoteSharedBridge__ = { version: 'external-websocket-files-v5', files, appServer: { rpc: remoteRpc, onNotification: () => () => {}, dispose() {} }, methodCatalog: {} }
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
      expect(await (await fetch(base + '/codex-local-browse/C:/remote/windows.txt')).text()).toBe(text)
      const browse = '/codex-local-browse' + encodeURI(textPath)
      expect(await (await fetch(base + browse)).text()).toBe(text)
      const listing = await fetch(base + '/codex-local-directories?path=' + encodeURIComponent(root))
      expect(listing.status).toBe(200)
      const folders = (await listing.json() as { data: { entries: { name: string; path: string }[] } }).data.entries
      expect(folders).toContainEqual({ name: 'subdirectory', path: join(root, 'subdirectory') })
      expect(folders.some((entry: { name: string }) => entry.name === 'example.txt')).toBe(false)
      for (const directory of [root, join(root, 'subdirectory'), join(root, 'directory-link')]) {
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
      for (const [name, status] of [['unsupported', 502], ['offline', 502], ['denied', 403]] as const) {
        const response = await fetch(base + '/codex-local-browse' + root + '/' + name)
        expect(response.status).toBe(status)
        if (name === 'unsupported') expect(await response.json()).toMatchObject({ code: -32601, data: { method: 'fs/getMetadata' } })
      }
      const cached = await fetch(base + browse)
      const etag = cached.headers.get('etag')!
      expect((await fetch(base + browse, { headers: { 'If-None-Match': etag } })).status).toBe(304)
      expect((await fetch(base + browse, { headers: { Range: 'bytes=999-' } })).status).toBe(416)
      expect(await (await fetch(base + browse, { headers: { Range: 'bytes=-7' } })).text()).toBe(text.slice(-7))
      const before = remote.calls.length
      await fetch(base + '/codex-local-directories?path=' + encodeURIComponent(root))
      expect(remote.calls.slice(before)).toEqual(['fs/getMetadata', 'fs/readDirectory'])
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

  }
}, 30000)

it('passes retired editor requests through without touching request or response bodies', () => {
  const middleware = createLocalFileMiddleware(new ProjectFileService({ rpc: vi.fn() }))
  for (const method of ['GET', 'HEAD', 'PUT']) {
    const next = vi.fn()
    middleware({ method, url: '/codex-local-edit/tmp/example.txt' } as IncomingMessage, {} as ServerResponse, next)
    expect(next).toHaveBeenCalledExactlyOnceWith()
  }
})

it('proxies encoded drive and UNC links to the remote filesystem independent of the UI host OS', async () => {
  const paths: string[] = []
  const files = new ProjectFileService({ rpc: async (method, params) => {
    paths.push((params as { path: string }).path)
    return method === 'fs/getMetadata'
      ? { isFile: true, isDirectory: false, modifiedAtMs: 0 }
      : { dataBase64: Buffer.from('remote bytes').toString('base64') }
  } })
  const handler = createLocalFileMiddleware(files)
  const server = createHttpServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end() }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    for (const [url, path] of [
      ['/codex-local-browse/D%3A/remote/a%23b%3F.txt', 'D:/remote/a#b?.txt'],
      ['/codex-local-browse//server/share/report.txt', '//server/share/report.txt'],
      [`/codex-local-image?path=${encodeURIComponent('\\\\server\\share\\image.png')}`, '\\\\server\\share\\image.png'],
    ]) {
      paths.length = 0
      const response = await fetch(base + url)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('remote bytes')
      expect(paths).toEqual([path, path])
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

it('avoids redundant transfers for concurrent GET, warm HEAD, validators and browser ranges', async () => {
  let version = 1
  let body = Buffer.alloc(1024 * 1024, 'x')
  const rpc = vi.fn(async (method: string) => method === 'fs/getMetadata'
    ? { isFile: true, isDirectory: false, isSymlink: false, createdAtMs: 1, modifiedAtMs: version * 1000 }
    : { dataBase64: body.toString('base64') })
  const files = new ProjectFileService({ rpc })
  const handler = createLocalFileMiddleware(files)
  const server = createHttpServer((req, res) => handler(req, res, () => res.end()))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/codex-local-browse/remote/file.txt`
    const coldConditional = await fetch(url, { headers: { 'If-Modified-Since': new Date(1000).toUTCString() } })
    expect(coldConditional.status).toBe(304)
    expect(rpc.mock.calls.filter(([method]) => method === 'fs/readFile')).toHaveLength(0)
    const responses = await Promise.all([fetch(url), fetch(url), fetch(url)])
    await Promise.all(responses.map(response => response.arrayBuffer()))
    expect(rpc.mock.calls.filter(([method]) => method === 'fs/readFile')).toHaveLength(1)
    const etag = responses[0]!.headers.get('etag')!
    const head = await fetch(url, { method: 'HEAD' })
    expect(head.headers.get('content-length')).toBe(String(body.length))
    expect((await fetch(url, { headers: { 'If-None-Match': etag } })).status).toBe(304)
    expect((await fetch(url, { headers: { Range: `bytes=${body.length}-` } })).status).toBe(416)
    const range = await fetch(url, { headers: { Range: 'bytes=0-4', 'If-Range': etag } })
    expect(range.status).toBe(206)
    expect(range.headers.get('content-length')).toBe('5')
    expect(await range.text()).toBe('xxxxx')
    expect(rpc.mock.calls.filter(([method]) => method === 'fs/readFile')).toHaveLength(1)
    version++
    body = Buffer.from('edited')
    const edited = await fetch(url, { headers: { 'If-None-Match': etag } })
    expect(edited.status).toBe(200)
    expect(await edited.text()).toBe('edited')
    expect(rpc.mock.calls.filter(([method]) => method === 'fs/readFile')).toHaveLength(2)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
