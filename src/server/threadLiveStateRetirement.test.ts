import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppServerClient, createCodexBridgeMiddleware } from './codexAppServerBridge'

const { sqlite } = vi.hoisted(() => ({
  sqlite: vi.fn<(command: string, args: string[], options: unknown) => { status: number; stdout: string; stderr: string }>(),
}))
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(), spawnSync: sqlite,
}))
const scope = globalThis as typeof globalThis & { __codexRemoteSharedBridge__?: unknown }
const rpc = vi.fn<(method: string, params: unknown) => Promise<unknown>>()
const storeSnapshot = vi.fn<(threadId: string, result: unknown) => void>()
let snapshot: unknown = null
let events: Array<{ method: string; params: unknown; atIso: string }> = []
let previous: unknown
let home: string
let sessionPath: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'project-history-'))
  sessionPath = join(home, 'sessions', 'rollout-existing.jsonl')
  await mkdir(join(home, 'sessions'))
  await writeFile(sessionPath, '')
  vi.stubEnv('CODEX_HOME', home)
  previous = scope.__codexRemoteSharedBridge__
  rpc.mockReset().mockResolvedValue({ data: [] })
  storeSnapshot.mockReset()
  snapshot = null
  events = []
  sqlite.mockReset().mockReturnValue({ status: 0, stdout: '[]', stderr: '' })
  scope.__codexRemoteSharedBridge__ = {
    version: 'external-websocket-v1', appServer: { rpc, storeThreadReadSnapshot: storeSnapshot, getLastThreadReadSnapshot: () => snapshot, getStreamEvents: () => events, readThreadForTurnPage: () => rpc('thread/read', {}) },
    telegramBridge: {},  methodCatalog: {},
  }
})
afterEach(async () => {
  scope.__codexRemoteSharedBridge__ = previous
  vi.unstubAllEnvs()
  await rm(home, { recursive: true, force: true })
})
async function request(path: string, method = 'GET', payload?: unknown) {
  const req = Object.assign(Readable.from(payload === undefined ? [] : [JSON.stringify(payload)]), {
    method, url: path, headers: { 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as IncomingMessage
  let body = ''
  const res = Object.assign(new EventEmitter(), { statusCode: 200, setHeader: vi.fn(), write: vi.fn(),
    end: (chunk: unknown) => { body += chunk ?? '' },
  }) as unknown as ServerResponse
  const next = vi.fn()
  await createCodexBridgeMiddleware()(req, res, next)
  return { res, next, body, json: body ? JSON.parse(body) : null }
}

it.each(['GET', 'HEAD', 'POST'])('returns JSON 404 for retired live state (%s) without RPC or SPA fallthrough', async method => {
  for (const query of ['', '?threadId=historical-thread']) {
    const response = await request('/codex-api/thread-live-state' + query, method)
    expect(response.res.statusCode).toBe(404)
    expect(response.json).toEqual({ error: 'Not found' })
    expect(response.res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json; charset=utf-8')
    expect(response.next).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  }
})
it('keeps normal history and earlier-history pagination available', async () => {
  const turns = Array.from({ length: 15 }, (_, i) => ({ id: `t${i}`, items: [] }))
  rpc.mockResolvedValue({ thread: { id: 'historical-thread', turns } } as never)
  const initial = await request('/codex-api/rpc', 'POST', { method: 'thread/read', params: { threadId: 'historical-thread', includeTurns: true } })
  expect(initial.res.statusCode).toBe(200)
  expect(initial.json.result.thread.turns.map((t: { id: string }) => t.id)).toEqual(turns.slice(5).map(t => t.id))
  const older = await request('/codex-api/thread-turn-page?threadId=historical-thread&beforeTurnId=t5&limit=10')
  expect(older.res.statusCode).toBe(200)
  expect(older.json.result.thread.turns).toEqual(turns.slice(0, 5))
  expect(older.json.hasMoreOlder).toBe(false)
})

it('returns the saved snapshot after a recognized empty rollout read failure', async () => {
  snapshot = { thread: { id: 'historical-thread', turns: [{ id: 'saved', items: [] }] } }
  rpc.mockRejectedValue(new Error('failed to read thread: rollout is empty'))
  const response = await request('/codex-api/rpc', 'POST', { method: 'thread/read', params: { threadId: 'historical-thread', includeTurns: true } })
  expect(response.json).toEqual({ result: snapshot })
  expect(rpc).toHaveBeenCalledTimes(1)
})
it('returns empty in-progress history during pending materialization', async () => {
  rpc.mockRejectedValue(new Error('not materialized yet; includeTurns is unavailable before first user message'))
  const response = await request('/codex-api/rpc', 'POST', { method: 'thread/read', params: { threadId: 'historical-thread', includeTurns: true } })
  expect(response.json.result.thread).toEqual({ id: 'historical-thread', turns: [], status: { type: 'inProgress' } })
})
it('preserves buffered turn errors in normal and earlier-page reads', async () => {
  events = ['t0', 't14'].map(turnId => ({ method: 'error', params: { turnId, error: { message: 'buffered failure' } }, atIso: new Date().toISOString() }))
  rpc.mockResolvedValue({ thread: { id: 'historical-thread', turns: Array.from({ length: 15 }, (_, i) => ({ id: `t${i}`, items: [] })) } })
  const normal = await request('/codex-api/rpc', 'POST', { method: 'thread/read', params: { threadId: 'historical-thread', includeTurns: true } })
  const older = await request('/codex-api/thread-turn-page?threadId=historical-thread&beforeTurnId=t5&limit=10')
  for (const turn of [normal.json.result.thread.turns.at(-1), older.json.result.thread.turns[0]]) {
    expect(turn.status).toBe('failed')
    expect(turn.error.message).toBe('buffered failure')
  }
})
it('deduplicates concurrent earlier reads, caches results, and invalidates on notifications and snapshots', async () => {
  const client = new AppServerClient()
  const read = vi.spyOn(client, 'rpc').mockResolvedValue({ thread: { id: 'history-cache', turns: [] } })
  try {
    await Promise.all([client.readThreadForTurnPage('history-cache'), client.readThreadForTurnPage('history-cache')])
    await client.readThreadForTurnPage('history-cache')
    expect(read).toHaveBeenCalledTimes(1)
    // Exercise the actual notification producer without connecting a transport.
    ;(client as unknown as { emitNotification: (value: unknown) => void }).emitNotification({ method: 'item/completed', params: { threadId: 'history-cache', turnId: 't1', item: { id: 'cmd', type: 'commandExecution' } } })
    await client.readThreadForTurnPage('history-cache')
    expect(read).toHaveBeenCalledTimes(2)
    expect(client.getStreamEvents('history-cache', 10)).toHaveLength(1)
    client.storeThreadReadSnapshot('history-cache', {})
    await client.readThreadForTurnPage('history-cache')
    expect(read).toHaveBeenCalledTimes(3)
  } finally { client.dispose() }
})
it.each(['normal', 'earlier'])('preserves timestamps, execution metadata, skills and inline media in %s history', async mode => {
  const timestamp = '2026-11-05T00:12:00Z'
  await writeFile(sessionPath, [
    { type: 'turn_context', payload: { turn_id: 't1', model: 'gpt-5.4', effort: 'high' } },
    { type: 'event_msg', timestamp, payload: { type: 'user_message' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<skill>\n<name>test-skill</name>\n<path>/tmp/test/SKILL.md</path>\n</skill>' }] } },
    { type: 'event_msg', timestamp, payload: { type: 'task_complete', turn_id: 't1' } },
  ].map(row => JSON.stringify(row)).join('\n'))
  rpc.mockResolvedValue({ thread: { id: 'historical-thread', path: sessionPath, turns: [
    { id: 't1', items: [{ id: 'u1', type: 'userMessage', content: [{ type: 'text', text: 'hello' }, { type: 'image', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=' }] }] },
    { id: 't2', items: [] },
  ] } })
  const response = mode === 'normal'
    ? await request('/codex-api/rpc', 'POST', { method: 'thread/read', params: { threadId: 'historical-thread', includeTurns: true } })
    : await request('/codex-api/thread-turn-page?threadId=historical-thread&beforeTurnId=t2&limit=10')
  const turn = response.json.result.thread.turns[0]
  expect(turn).toMatchObject({ submittedAt: '2026-11-05T00:12:00.000Z', completedAt: '2026-11-05T00:12:00.000Z', generationMetadata: { model: 'gpt-5.4', effort: 'high', modelSource: 'execution' } })
  expect(turn.items[0].content).toContainEqual({ type: 'skill', name: 'test-skill', path: '/tmp/test/SKILL.md' })
  expect(turn.items[0].content[1].url).toMatch(/^\/codex-local-image\?path=/)
})
