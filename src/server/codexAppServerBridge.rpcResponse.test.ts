import { once } from 'node:events'
import { createServer, request, type IncomingMessage, type Server } from 'node:http'
import { brotliDecompressSync, gzip } from 'node:zlib'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('node:zlib', async importOriginal => {
  const zlib = await importOriginal<typeof import('node:zlib')>()
  return { ...zlib, gzip: vi.fn(zlib.gzip) }
})

const scope = globalThis as typeof globalThis & { __codexRemoteSharedBridge__?: unknown }
const rpc = vi.fn<(method: string, params: unknown) => Promise<unknown>>()
let previousBridge: unknown
let disposeBridge: () => void
let server: Server
let url: string
let serving: { closed: Promise<unknown[]>; done: Promise<void>; expectNoWrite: () => void }

beforeEach(async () => {
  vi.stubEnv('CODEXUI_API_PERF_LOGGING', 'true')
  vi.stubEnv('CODEXUI_API_PERF_MS_THRESHOLD', '60000')
  vi.stubEnv('CODEXUI_API_PERF_BODY_MB_THRESHOLD', '1')
  const { createCodexBridgeMiddleware } = await import('./codexAppServerBridge')
  previousBridge = scope.__codexRemoteSharedBridge__
  scope.__codexRemoteSharedBridge__ = {
    version: 'external-websocket-files-v5',
    appServer: { rpc, getSnapshotEpoch: () => null, dispose() {} },
  }
  const bridge = createCodexBridgeMiddleware()
  disposeBridge = bridge.dispose
  server = createServer((req, res) => {
    const end = vi.spyOn(res, 'end')
    const write = vi.spyOn(res, 'write')
    serving = {
      closed: once(res, 'close'),
      done: bridge(req, res, () => { res.statusCode = 404; res.end() }),
      expectNoWrite() {
        expect(end).not.toHaveBeenCalled()
        expect(write).not.toHaveBeenCalled()
      },
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/codex-api/rpc`
})

afterEach(async () => {
  await new Promise<void>(resolve => {
    server.close(() => resolve())
    server.closeAllConnections()
  })
  disposeBridge()
  scope.__codexRemoteSharedBridge__ = previousBridge
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.mocked(gzip).mockClear()
  rpc.mockReset()
})

function requestRpc(encoding: string, body = '{"method":"thread/list"}') {
  const client = request(url, {
    method: 'POST',
    headers: { 'Accept-Encoding': encoding, 'Content-Type': 'application/json', Connection: 'close' },
  })
  client.end(body)
  return client
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

it('logs the same decoded body size for identity and Brotli above the size threshold', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  const result = { data: ['日本語'.repeat(122_000)] }
  const decoded = Buffer.from(JSON.stringify({ result }))
  const requestBody = JSON.stringify({ method: 'thread/list', params: { cursor: 'fixture'.repeat(4096) } })
  const mb = 1024 * 1024
  const bodyMB = ((Buffer.byteLength(requestBody) + decoded.length) / mb).toFixed(1)
  expect(decoded.length).toBeGreaterThan(mb)
  expect(bodyMB).not.toBe((decoded.length / mb).toFixed(1))
  rpc.mockResolvedValue(result)

  for (const encoding of ['identity', 'br']) {
    log.mockClear()
    const client = requestRpc(encoding, requestBody)
    const [response] = await once(client, 'response') as [IncomingMessage]
    const chunks: Buffer[] = []
    for await (const chunk of response) chunks.push(chunk)
    await serving.closed
    const body = Buffer.concat(chunks)
    expect(response.statusCode).toBe(200)
    expect(log).toHaveBeenCalledOnce()
    expect(log.mock.calls[0]![0]).toContain(`bodyMB=${bodyMB}, rpcMethod=thread/list`)

    if (encoding === 'br') {
      expect(response.headers['content-encoding']).toBe('br')
      expect(Number(response.headers['content-length'])).toBe(body.length)
      expect(Buffer.byteLength(requestBody) + body.length).toBeLessThan(mb)
      expect(brotliDecompressSync(body).equals(decoded)).toBe(true)
      expect(log.mock.calls[0]![0]).toContain(`encodedResponseBytes=${body.length})`)
    } else {
      expect(body.equals(decoded)).toBe(true)
      expect(log.mock.calls[0]![0]).not.toContain('encodedResponseBytes')
    }
  }
  expect(rpc).toHaveBeenCalledTimes(2)
})

it.each(['identity', 'gzip'])('skips %s serialization after the client disconnects before its RPC result', async encoding => {
  const upstreamEntered = deferred<void>()
  const upstreamResult = deferred<unknown>()
  rpc.mockImplementation(() => {
    upstreamEntered.resolve()
    return upstreamResult.promise
  })
  const toJSON = vi.fn(() => ({ data: ['x'.repeat(2048)] }))
  const client = requestRpc(encoding)
  client.on('error', () => {})
  await upstreamEntered.promise
  client.destroy()
  await serving.closed
  upstreamResult.resolve({ toJSON })
  await serving.done

  expect(rpc).toHaveBeenCalledOnce()
  expect(toJSON).not.toHaveBeenCalled()
  expect(gzip).not.toHaveBeenCalled()
  serving.expectNoWrite()
})

it('skips the response write when the client disconnects during encoding', async () => {
  const encoderEntered = deferred<() => void>()
  vi.mocked(gzip).mockImplementationOnce((_body, _options, done) => {
    encoderEntered.resolve(() => done(null, Buffer.from('compressed fixture')))
  })
  rpc.mockResolvedValue({ data: ['x'.repeat(2048)] })
  const client = requestRpc('gzip')
  client.on('error', () => {})
  const finishEncoding = await encoderEntered.promise
  client.destroy()
  await serving.closed
  finishEncoding()
  await serving.done

  expect(rpc).toHaveBeenCalledOnce()
  expect(gzip).toHaveBeenCalledOnce()
  serving.expectNoWrite()
})
