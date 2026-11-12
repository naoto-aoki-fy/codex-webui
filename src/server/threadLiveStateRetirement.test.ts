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
    version: 'external-websocket-files-v2', appServer: { rpc, getSnapshotEpoch: () => null, storeThreadReadSnapshot: storeSnapshot, getLastThreadReadSnapshot: () => snapshot, getStreamEvents: () => events, readThreadForTurnPage: () => rpc('thread/read', {}) },
    methodCatalog: {},
  }
})
afterEach(async () => {
  scope.__codexRemoteSharedBridge__ = previous
  vi.unstubAllEnvs()
  await rm(home, { recursive: true, force: true })
})
async function request(path: string, method = 'GET', payload?: unknown, rawBody?: string) {
  const req = Object.assign(Readable.from(rawBody !== undefined ? [rawBody] : payload === undefined ? [] : [JSON.stringify(payload)]), {
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

it.each(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT'])('returns JSON 404 for retired live state (%s) without RPC or SPA fallthrough', async method => {
  for (const query of ['', '?threadId=historical-thread']) {
    const response = await request('/codex-api/thread-live-state' + query, method)
    expect(response.res.statusCode).toBe(404)
    expect(response.json).toEqual({ error: 'Not found' })
    expect(response.res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json; charset=utf-8')
    expect(response.next).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  }
})
it.each(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT'])('returns JSON 404 for retired stream events (%s) without RPC or SPA fallthrough', async method => {
  for (const query of ['', '?threadId=historical-thread&limit=50', '?threadId=historical-thread&limit=invalid']) {
    const response = await request('/codex-api/thread-stream-events' + query, method)
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
  expect(turn).not.toHaveProperty('submittedAt')
  expect(turn).not.toHaveProperty('generationMetadata')
  expect(turn.items[0].content).not.toContainEqual({ type: 'skill', name: 'test-skill', path: '/tmp/test/SKILL.md' })
  expect(turn.items[0].content[1].url).toMatch(/^\/codex-app-asset\?id=/)
})


it('keeps the latest 400 events in arrival order, isolates threads, and returns limited copies', () => {
  const client = new AppServerClient()
  const emit = (value: unknown) => (client as unknown as { emitNotification: (value: unknown) => void }).emitNotification(value)
  const listener = vi.fn()
  const unsubscribe = client.onNotification(listener)
  try {
    for (let i = 0; i < 405; i++) emit({ method: 'item/completed', params: { threadId: 'buffered', sequence: i } })
    emit({ method: 'error', params: { threadId: 'other', message: 'isolated' } })
    const all = client.getStreamEvents('buffered', 400)
    expect(all).toHaveLength(400)
    expect(all.map(frame => (frame.params as { sequence: number }).sequence)).toEqual(Array.from({ length: 400 }, (_, i) => i + 5))
    expect(all.every(frame => Number.isFinite(Date.parse(frame.atIso)))).toBe(true)
    expect(client.getStreamEvents('buffered', 2)).toEqual(all.slice(-2))
    all.pop()
    expect(client.getStreamEvents('buffered', 400)).toHaveLength(400)
    expect(client.getStreamEvents('other', 400)).toHaveLength(1)
    expect(client.getStreamEvents('missing', 400)).toEqual([])
    expect(listener).toHaveBeenCalledTimes(406)
  } finally { unsubscribe(); client.dispose() }
})

it('delivers live SSE notifications and releases the subscription on close without replay', async () => {
  const client = new AppServerClient()
  ;(scope.__codexRemoteSharedBridge__ as { appServer: unknown }).appServer = client
  const middleware = createCodexBridgeMiddleware()
  const req = Object.assign(new EventEmitter(), { method: 'GET', url: '/codex-api/events', headers: {}, socket: { remoteAddress: '127.0.0.1' } }) as unknown as IncomingMessage
  const write = vi.fn()
  const end = vi.fn()
  const res = Object.assign(new EventEmitter(), { setHeader: vi.fn(), write, end, writableEnded: false }) as unknown as ServerResponse
  const emit = (params: unknown) => (client as unknown as { emitNotification: (value: unknown) => void }).emitNotification({ method: 'error', params })
  try {
    emit({ threadId: 'sse', message: 'before subscription' })
    await middleware(req, res, vi.fn())
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0]).toContain('event: ready')
    emit({ threadId: 'sse', message: 'live error' })
    const frame = JSON.parse(write.mock.calls[1][0].slice(6).trim())
    expect(frame).toEqual({ method: 'error', params: { threadId: 'sse', message: 'live error' }, atIso: expect.any(String) })
    req.emit('close')
    emit({ threadId: 'sse', message: 'after close' })
    expect(write).toHaveBeenCalledTimes(2)
    expect(client.getStreamEvents('sse', 400)).toHaveLength(3)
    expect(end).toHaveBeenCalledOnce()
  } finally { req.emit('close'); client.dispose() }
})


it('truncates a response fork before pagination and snapshot caching', async () => {
  const turns = Array.from({ length: 25 }, (_, i) => ({ id: `turn-${i}`, items: [] }))
  rpc.mockImplementation(async (method, params) => {
    if (method === 'thread/fork') {
      expect(params).not.toHaveProperty('forkFromTurnIndex')
      expect(params).toMatchObject({ lastTurnId: 'turn-14' })
      return { model: 'fixture', thread: { id: 'fork-cutoff-test', turns: turns.slice(0, 15) } }
    }
    if (method === 'thread/read' && (params as Record<string, unknown>).threadId === 'fork-cutoff-test') {
      return { thread: { id: 'fork-cutoff-test', turns: turns.slice(0, 15) } }
    }
    return { thread: { id: 'source', turns } }
  })
  const response = await request('/codex-api/rpc', 'POST', {
    method: 'thread/fork-at-response', params: { threadId: 'source', forkFromTurnIndex: 14 },
  })
  expect(response.res.statusCode).toBe(200)
  expect(response.json.result.thread.turns).toEqual(turns.slice(5, 15))
  expect(response.json.result.threadTurnStartIndex).toBe(5)
  expect(response.json.result.model).toBe('fixture')
  expect(storeSnapshot).toHaveBeenCalledWith('fork-cutoff-test', response.json.result)
})

it('preserves RPC body validation, malformed JSON mapping, and success envelopes', async () => {
  const empty = await request('/codex-api/rpc', 'POST')
  expect(empty.res.statusCode).toBe(400)
  expect(empty.json).toEqual({ error: 'Invalid body: expected { method, params? }' })
  const malformed = await request('/codex-api/rpc', 'POST', undefined, '{broken')
  expect(malformed.res.statusCode).toBe(502)
  expect(malformed.json).toEqual({ error: expect.any(String) })
  expect(malformed.json.error).not.toBe('Unknown bridge error')
  expect(rpc).not.toHaveBeenCalled()
  rpc.mockResolvedValue({ data: ['fixture'] })
  const valid = await request('/codex-api/rpc', 'POST', { method: 'model/list', params: {} })
  expect(valid.res.statusCode).toBe(200)
  expect(valid.json).toEqual({ result: { data: ['fixture'] } })
})

it('shares one cached thread read across pagination cursors and limits until invalidated', async () => {
  const client = new AppServerClient()
  const read = vi.spyOn(client, 'rpc').mockResolvedValue({ thread: {
    id: 'cursor-cache', turns: Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, items: [] })),
  } })
  ;(scope.__codexRemoteSharedBridge__ as any).appServer.readThreadForTurnPage = client.readThreadForTurnPage.bind(client)
  try {
    const [first, second] = await Promise.all([
      request('/codex-api/thread-turn-page?threadId=cursor-cache&beforeTurnId=t6&limit=2'),
      request('/codex-api/thread-turn-page?threadId=cursor-cache&beforeTurnId=t4&limit=3'),
    ])
    expect(first.json.result.thread.turns.map((t: any) => t.id)).toEqual(['t4', 't5'])
    expect(second.json.result.thread.turns.map((t: any) => t.id)).toEqual(['t1', 't2', 't3'])
    expect(first.json).toMatchObject({ startTurnIndex: 4, hasMoreOlder: true })
    expect(second.json).toMatchObject({ startTurnIndex: 1, hasMoreOlder: true })
    expect(read).toHaveBeenCalledExactlyOnceWith('thread/read', { threadId: 'cursor-cache', includeTurns: true })
    client.storeThreadReadSnapshot('cursor-cache', {})
    await request('/codex-api/thread-turn-page?threadId=cursor-cache&beforeTurnId=t2&limit=2')
    expect(read).toHaveBeenCalledTimes(2)
  } finally { client.dispose() }
})
