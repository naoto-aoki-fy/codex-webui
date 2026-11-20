import { once } from 'node:events'
import { createServer, request, type IncomingMessage, type OutgoingHttpHeaders, type Server } from 'node:http'
import { setImmediate } from 'node:timers/promises'
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
let incoming: Promise<IncomingMessage>
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
  const requestStarted = deferred<IncomingMessage>()
  incoming = requestStarted.promise
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
    requestStarted.resolve(req)
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

function openRpcRequest(encoding: string, headers: OutgoingHttpHeaders = {}) {
  return request(url, {
    method: 'POST',
    headers: { 'Accept-Encoding': encoding, 'Content-Type': 'application/json', Connection: 'close', ...headers },
  })
}

function requestRpc(encoding: string, body = '{"method":"thread/list"}', headers: OutgoingHttpHeaders = {}) {
  const client = openRpcRequest(encoding, headers)
  client.end(body)
  return client
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function observeUpload(req: IncomingMessage, expectedBytes: number) {
  return new Promise<number>(resolve => {
    let bytesRead = 0
    const receive = (chunk: Buffer) => {
      bytesRead += chunk.length
      if (bytesRead < expectedBytes) return
      req.off('data', receive)
      resolve(bytesRead)
    }
    req.on('data', receive)
  })
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

it.each(['fixed-length', 'chunked'])('counts the original JSON bytes of a %s request', async framing => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  const requestBody = '{\n' + ' '.repeat(1_150_000) + '"method": "thread/list"\n}'
  const requestBytes = Buffer.byteLength(requestBody)
  const headers: OutgoingHttpHeaders = framing === 'chunked'
    ? { 'Transfer-Encoding': 'chunked' }
    : { 'Content-Length': requestBytes }
  rpc.mockResolvedValue({ data: [] })

  const client = requestRpc('identity', requestBody, headers)
  const [response] = await once(client, 'response') as [IncomingMessage]
  response.resume()
  await once(response, 'end')
  await serving.closed

  expect(response.statusCode).toBe(200)
  expect(rpc).toHaveBeenCalledExactlyOnceWith('thread/list', null)
  expect(log).toHaveBeenCalledOnce()
  const bodyMB = ((requestBytes + Number(response.headers['content-length'])) / (1024 * 1024)).toFixed(1)
  expect(log.mock.calls[0]![0]).toContain(`bodyMB=${bodyMB}, rpcMethod=thread/list)`)
})

it.each(['fixed-length', 'chunked'])('logs only the received bytes of an aborted %s request', async framing => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  const mb = 1024 * 1024
  const partial = Buffer.alloc(1.5 * mb, 32)
  const headers: OutgoingHttpHeaders = framing === 'chunked'
    ? { 'Transfer-Encoding': 'chunked' }
    : { 'Content-Length': 3 * mb }
  const client = openRpcRequest('identity', headers)
  client.on('error', () => {})
  client.flushHeaders()
  const req = await incoming

  const received = observeUpload(req, partial.length)
  client.write(partial)
  expect(await received).toBe(partial.length)
  client.destroy()
  await serving.closed
  await serving.done

  expect(log).toHaveBeenCalledOnce()
  expect(log.mock.calls[0]![0]).toMatch(/POST \/codex-api\/rpc -> aborted \(\d+ms, bodyMB=1\.5\)$/)
  expect(rpc).not.toHaveBeenCalled()
  serving.expectNoWrite()
})

it.each([
  { framing: 'fixed-length', abort: false },
  { framing: 'chunked', abort: false },
  { framing: 'fixed-length', abort: true },
  { framing: 'chunked', abort: true },
])('logs the drained body of a $framing 406 request (abort: $abort)', async ({ framing, abort }) => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  const mb = 1024 * 1024
  const body = Buffer.alloc(1.5 * mb, 32)
  const headers: OutgoingHttpHeaders = framing === 'chunked'
    ? { 'Transfer-Encoding': 'chunked' }
    : { 'Content-Length': abort ? 3 * mb : body.length }
  const client = openRpcRequest('*;q=0', { ...headers, Connection: 'keep-alive' })
  client.on('error', () => {})
  client.flushHeaders()
  const [response] = await once(client, 'response') as [IncomingMessage]
  response.resume()
  await once(response, 'end')

  expect(response.statusCode).toBe(406)
  expect(rpc).not.toHaveBeenCalled()
  expect(log).not.toHaveBeenCalled()
  const req = await incoming
  const drainEnded = abort
    ? new Promise<void>(resolve => { req.socket.once('close', resolve) })
    : once(req, 'end')
  const received = observeUpload(req, body.length)
  if (abort) client.write(body)
  else client.end(body)
  expect(await received).toBe(body.length)
  if (abort) client.destroy()
  await drainEnded
  await setImmediate()

  expect(log).toHaveBeenCalledOnce()
  expect(log.mock.calls[0]![0]).toMatch(/POST \/codex-api\/rpc -> 406 \(\d+ms, bodyMB=1\.5\)$/)
  expect(rpc).not.toHaveBeenCalled()
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
