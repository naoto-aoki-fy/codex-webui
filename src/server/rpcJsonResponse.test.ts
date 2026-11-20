import type { IncomingMessage, ServerResponse } from 'node:http'
import { gunzipSync, gzip } from 'node:zlib'
import { afterEach, expect, it, vi } from 'vitest'
import { createRpcJsonWriter } from './rpcJsonResponse'

vi.mock('node:zlib', async importOriginal => {
  const zlib = await importOriginal<typeof import('node:zlib')>()
  return { ...zlib, gzip: vi.fn(zlib.gzip) }
})

afterEach(() => vi.clearAllMocks())

async function writeJson(acceptEncoding: string, payload: unknown, vary?: string, status = 200) {
  const req = { headers: { 'accept-encoding': acceptEncoding } } as IncomingMessage
  const headers = new Map<string, string | number>()
  if (vary) headers.set('Vary', vary)
  const res = {
    statusCode: 0,
    getHeader: (name: string) => headers.get(name),
    setHeader: (name: string, value: string | number) => headers.set(name, value),
    end: vi.fn<(body: string | Buffer) => void>(),
  }
  const write = createRpcJsonWriter(req, res as unknown as ServerResponse)
  if (!write) throw new Error('Expected an acceptable encoding')
  await write(status, payload)
  expect(res.end).toHaveBeenCalledOnce()
  return { headers, status: res.statusCode, body: res.end.mock.calls[0]![0] }
}

it('uses the UTF-8 byte count for the 1 KiB threshold', async () => {
  const text = '日'.repeat(330)
  const bytes = Buffer.byteLength(JSON.stringify({ result: text }))
  const result = text + ' '.repeat(1024 - bytes)
  const small = await writeJson('gzip', { result: result.slice(0, -1) })
  expect(small.headers.has('Content-Encoding')).toBe(false)
  expect(gzip).not.toHaveBeenCalled()

  const compressed = await writeJson('gzip', { result })
  expect(compressed.headers.get('Content-Encoding')).toBe('gzip')
  expect(gunzipSync(compressed.body as Buffer)).toEqual(Buffer.from(JSON.stringify({ result })))
})

it('keeps the original JSON when the encoded form is larger', async () => {
  const payload = { result: 'x'.repeat(1024) }
  vi.mocked(gzip).mockImplementationOnce((_input, _options, done) => done(null, Buffer.alloc(2048)))

  const response = await writeJson('gzip', payload)
  expect(response.headers.has('Content-Encoding')).toBe(false)
  expect(response.body).toBe(JSON.stringify(payload))
})

it('returns the completed RPC result after a compression failure', async () => {
  const payload = { result: 'x'.repeat(1024) }
  vi.mocked(gzip).mockImplementationOnce((_input, _options, done) => done(new Error('fixture error'), Buffer.alloc(0)))

  const response = await writeJson('gzip, identity;q=0', payload)
  expect(response.status).toBe(200)
  expect(response.headers.has('Content-Encoding')).toBe(false)
  expect(response.headers.has('Content-Length')).toBe(false)
  expect(response.body).toBe(JSON.stringify(payload))
  expect(gzip).toHaveBeenCalledOnce()
})

it('encodes a small error without changing its status when identity is excluded', async () => {
  const payload = { error: 'Invalid body' }
  const response = await writeJson('gzip, identity;q=0', payload, 'Origin', 400)
  expect(response.status).toBe(400)
  expect(response.headers.get('Vary')).toBe('Origin, Accept-Encoding')
  expect(response.headers.get('Content-Encoding')).toBe('gzip')
  expect(gunzipSync(response.body as Buffer).toString()).toBe(JSON.stringify(payload))
})

it.each(['*', 'Origin, accept-encoding'])('preserves a Vary value of %s', async vary => {
  const response = await writeJson('identity;q=1, gzip;q=0.5', { result: 'x'.repeat(1024) }, vary)
  expect(response.headers.get('Vary')).toBe(vary)
  expect(response.headers.has('Content-Encoding')).toBe(false)
  expect(gzip).not.toHaveBeenCalled()
})
