import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { AppServerWebSocketClient, resolveAppServerUrl } from './appServerWebSocketClient'
const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach(fn => fn()))
const transports = process.platform === 'win32' ? ['tcp'] : ['tcp', 'unix']
async function fixture(initialize = true, transport = 'tcp') {
  const directory = transport === 'unix' ? mkdtempSync(join(tmpdir(), 'uds-')) : null
  const path = directory ? join(directory, 'socket :%.sock') : null
  const http = createServer()
  const server = new WebSocketServer({ server: http })
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    if (path) http.listen(path, resolve)
    else http.listen(0, '127.0.0.1', resolve)
  })
  cleanup.push(() => http.close(() => { if (directory) rmSync(directory, { recursive: true, force: true }) }))
  cleanup.push(() => { for (const socket of server.clients) socket.terminate(); server.close() })
  const frames: any[] = []
  let connections = 0
  server.on('connection', socket => {
    connections++
    socket.on('message', data => {
      const frame = JSON.parse(data.toString()); frames.push(frame)
      if (frame.method === 'initialize' && initialize) socket.send(JSON.stringify({ id: frame.id, result: { userAgent: 'codex/0.167.2', codexHome: '/remote/codex', platformFamily: 'unix', platformOs: 'linux' } }))
      if (frame.method === 'thread/list') socket.send(JSON.stringify({ id: frame.id, result: { data: [] } }))
    })
  })
  const address = http.address() as { port: number }
  return { server, frames, count: () => connections, url: path ? `unix://${encodeURI(path).replace(/:/g, '%3A')}` : `ws://127.0.0.1:${address.port}` }
}
it('resolves precedence and validates URLs', () => {
  expect(resolveAppServerUrl(undefined, undefined)).toBe('ws://127.0.0.1:4500/')
  expect(resolveAppServerUrl(undefined, 'wss://example.org')).toBe('wss://example.org/')
  expect(resolveAppServerUrl('ws://localhost:123', 'bad')).toBe('ws://localhost:123/')
  expect(() => resolveAppServerUrl('http://localhost')).toThrow()
})
it.each(transports)('%s shares initialization, preserves frames, reconnects and leaves server alive after disposal', async transport => {
  const f = await fixture(true, transport); const received: string[] = []; let disconnected = 0
  const client = new AppServerWebSocketClient(frame => received.push(frame), () => disconnected++, f.url)
  cleanup.push(() => client.dispose())
  await Promise.all([client.connect(), client.connect(), client.connect()])
  expect(client.getInitializationMetadata()).toMatchObject({ codexHome: '/remote/codex', platformOs: 'linux' })
  client.send({ id: 22, method: 'thread/list', params: {} })
  const socket = [...f.server.clients][0]!
  socket.send(JSON.stringify({ method: 'turn/started', params: {} }))
  socket.send(JSON.stringify({ id: 'approval', method: 'item/commandExecution/requestApproval' }))
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(f.frames[0].params.capabilities.experimentalApi).toBe(true)
  expect(f.count()).toBe(1)
  expect(f.frames.map(f => f.method)).toEqual(['initialize', 'initialized', 'thread/list'])
  expect(f.frames.every(f => !('jsonrpc' in f))).toBe(true)
  expect(received).toHaveLength(3)
  expect(received.map(frame => JSON.parse(frame))).toContainEqual({ id: 22, result: { data: [] } })
  client.send({ id: 'approval', result: { decision: 'accept' } })
  await Promise.all([client.reconnect(), client.reconnect(), client.reconnect()])
  expect(disconnected).toBe(1)
  expect(f.count()).toBe(2)
  client.dispose()
  expect(f.server.address()).toBeTruthy()
  await expect(client.connect()).rejects.toThrow('disposed')
})
it.each(transports)('%s bounds initialization and allows a new connection after failure', async transport => {
  const f = await fixture(false, transport)
  let failures = 0
  const client = new AppServerWebSocketClient(() => {}, () => failures++, f.url, 30)
  cleanup.push(() => client.dispose())
  await expect(client.connect()).rejects.toThrow('timed out')
  await expect(client.connect()).rejects.toThrow('timed out')
  expect(failures).toBe(2)
})
it('reports refused connections without spawning a fallback', async () => {
  const client = new AppServerWebSocketClient(() => {}, () => {}, 'ws://127.0.0.1:1', 100)
  await expect(client.connect()).rejects.toThrow('Cannot connect')
  client.dispose()
})

it.skipIf(process.platform === 'win32')('validates Unix endpoints and preserves precedence and encoding', () => {
  expect(resolveAppServerUrl('unix:///tmp/a%20b.sock', 'ws://ignored')).toBe('unix:///tmp/a%20b.sock')
  expect(resolveAppServerUrl(undefined, 'unix:///tmp/codex.sock')).toBe('unix:///tmp/codex.sock')
  for (const endpoint of ['unix://', 'unix://relative.sock', 'unix:/tmp/a', 'unix://host/tmp/a',
    'unix://user@host/tmp/a', 'unix:///tmp/a?x', 'unix:///tmp/a#x', 'unix:///tmp/a?',
    'unix:///tmp/a#', 'unix:///', 'unix:///tmp/', 'unix:///tmp/%00', 'unix:///tmp/%0A',
    'unix:///tmp/%zz', 'unix:///tmp/a\\b', 'unix:///tmp/a\nb']) {
    expect(() => resolveAppServerUrl(endpoint), endpoint).toThrow()
  }
})
it('rejects Unix endpoints gracefully on Windows', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: 'win32' })
  try {
    expect(() => resolveAppServerUrl('unix:///tmp/codex.sock')).toThrow('unsupported on Windows')
    expect(resolveAppServerUrl('ws://localhost:4500')).toBe('ws://localhost:4500/')
  } finally { Object.defineProperty(process, 'platform', platform) }
})
it.skipIf(process.platform === 'win32')('recovers after a missing Unix listener becomes available', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'uds-'))
  const path = join(directory, 'socket.sock')
  const http = createServer()
  const server = new WebSocketServer({ server: http })
  const client = new AppServerWebSocketClient(() => {}, () => {}, `unix://${path}`, 1000)
  cleanup.push(() => {
    client.dispose()
    for (const socket of server.clients) socket.terminate()
    server.close()
    http.close(() => rmSync(directory, { recursive: true, force: true }))
  })
  await expect(client.connect()).rejects.toThrow('Cannot connect')
  server.on('connection', socket => socket.on('message', data => {
    const frame = JSON.parse(data.toString())
    if (frame.method === 'initialize') socket.send(JSON.stringify({ id: frame.id, result: {} }))
  }))
  await new Promise<void>(resolve => http.listen(path, resolve))
  await client.reconnect()
  expect(server.clients.size).toBe(1)
})

it('detects a silent transport using pong liveness rather than application events', async () => {
  process.env.CODEXUI_APP_SERVER_PING_MS = '10'
  process.env.CODEXUI_APP_SERVER_PONG_TIMEOUT_MS = '25'
  const f = await fixture()
  let disconnects = 0
  const client = new AppServerWebSocketClient(() => {}, () => disconnects++, f.url)
  try {
    await client.connect()
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(disconnects).toBe(0) // Healthy idle socket, no application messages.
    ;([...f.server.clients][0] as any)._autoPong = false
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(disconnects).toBe(1)
    expect(client.getInitializationMetadata()).toBeNull()
  } finally {
    client.dispose()
    delete process.env.CODEXUI_APP_SERVER_PING_MS
    delete process.env.CODEXUI_APP_SERVER_PONG_TIMEOUT_MS
  }
})
