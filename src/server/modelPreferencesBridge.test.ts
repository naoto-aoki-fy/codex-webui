import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createCodexBridgeMiddleware } from './codexAppServerBridge'
import { modelPreferencesPath } from './modelPreferencesStore'

const scope = globalThis as typeof globalThis & { __codexRemoteSharedBridge__?: unknown }
let previous: unknown
let bridge: ReturnType<typeof createCodexBridgeMiddleware>
const rpc = vi.fn()
beforeEach(async () => {
  previous = scope.__codexRemoteSharedBridge__
  rpc.mockReset().mockImplementation(async (method: string) => method === 'turn/start' ? { turn: { id: 'accepted' } }
    : { thread: { id: 't', modelProvider: 'openai' }, model: 'A', reasoningEffort: 'low' })
  scope.__codexRemoteSharedBridge__ = {
    version: 'external-websocket-files-v4', appServer: { rpc, getSnapshotEpoch: () => null, storeThreadReadSnapshot: vi.fn(), getStreamEvents: () => [], onNotification: () => () => {}, dispose: vi.fn() }, methodCatalog: {},
  }
  bridge = createCodexBridgeMiddleware()
})
afterEach(() => { bridge.dispose(); scope.__codexRemoteSharedBridge__ = previous; vi.restoreAllMocks() })
async function request(method: string, params: unknown = null) {
  const req = Object.assign(Readable.from([JSON.stringify({ method, params })]), { method: 'POST', url: '/codex-api/rpc', headers: {} })
  let body = ''
  const res = Object.assign(new EventEmitter(), { statusCode: 200, setHeader: vi.fn(), write: vi.fn(), end: (chunk: unknown) => { body += chunk ?? '' } })
  await bridge(req as unknown as IncomingMessage, res as unknown as ServerResponse, vi.fn())
  return { status: res.statusCode, ...JSON.parse(body) }
}
const preferred = { providerId: 'openai', modelId: 'A', reasoningEffort: 'high', collaborationMode: 'default' }

it('serves profile-scoped preferences without contacting the external server and broadcasts updates to both clients', async () => {
  const a = vi.fn(), b = vi.fn(), offA = bridge.subscribeNotifications(a), offB = bridge.subscribeNotifications(b)
  try {
    expect((await request('model-preferences/read')).result.preferred).toBeNull()
    const updated = await request('model-preferences/update', { preferred })
    expect(updated.result.connectionProfile).toBe('unit-test')
    expect(updated.result.preferred).toEqual(preferred)
    expect(updated.result.modelUsage).toEqual({})
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ method: 'model-preferences/changed', params: updated.result }))
    expect(b).toHaveBeenCalledWith(expect.objectContaining({ params: updated.result }))
    expect(rpc).not.toHaveBeenCalled()
    expect((await request('model-preferences/read')).result.preferred).toEqual(preferred)
  } finally { offA(); offB() }
})

it('counts only successful turn/start RPCs, broadcasts actual accepted settings, and preserves historical metadata', async () => {
  const listener = vi.fn(), off = bridge.subscribeNotifications(listener)
  try {
    await request('thread/resume', { threadId: 't' })
    rpc.mockRejectedValueOnce(new Error('model unavailable'))
    expect((await request('turn/start', { threadId: 't', model: 'B' })).status).toBe(502)
    expect((await request('model-preferences/read')).result.modelUsage).toEqual({})
    const accepted = await request('turn/start', { threadId: 't', model: 'A', effort: 'high' })
    expect(accepted.result).toEqual({ turn: { id: 'accepted' } }) // CAP-003 is not fabricated from preferences.
    const state = (await request('model-preferences/read')).result
    expect(state.lastUsed).toEqual(preferred)
    expect(state.modelUsage['["openai","A"]'].usageCount).toBe(1)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ method: 'model-preferences/changed' }))
  } finally { off() }
})

it('keeps turn acceptance successful when persistence fails and reports the failure without replaying the turn', async () => {
  const listener = vi.fn(), off = bridge.subscribeNotifications(listener)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    await request('thread/resume', { threadId: 't' })
    await mkdir(dirname(modelPreferencesPath()), { recursive: true })
    await writeFile(modelPreferencesPath(), '{"schemaVersion":2}')
    const result = await request('turn/start', { threadId: 't', model: 'A', effort: 'high' })
    expect(result.status).toBe(200)
    expect(rpc.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(1)
    expect(warn).toHaveBeenCalled()
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ method: 'model-preferences/error' }))
  } finally { off() }
})
