import { RemoteHistoryPager } from './remoteHistoryPager'
import { nativeHistoryResponse } from './testFixtures/nativeHistory'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createCodexBridgeMiddleware } from './codexAppServerBridge'

const { sqlite } = vi.hoisted(() => ({
  sqlite: vi.fn<(command: string, args: string[], options: unknown) => { status: number; stdout: string; stderr: string }>(),
}))
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(), spawnSync: sqlite,
}))
const scope = globalThis as typeof globalThis & { __codexRemoteSharedBridge__?: unknown }
const rpc = vi.fn<(method: string, params: unknown) => Promise<unknown>>()
const storeSnapshot = vi.fn<(threadId: string, result: unknown) => void>()
let previous: unknown
let home: string
let project: string
let sessionPath: string
let sessionRaw: string
const archiveBytes = Buffer.from('PK\x05\x06' + '\0'.repeat(18), 'binary')

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'project-history-'))
  project = join(home, 'existing-project')
  sessionPath = join(home, 'sessions', 'rollout-existing.jsonl')
  await mkdir(project)
  await mkdir(join(project, '.codex-project'))
  await writeFile(join(project, '.codex-project', 'manifest.json'), '{"projectName":"Existing project"}')
  await mkdir(join(home, 'sessions'))
  await writeFile(join(project, 'notes.txt'), 'Existing project data')
  await writeFile(join(project, 'previous-export.zip'), archiveBytes)
  sessionRaw = JSON.stringify({ type: 'session_meta', payload: { id: 'historical-thread', cwd: project } }) + '\n'
  await writeFile(sessionPath, sessionRaw)
  vi.stubEnv('CODEX_HOME', home)
  previous = scope.__codexRemoteSharedBridge__
  rpc.mockReset().mockImplementation(async method => method === 'fs/getMetadata' ? { isDirectory: true, isFile: false } : { data: [] })
  storeSnapshot.mockReset()
  sqlite.mockReset().mockReturnValue({ status: 0, stdout: '[]', stderr: '' })
  const pager = new RemoteHistoryPager({ rpc: async (method, params) => nativeHistoryResponse(method, params, await rpc(method, params)), getConnectionGeneration: () => 1 })
  scope.__codexRemoteSharedBridge__ = {
    version: 'external-websocket-files-v2', appServer: { rpc, getSnapshotEpoch: () => null, storeThreadReadSnapshot: storeSnapshot, getStreamEvents: () => [], readThreadPage: pager.read.bind(pager) },
    methodCatalog: {},
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

it.each(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT'])('returns JSON 404 for retired fallback (%s) without RPC or SPA fallthrough', async method => {
  for (const query of ['', '?threadId=historical-thread']) {
    const response = await request('/codex-api/thread-file-change-fallback' + query, method)
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

it.each(['/codex-api/thread/rollback-files', '/codex-api/github-clone', '/codex-api/local-directory', '/codex-api/projectless-thread-cwd', '/codex-api/project-root-suggestion'])('retires %s without modifying existing files or history', async path => {
  const response = await request(path, 'POST', { threadId: 'historical-thread', turnId: 't0', cwd: project, path: join(project, 'missing'), createIfMissing: true })
  expect(response.res.statusCode).toBe(404)
  expect(response.next).not.toHaveBeenCalled()
  expect(rpc).not.toHaveBeenCalled()
  expect(await readFile(join(project, 'notes.txt'), 'utf8')).toBe('Existing project data')
  expect(await readFile(sessionPath, 'utf8')).toBe(sessionRaw)
})

it.each([undefined, '', '   '])('rejects missing workspace %s without RPC or filesystem creation', async cwd => {
  const filesBefore = await readdir(home, { recursive: true })
  const response = await request('/codex-api/rpc', 'POST', { method: 'thread/start', params: { cwd } })
  expect(response.res.statusCode).toBe(400)
  expect(response.json.error).toContain('Select an existing workspace')
  expect(await readdir(home, { recursive: true })).toEqual(filesBefore)
  expect(await readFile(sessionPath, 'utf8')).toBe(sessionRaw)
  expect(rpc).not.toHaveBeenCalled()
})

it('allows explicitly selected existing folders and preserves legacy session data', async () => {
  rpc.mockImplementation(async method => method === 'fs/getMetadata' ? { isDirectory: true, isFile: false } : { thread: { id: 'new-thread', cwd: project } })
  const response = await request('/codex-api/rpc', 'POST', { method: 'thread/start', params: { cwd: project } })
  expect(response.res.statusCode).toBe(200)
  expect(rpc).toHaveBeenCalledWith('thread/start', { cwd: project })
  expect(await readFile(sessionPath, 'utf8')).toBe(sessionRaw)
  expect(await readFile(join(project, 'notes.txt'), 'utf8')).toBe('Existing project data')
})

it.each([
  [-32601, 'Method not found', 'unsupported-api', 'Upgrade the remote Codex'],
  [-32000, 'ENOENT directory not found', 'missing-path', 'Check the directory'],
  [-32000, 'EACCES permission denied', 'permission', 'Check the directory'],
  [-32000, 'transport socket disconnected', 'transport', 'Check the directory'],
])('diagnoses remote workspace validation errors without starting a thread (%s)', async (code, message, diagnosis, guidance) => {
  rpc.mockRejectedValue(Object.assign(new Error(message), { code }))
  const response = await request('/codex-api/rpc', 'POST', { method: 'thread/start', params: { cwd: '/remote/project' } })
  expect(response.res.statusCode).toBe(502)
  expect(response.json).toMatchObject({ capability: 'fs/getMetadata', diagnosis })
  expect(response.json.error).toContain(guidance)
  expect(rpc.mock.calls.map(call => call[0])).toEqual(['fs/getMetadata'])
})
