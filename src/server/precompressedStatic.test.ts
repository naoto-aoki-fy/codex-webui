import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import express from 'express'
import { request } from 'node:http'
import fs from 'node:fs'
import { mkdtemp, writeFile, rm, readFile, mkdir, unlink, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { decompress } from '@bokuweb/zstd-wasm'
import { precompressedStatic, sendPrecompressed } from './precompressedStatic'
const require = createRequire(import.meta.url)
const { precompress } = require('../../scripts/precompress-assets.cjs')
const compression = [
  { name: 'zstd', suffix: '.zst', decode: (body: Buffer) => Buffer.from(decompress(body)) },
  { name: 'br', suffix: '.br', decode: brotliDecompressSync },
  { name: 'gzip', suffix: '.gz', decode: gunzipSync },
]
const assetTypes = ['js', 'mjs', 'css', 'html', 'json', 'svg', 'txt', 'xml', 'map']
let root: string
let server: ReturnType<ReturnType<typeof express>['listen']>
let port: number
const content = '<html>compression test</html>'.repeat(100)
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'precompress-'))
  await writeFile(join(root, 'index.html'), content)
  await writeFile(join(root, 'app.js'), 'const text = "hello";'.repeat(100))
  await writeFile(join(root, 'ties.js'), 'console.log("hello");'.repeat(128))
  await writeFile(join(root, 'tiny.txt'), 'a')
  await writeFile(join(root, 'partial.txt'), content)
  await writeFile(join(root, 'open-race.txt'), content)
  await writeFile(join(root, 'image.png'), Buffer.from([1, 2, 3]))
  for (const extension of assetTypes) await writeFile(join(root, `fixture.${extension}`), content)
  await mkdir(join(root, 'assets'), { recursive: true })
  await mkdir(join(root, '.vite'), { recursive: true })
  await mkdir(join(root, 'removed'))
  for (const name of ['compressed', 'identity', 'unacceptable']) {
    await writeFile(join(root, `removed/${name}.txt`), content)
  }
  await writeFile(join(root, 'assets/app-Abcd123_.js'), 'const built = true;'.repeat(100))
  await writeFile(join(root, 'assets/manual-Abcd123_.js'), 'const manual = true;')
  await writeFile(join(root, '.vite/manifest.json'), JSON.stringify({
    'index.html': { file: 'assets/app-Abcd123_.js' },
    publicScript: { file: 'app.js' },
  }))
  await precompress(root)
  await unlink(join(root, 'partial.txt.br'))
  await unlink(join(root, 'partial.txt.zst'))
  await writeFile(join(root, 'plain.txt'), 'uncompressed')
  const app = express()
  app.get('/codex-api/test', (_req, res) => res.set('Cache-Control', 'private, no-store').json({ ok: true }))
  app.get('/auth/test', (_req, res) => res.status(401).end())
  app.get('/local/test', (_req, res) => res.set('Cache-Control', 'private, max-age=300').send('local'))
  app.use('/removed', (_req, res, next) => {
    const sendFile = res.sendFile
    vi.spyOn(res, 'sendFile').mockImplementationOnce((file, ...args) => {
      fs.unlinkSync(file)
      Reflect.apply(sendFile, res, [file, ...args])
    })
    next()
  })
  app.use('/legacy', precompressedStatic(join(root, 'assets')))
  app.use(precompressedStatic(root))
  app.use((req, res, next) => sendPrecompressed(req, res, next, join(root, 'index.html')))
  server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  port = (server.address() as { port: number }).port
})
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  await rm(root, { recursive: true, force: true })
})
function get(encoding?: string, path = '/', method = 'GET', extra = {}) {
  return new Promise<{ status: number, headers: import('node:http').IncomingHttpHeaders, body: Buffer }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { ...(encoding === undefined ? {} : { 'Accept-Encoding': encoding }), ...extra } }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.end()
  })
}
it.each([
  ['zstd', 'zstd'], ['br', 'br'], ['gzip', 'gzip'],
  [undefined, undefined], ['', undefined], ['deflate', undefined],
  ['gzip;q=1, br;q=0.9, zstd;q=0.5', 'gzip'],
  ['zstd;q=0.8, br;q=0.6, gzip;q=0.2', 'zstd'],
  ['gzip;q=0.1, br;q=0.3, zstd;q=0.2', 'br'],
  ['identity;q=1,gzip;q=0.5', undefined],
  ['identity;q=0.5,br;q=0.5', 'br'],
  ['gzip;q=0.001', 'gzip'],
  ['*', 'br'], ['*;q=0.5, gzip;q=0.6', 'gzip'],
  ['*;q=0.9, br;q=0.5, zstd;q=0.1', 'gzip'],
  ['*;q=1, BR ; Q = 0.000, zstd;q=0', 'gzip'],
  ['*;q=1, br;q=0, br;q=1', 'zstd'],
  ['*;q=1, br;q=0;q=1', 'zstd'],
  ['*;q=0, br', 'br'], ['*;q=0, identity;q=0.5', undefined],
])('negotiates %s', async (header, encoding) => {
  const response = await get(header)
  expect(response.status).toBe(200)
  expect(response.headers['content-encoding']).toBe(encoding)
  expect(response.headers.vary).toBe('Accept-Encoding')
  expect(response.headers['content-type']).toContain('text/html')
  expect(Number(response.headers['content-length'])).toBe(response.body.length)
  const decoded = compression.find(format => format.name === encoding)?.decode(response.body) ?? response.body
  expect(decoded.toString()).toBe(content)
})

