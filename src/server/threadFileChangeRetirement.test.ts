import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
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
  rpc.mockReset().mockResolvedValue({ data: [] })
  storeSnapshot.mockReset()
  sqlite.mockReset().mockReturnValue({ status: 0, stdout: '[]', stderr: '' })
  scope.__codexRemoteSharedBridge__ = {
    version: 'external-websocket-v1', appServer: { rpc, storeThreadReadSnapshot: storeSnapshot, getStreamEvents: () => [], readThreadForTurnPage: () => rpc('thread/read', {}) },
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
it.each(['single_turn', 'turn_and_later'])('preserves patch redo/undo for %s scope', async scope => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: project })
  git('init'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test')
  for (const name of ['modified.txt', 'deleted.txt', 'source.txt']) await writeFile(join(project, name), 'before\n')
  git('add', '.'); git('commit', '-m', 'fixture')
  const input = '*** Begin Patch\n*** Add File: added.txt\n+added\n*** Update File: modified.txt\n@@ -1 +1 @@\n-before\n+after\n*** Delete File: deleted.txt\n*** Update File: source.txt\n*** Move to: moved.txt\n@@ -1 +1 @@\n-before\n+after\n*** End Patch'
  await writeFile(sessionPath, [
    { type: 'turn_context', payload: { turn_id: 't1' } },
    { type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', status: 'completed', call_id: 'patch1', input } },
  ].map(row => JSON.stringify(row)).join('\n'))
  rpc.mockResolvedValue({ thread: { id: 'historical-thread', path: sessionPath, turns: [{ id: 't1', items: [] }] } } as never)
  const payload = { threadId: 'historical-thread', turnId: 't1', cwd: project, scope }
  const redo = await request('/codex-api/thread/rollback-files', 'POST', { ...payload, action: 'redo' })
  expect(redo.json.errors).toEqual([])
  expect(await readFile(join(project, 'added.txt'), 'utf8')).toBe('added\n')
  expect(await readFile(join(project, 'modified.txt'), 'utf8')).toBe('after\n')
  expect(await readFile(join(project, 'moved.txt'), 'utf8')).toBe('after\n')
  await expect(readFile(join(project, 'deleted.txt'))).rejects.toThrow()
  await expect(readFile(join(project, 'source.txt'))).rejects.toThrow()
  const undo = await request('/codex-api/thread/rollback-files', 'POST', { ...payload, action: 'undo' })
  expect(undo.json.errors).toEqual([])
  for (const name of ['modified.txt', 'deleted.txt', 'source.txt']) expect(await readFile(join(project, name), 'utf8')).toBe('before\n')
  await expect(readFile(join(project, 'added.txt'))).rejects.toThrow()
  await expect(readFile(join(project, 'moved.txt'))).rejects.toThrow()
  if (scope === 'turn_and_later') {
    rpc.mockResolvedValue({ thread: { id: 'historical-thread', turns: [] } } as never)
    const rollback = await request('/codex-api/rpc', 'POST', { method: 'thread/rollback', params: { threadId: 'historical-thread', numTurns: 1 } })
    expect(rollback.res.statusCode).toBe(200)
    expect(rollback.json.result.thread.turns).toEqual([])
    expect(rpc).toHaveBeenCalledWith('thread/rollback', { threadId: 'historical-thread', numTurns: 1 })
  }
})

it('preserves filtered patch order, partial failures and tracked Git fallback', async () => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: project })
  git('init'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test')
  await writeFile(join(project, 'tracked.txt'), 'HEAD\n')
  git('add', '.'); git('commit', '-m', 'fixture')
  const patches = [
    ['skip', '*** Add File: skipped.txt\n+skip'],
    ['first', '*** Add File: ordered.txt\n+one'],
    ['second', '*** Update File: ordered.txt\n@@ -1 +1 @@\n-one\n+two'],
    ['partial', '*** Add File: partial.txt\n+ok\n*** Update File: tracked.txt\n@@ -1 +1 @@\n-missing\n+new'],
  ]
  await writeFile(sessionPath, [
    { type: 'turn_context', payload: { turn_id: 't1' } },
    ...patches.map(([call_id, body]) => ({ type: 'response_item', payload: {
      type: 'custom_tool_call', name: 'apply_patch', status: 'completed', call_id,
      input: '*** Begin Patch\n' + body + '\n*** End Patch',
    } })),
  ].map(row => JSON.stringify(row)).join('\n'))
  rpc.mockResolvedValue({ thread: { id: 'historical-thread', path: sessionPath, turns: [{ id: 't1', items: [] }] } } as never)
  const payload = { threadId: 'historical-thread', turnId: 't1', cwd: project, scope: 'single_turn', patchIds: ['first', 'second', 'partial'] }
  const redo = await request('/codex-api/thread/rollback-files', 'POST', { ...payload, action: 'redo' })
  expect(redo.json.applied).toBe(3)
  expect(redo.json.appliedPatchIds).toEqual(['first', 'second'])
  expect(redo.json.errors).toEqual(['Could not apply patch for ' + join(project, 'tracked.txt')])
  expect(await readFile(join(project, 'ordered.txt'), 'utf8')).toBe('two\n')
  await expect(readFile(join(project, 'skipped.txt'))).rejects.toThrow()
  await writeFile(join(project, 'tracked.txt'), 'unmatched\n')
  const undo = await request('/codex-api/thread/rollback-files', 'POST', { ...payload, action: 'undo' })
  expect(undo.json.errors).toEqual([])
  expect(undo.json.reverted).toBe(4)
  expect(undo.json.revertedPatchIds).toEqual(['partial', 'second', 'first'])
  expect(await readFile(join(project, 'tracked.txt'), 'utf8')).toBe('HEAD\n')
  await expect(readFile(join(project, 'ordered.txt'))).rejects.toThrow()
  await expect(readFile(join(project, 'partial.txt'))).rejects.toThrow()
})
