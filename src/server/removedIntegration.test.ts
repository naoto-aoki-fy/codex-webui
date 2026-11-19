import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { expect, it, vi } from 'vitest'
import { createCodexBridgeMiddleware } from './codexAppServerBridge'

it('ignores obsolete integration files and returns 404 for removed endpoints across restarts', async () => {
  const home = await mkdtemp(join(tmpdir(), 'removed-integration-'))
  const scope = globalThis as typeof globalThis & { __codexRemoteSharedBridge__?: any }
  const previous = scope.__codexRemoteSharedBridge__
  vi.stubEnv('CODEX_HOME', home)
  const files = {
    'telegram-bridge.json': '{invalid obsolete configuration',
    'telegram-notification-outbox.json': '{invalid obsolete outbox',
    '.codex-global-state.json': JSON.stringify({ unrelated: { preserved: true } }),
  }
  const network = vi.spyOn(globalThis, 'fetch')
  try {
    for (const [name, contents] of Object.entries(files)) await writeFile(join(home, name), contents)
    for (let restart = 0; restart < 2; restart++) {
      scope.__codexRemoteSharedBridge__ = { version: 'external-websocket-files-v5', appServer: { dispose: vi.fn() }, methodCatalog: {} }
      const middleware = createCodexBridgeMiddleware()
      try {
        for (const path of ['config', 'configure-bot', 'status', 'test-notification']) {
          for (const method of ['GET', 'POST']) {
            const req = Object.assign(Readable.from([]), { method, url: `/codex-api/telegram/${path}`, headers: {} })
            const end = vi.fn()
            const res = Object.assign(new EventEmitter(), { statusCode: 200, setHeader: vi.fn(), write: vi.fn(), end })
            await middleware(req as unknown as IncomingMessage, res as unknown as ServerResponse, vi.fn())
            expect(res.statusCode).toBe(404)
            expect(JSON.parse(end.mock.calls[0]![0])).toEqual({ error: 'Not found' })
          }
        }
        await new Promise(resolve => setTimeout(resolve, 30))
        expect(network).not.toHaveBeenCalled()
        for (const [name, contents] of Object.entries(files)) expect(await readFile(join(home, name), 'utf8')).toBe(contents)
      } finally { middleware.dispose() }
    }
  } finally {
    network.mockRestore()
    scope.__codexRemoteSharedBridge__ = previous
    vi.unstubAllEnvs()
    await rm(home, { recursive: true, force: true })
  }
})