it.each([
  ['/index.html', 'gzip, deflate, br, zstd'],
  ['/ties.js', 'gzip, deflate, br, zstd'],
  ['/index.html', 'gzip, deflate, br'],
  ['/index.html', 'gzip, zstd'],
  ['/index.html', 'gzip;q=0.5, zstd;q=0.5, br;q=0.5'],
])('selects the smallest accepted compressed file for %s with %s', async (path, header) => {
  const candidates = await Promise.all(compression.filter(({ name }) => header.includes(name)).map(async format => ({
    ...format,
    body: await readFile(join(root, path + format.suffix)),
  })))
  const [smallest] = candidates.sort((a, b) => a.body.length - b.body.length)
  const response = await get(header, path)
  expect(response.status).toBe(200)
  expect(response.headers['content-encoding']).toBe(smallest.name)
  expect(response.body).toEqual(smallest.body)
})

it('considers the original size when identity is explicitly tied', async () => {
  const response = await get('br, identity', '/tiny.txt')
  expect(response.status).toBe(200)
  expect(response.headers['content-encoding']).toBeUndefined()
  expect(response.body.toString()).toBe('a')
})

it('falls back for missing sidecars and refuses unacceptable representations', async () => {
  expect((await get('br, zstd, gzip;q=0.5', '/partial.txt')).headers['content-encoding']).toBe('gzip')
  expect((await get('br, zstd, gzip', '/partial.txt')).headers['content-encoding']).toBe('gzip')
  const plain = await get('br, zstd, gzip', '/plain.txt')
  expect(plain.status).toBe(200)
  expect(plain.headers['content-encoding']).toBeUndefined()
  expect(plain.body.toString()).toBe('uncompressed')
  for (const [header, path] of [
    ['zstd, br, gzip;q=0, identity;q=0', '/partial.txt'],
    ['*;q=0', '/'],
    ['br;q=0,zstd;q=0,gzip;q=0,identity;q=0', '/thread/example'],
  ]) {
    const response = await get(header, path)
    expect(response.status).toBe(406)
    expect(response.headers.vary).toBe('Accept-Encoding')
    expect(response.headers['content-encoding']).toBeUndefined()
  }
})

it.each([
  ['compressed', 'br, gzip;q=0.5', 'gzip', 200],
  ['identity', 'br, gzip;q=0', undefined, 200],
  ['unacceptable', 'br, gzip;q=0, identity;q=0', undefined, 406],
] as const)('serves %s when the selected sidecar is removed during the request', async (name, header, encoding, status) => {
  const response = await get(header, `/removed/${name}.txt`)
  expect(response.status).toBe(status)
  expect(response.headers['content-encoding']).toBe(encoding)
  expect(response.headers.vary).toBe('Accept-Encoding')
  if (status === 200) {
    expect(response.headers.etag).toMatch(encoding === 'gzip' ? /^W\/"gzip-/ : /^W\/"identity-/)
    expect(Number(response.headers['content-length'])).toBe(response.body.length)
    expect((encoding === 'gzip' ? gunzipSync(response.body) : response.body).toString()).toBe(content)
  } else {
    expect(response.headers['cache-control']).toBe('no-store')
  }
})

it('clears range headers and revalidates against the selected fallback when opening the sidecar fails', async () => {
  const file = join(root, 'open-race.txt')
  const before = new Date('2025-01-01T00:00:00Z')
  const after = new Date('2025-01-02T00:00:00Z')
  await utimes(file + '.br', before, before)
  await utimes(file + '.gz', after, after)
  const gzip = await get('gzip', '/open-race.txt')
  const createReadStream = fs.createReadStream
  const open = vi.spyOn(fs, 'createReadStream').mockImplementation((path, options) => {
    if (path === file + '.br') fs.unlinkSync(path)
    return createReadStream(path, options)
  })
  try {
    const response = await get('br, gzip;q=0.5', '/open-race.txt', 'GET', {
      Range: 'bytes=0-4',
      'If-Range': before.toUTCString(),
    })
    expect(open).toHaveBeenCalledWith(file + '.br', expect.objectContaining({ start: 0, end: 4 }))
    expect(response.status).toBe(200)
    expect(response.headers['content-range']).toBeUndefined()
    for (const header of ['content-encoding', 'content-length', 'etag', 'last-modified']) {
      expect(response.headers[header]).toBe(gzip.headers[header])
    }
    expect(response.body).toEqual(gzip.body)
  } finally {
    open.mockRestore()
  }
})

