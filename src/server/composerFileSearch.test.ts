import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { expect, it, vi } from 'vitest'
import { createCodexBridgeMiddleware } from './codexAppServerBridge.js'

vi.mock('../commandResolution.js', () => ({ resolveRipgrepCommand: () => null }))

it('starts without ripgrep and reports search failure as HTTP 500 with setup guidance', async () => {
  const middleware = createCodexBridgeMiddleware()
  const req = Object.assign(Readable.from([JSON.stringify({ cwd: process.cwd(), query: '' })]), {
    method: 'POST', url: '/codex-api/composer-file-search',
    headers: { 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as IncomingMessage
  let body = ''
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200, setHeader: vi.fn(), write: vi.fn(), end: (chunk: unknown) => { body += chunk ?? '' },
  }) as unknown as ServerResponse
  const next = vi.fn()
  await middleware(req, res, next)
  expect(res.statusCode).toBe(500)
  expect(JSON.parse(body)).toEqual({ error: expect.stringMatching(/ripgrep.*rg --version.*CODEXUI_RG_COMMAND/) })
  expect(JSON.parse(body)).not.toHaveProperty('data')
  expect(next).not.toHaveBeenCalled()
})
