import { afterEach, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import { AppServerClient } from './codexAppServerBridge.js'

afterEach(() => vi.unstubAllEnvs())
it('observes real RPC formats, separates unsupported/path/permission/transport and resets on disconnect', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>(resolve => server.once('listening', resolve))
  vi.stubEnv('CODEXUI_APP_SERVER_URL', `ws://127.0.0.1:${(server.address() as { port: number }).port}`)
  server.on('connection', socket => socket.on('message', raw => {
    const frame = JSON.parse(raw.toString())
    if (!frame.id) return
    if (frame.method === 'initialize') socket.send(JSON.stringify({ id: frame.id, result: { codexHome: '/B', userAgent: 'fixture', platformFamily: 'unix', platformOs: 'linux' } }))
    else if (frame.params?.path === '/disconnect') socket.close()
    else if (frame.params?.path === '/unsupported') socket.send(JSON.stringify({ id: frame.id, error: { code: -32601, message: 'Method not found' } }))
    else if (frame.params?.path === '/missing') socket.send(JSON.stringify({ id: frame.id, error: { code: -32000, message: 'ENOENT directory not found' } }))
    else if (frame.params?.path === '/denied') socket.send(JSON.stringify({ id: frame.id, error: { code: -32000, message: 'EACCES permission denied' } }))
    else socket.send(JSON.stringify({ id: frame.id, result: { isFile: false, isDirectory: true, isSymlink: false, createdAtMs: 0, modifiedAtMs: 0 } }))
  }))
  const client = new AppServerClient()
  try {
    for (const [path, support, diagnosis] of [['/unsupported', 'unsupported', 'unsupported-api'], ['/missing', 'unknown', 'missing-path'], ['/denied', 'unknown', 'permission']]) {
      await expect(client.rpc('fs/getMetadata', { path })).rejects.toThrow()
      expect(client.capabilities.snapshot()['fs/getMetadata']).toMatchObject({ support, diagnosis })
    }
    await client.rpc('fs/getMetadata', { path: '/valid' })
    expect(client.capabilities.snapshot()['fs/getMetadata']?.support).toBe('supported')
    expect(client.capabilities.snapshot()['fs/writeFile']?.support).toBe('unknown')
    await expect(client.rpc('fs/getMetadata', { path: '/disconnect' })).rejects.toThrow('disconnected')
    expect(client.capabilities.snapshot()['fs/getMetadata']?.support).toBe('unknown')
  } finally {
    client.dispose()
    for (const socket of server.clients) socket.terminate()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