it('serves SPA routes, JavaScript MIME, HEAD and representation-specific validators', async () => {
  expect((await get('br', '/thread/example')).headers['content-encoding']).toBe('br')
  expect((await get('gzip', '/app.js')).headers['content-type']).toMatch(/javascript/)
  const gzip = await get('gzip')
  const head = await get('gzip', '/', 'HEAD')
  expect(head.body.length).toBe(0)
  expect(head.headers['content-length']).toBe(gzip.headers['content-length'])
  expect(head.headers.etag).toBe(gzip.headers.etag)
  expect(gzip.headers['cache-control']).toBe('no-cache')
  expect((await get('gzip', '/', 'GET', { 'If-None-Match': gzip.headers.etag })).status).toBe(304)
  expect((await get('identity', '/', 'GET', { 'If-None-Match': gzip.headers.etag })).status).toBe(200)
})
it.each(assetTypes)('precompresses .%s assets and retains their originals', async extension => {
  const file = join(root, `fixture.${extension}`)
  expect((await readFile(file)).toString()).toBe(content)
  for (const { suffix, decode } of compression) {
    expect(decode(await readFile(file + suffix)).toString()).toBe(content)
  }
})

it('skips binary assets', async () => {
  for (const { suffix } of compression) {
    await expect(readFile(join(root, 'image.png' + suffix))).rejects.toMatchObject({ code: 'ENOENT' })
  }
})

it('prevents a missing sidecar from caching a 406 for an immutable URL', async () => {
  const path = '/assets/app-Abcd123_.js'
  const file = join(root, path + '.br')
  const brotli = await readFile(file)
  await unlink(file)
  try {
    const unavailable = await get('br, *;q=0', path)
    expect(unavailable.status).toBe(406)
    expect(unavailable.headers['cache-control']).toBe('no-store')
    expect(unavailable.headers.vary).toBe('Accept-Encoding')
  } finally {
    await writeFile(file, brotli)
  }

  const available = await get('br, *;q=0', path)
  expect(available.status).toBe(200)
  expect(available.headers['cache-control']).toBe('public, max-age=31536000, immutable')
  expect(available.headers['content-encoding']).toBe('br')
  expect(available.body).toEqual(brotli)
})

it.each(['identity', 'gzip', 'br', 'zstd'])('caches only build-generated JavaScript with %s', async encoding => {
  const path = '/assets/app-Abcd123_.js'
  const response = await get(encoding, path + '?v=1')
  expect(response.status).toBe(200)
  expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable')
  expect(response.headers['content-type']).toMatch(/javascript/)
  expect(response.headers['content-encoding']).toBe(encoding === 'identity' ? undefined : encoding)
  expect(response.headers.vary).toBe('Accept-Encoding')
  const head = await get(encoding, path, 'HEAD')
  expect(head.body.length).toBe(0)
  for (const header of ['cache-control', 'content-length', 'content-encoding', 'content-type', 'etag', 'last-modified', 'vary']) {
    expect(head.headers[header]).toBe(response.headers[header])
  }
  const fresh = await get(encoding, path, 'GET', { 'If-None-Match': response.headers.etag })
  expect(fresh.status).toBe(304)
  expect(fresh.headers['cache-control']).toBe(response.headers['cache-control'])
  expect(fresh.headers.etag).toBe(response.headers.etag)
  expect(fresh.headers.vary).toBe('Accept-Encoding')
  const otherEncoding = encoding === 'identity' ? 'gzip' : 'identity'
  expect((await get(otherEncoding, path, 'GET', { 'If-None-Match': response.headers.etag })).status).toBe(200)
  for (const path of ['/app.js', '/assets/manual-Abcd123_.js', '/legacy/app-Abcd123_.js', '/plain.txt']) {
    expect((await get(encoding, path)).headers['cache-control']).toBe('public, max-age=0')
  }
  for (const path of ['/', '/index.html', '/thread/example', '/missing-Abcd123_.js']) {
    expect((await get(encoding, path)).headers['cache-control']).toBe('no-cache')
  }
})
it('preserves policies on non-static routes and hides the manifest', async () => {
  expect((await get(undefined, '/codex-api/test')).headers['cache-control']).toBe('private, no-store')
  const auth = await get(undefined, '/auth/test')
  expect(auth.status).toBe(401)
  expect(auth.headers['cache-control']).toBeUndefined()
  expect((await get(undefined, '/local/test')).headers['cache-control']).toBe('private, max-age=300')
  expect((await get(undefined, '/.vite/manifest.json')).headers['content-type']).toContain('text/html')
})
