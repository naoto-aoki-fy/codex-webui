import { nativeHistoryResponse } from './testFixtures/nativeHistory'
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
  const projects: any[] = []
  rpc.mockReset().mockImplementation(async (method, raw) => {
    const p = raw as any
    if (method === 'fs/getMetadata') return { isDirectory: true, isFile: false }
    if (method === 'project/create') { const project = { id: 'native-id', name: p.name, roots: p.roots, metadata: {}, position: 0 }; projects.push(project); return { project } }
    if (method === 'project/list') return { data: projects, nextCursor: null }
    return { data: [], nextCursor: null }
  })
  storeSnapshot.mockReset()
  sqlite.mockReset().mockReturnValue({ status: 0, stdout: '[]', stderr: '' })
  scope.__codexRemoteSharedBridge__ = {
    version: 'external-websocket-files-v4', appServer: { rpc: async (method: string, params: unknown) => nativeHistoryResponse(method, params, await rpc(method, params)), getSnapshotEpoch: () => null, storeThreadReadSnapshot: storeSnapshot, getStreamEvents: () => [] },
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
async function expectPreservedFiles() {
  expect(await readFile(join(project, 'notes.txt'), 'utf8')).toBe('Existing project data')
  expect(await readFile(join(project, '.codex-project', 'manifest.json'), 'utf8')).toBe('{"projectName":"Existing project"}')
  expect(await readFile(join(project, 'previous-export.zip'))).toEqual(archiveBytes)
  expect(await readFile(sessionPath, 'utf8')).toBe(sessionRaw)
}

it.each([['GET', 'project-zip'], ['HEAD', 'project-zip'], ['POST', 'project-import']])(
  'rejects retired ZIP route %s %s without changing existing files or history', async (method, path) => {
    const response = await request(`/codex-api/${path}?cwd=${encodeURIComponent(project)}&parent=${encodeURIComponent(home)}`, method)
    expect(response.next).not.toHaveBeenCalled()
    expect(response.res.statusCode).toBe(404)
    expect(response.json).toEqual({ error: 'Not found' })
    expect(rpc).not.toHaveBeenCalled()
    expect(sqlite).not.toHaveBeenCalled()
    await expectPreservedFiles()
  },
)

it('opens and lists an existing project without importing or changing its files', async () => {
  const opened = await request('/codex-api/project-root', 'POST', { path: project, label: 'Existing project' })
  expect(opened.res.statusCode).toBe(200)
  expect(opened.json.data.path).toBe(project)
  const listing = await request('/codex-api/workspace-roots-state')
  expect(listing.json.data.order).toContain(project)
  expect(listing.json.data.nativeProjects).toEqual([
    expect.objectContaining({ id: opened.json.data.projectId, roots: [{ path: project }] }),
  ])
  expect(sqlite).not.toHaveBeenCalled()
  await expectPreservedFiles()
})

it('keeps native listing authoritative without reading local SQLite sessions', async () => {
  await writeFile(join(home, 'state_5.sqlite'), 'Existing database sentinel')
  sqlite.mockReturnValue({ status: 0, stderr: '', stdout: JSON.stringify([
    { id: 'historical-thread', rollout_path: sessionPath, cwd: project, title: 'Previously imported conversation', created_at: 100, updated_at: 300 },
    { id: 'already-listed', rollout_path: sessionPath, cwd: project, title: 'Saved title', created_at: 100, updated_at: 200 },
    { id: 'incomplete-row' },
  ]) })
  rpc.mockResolvedValue({ data: [{ id: 'already-listed', preview: '', cwd: project, updatedAt: 200 },
    { id: 'normal-thread', preview: 'Normal Codex chat', cwd: project, updatedAt: 150 }], nextCursor: 'next-page' })
  const response = await request('/codex-api/rpc', 'POST', { method: 'thread/list', params: { sortKey: 'updated_at', limit: 3 } })
  expect(response.res.statusCode).toBe(200)
  expect(response.json.result.data.map((row: { id: string }) => row.id)).toEqual(['already-listed', 'normal-thread'])
  expect(response.json.result.nextCursor).toBe('next-page')
  expect(sqlite).not.toHaveBeenCalled()
  expect(await readFile(join(home, 'state_5.sqlite'), 'utf8')).toBe('Existing database sentinel')
  await expectPreservedFiles()
})

it('resumes and reloads historical messages with attachments through fresh middleware instances', async () => {
  const content = [{ type: 'text', text: 'Historical prompt' }, { type: 'localImage', path: join(project, 'attachment.png') }]
  const thread = { id: 'historical-thread', cwd: project, path: sessionPath, turns: [
    { id: 'old-turn', status: 'completed', items: [{ id: 'old-user', type: 'userMessage', content },
      { id: 'old-answer', type: 'agentMessage', text: 'Historical answer' }] },
  ] }
  rpc.mockResolvedValue({ thread })
  for (const method of ['thread/resume', 'thread/read']) {
    const response = await request('/codex-api/rpc', 'POST', { method, params: { threadId: thread.id, includeTurns: true } })
    expect(response.res.statusCode).toBe(200)
    expect(response.json.result.thread.turns[0].items[0].content).toEqual(content)
    expect(response.json.result.thread.turns[0].items[1].text).toBe('Historical answer')
  }
  expect(storeSnapshot).toHaveBeenCalledTimes(2)
  await expectPreservedFiles()
})

it('keeps the app-server thread list usable when SQLite history supplementation is unavailable', async () => {
  await writeFile(join(home, 'state_5.sqlite'), 'Existing database sentinel')
  sqlite.mockReturnValue({ status: 1, stdout: '', stderr: 'sqlite unavailable' })
  const listed = { data: [{ id: 'normal-thread', cwd: project, preview: 'Existing conversation' }], nextCursor: null }
  rpc.mockResolvedValue(listed)
  const response = await request('/codex-api/rpc', 'POST', { method: 'thread/list', params: { sortKey: 'updated_at', limit: 3 } })
  expect(response.res.statusCode).toBe(200)
  expect(response.json.result).toEqual(listed)
  expect(await readFile(join(home, 'state_5.sqlite'), 'utf8')).toBe('Existing database sentinel')
  await expectPreservedFiles()
})

it('rejects retired index rebuild without sending or changing session logs', async () => {
  const text = '# Files mentioned by the user:\n\n## notes.txt: /uploads/notes.txt\n\n## My request for Codex:\n\n\n'
  rpc.mockImplementation(async (method) => method === 'thread/read' ? { thread: {
    id: 'historical-thread', cwd: project, path: sessionPath, source: 'cli', modelProvider: 'openai',
    preview: '', createdAt: 100, updatedAt: 200,
    turns: [{ id: 'accepted-turn', items: [{ type: 'userMessage', content: [{ type: 'text', text }] }] }],
  } } : { data: [], nextCursor: null })
  const legacyIndex = join(home, 'codexapp-thread-index.json')
  const original = '{"historical-thread":{"pending":{"text":"Earlier attachment intent"}}}'
  await writeFile(legacyIndex, original)
  const rebuilt = await request('/codex-api/thread-index/rebuild', 'POST', {})
  expect(await readFile(legacyIndex, 'utf8')).toBe(original)
  expect(rebuilt.res.statusCode).toBe(404)
  expect(rebuilt.json.error).toBe('Not found')
  expect(sqlite).not.toHaveBeenCalled()
  expect(rpc.mock.calls.some(([method]) => method === 'turn/start')).toBe(false)
  await expectPreservedFiles()
})

it('rejects all legacy path mutations without rewriting registry fields', async () => {
  const statePath = join(home, '.codex-global-state.json')
  const raw = JSON.stringify({ 'electron-saved-workspace-roots': [project], 'remote-projects': [{ id: 'remote', future: { keep: true } }], unknown: true })
  await writeFile(statePath, raw)
  for (const operation of [{ type: 'rename', path: project, label: 'Renamed' }, { type: 'reorder', order: [project] }, { type: 'delete', path: project }]) {
    expect((await request('/codex-api/workspace-roots-state', 'PATCH', operation)).res.statusCode).toBe(400)
  }
  expect(await readFile(statePath, 'utf8')).toBe(raw)
  expect(rpc).not.toHaveBeenCalled()
})

it('keeps native pagination errors visible without fetching full history', async () => {
  rpc.mockResolvedValueOnce({ thread: { id: 'historical-thread', turns: [] } })
    .mockRejectedValueOnce(Object.assign(new Error('Method not found'), { code: -32601 }))
  const response = await request('/codex-api/rpc', 'POST', { method: 'thread/read', params: { threadId: 'historical-thread', includeTurns: true } })
  expect(response.res.statusCode).toBe(502)
  expect(response.json.error).toContain('thread/turns/list')
  expect(rpc.mock.calls.map(([method]) => method)).toEqual(['thread/read', 'thread/turns/list'])
  expect(rpc.mock.calls[0]?.[1]).toMatchObject({ includeTurns: false })
})

it('loads native Projects and pins independently of historical state without changing it', async () => {
  const path = join(home, '.codex-global-state.json')
  const before = JSON.stringify({ 'electron-saved-workspace-roots': ['/legacy'], 'pinned-thread-ids': ['legacy-pin'], 'codexapp-native-project-migrations-v1': { old: { completed: false } }, other: 42 }) + '\n'
  await writeFile(path, before)
  const project = { id: 'native-project', name: 'Native', roots: [{ path: '/native' }], position: 0, metadata: {} }
  rpc.mockResolvedValueOnce({ data: [project], nextCursor: null })
  const projects = await request('/codex-api/workspace-roots-state')
  expect(projects.res.statusCode).toBe(200)
  expect(projects.json.data).toMatchObject({ order: ['/native'], nativeProjects: [project] })
  rpc.mockResolvedValueOnce({ data: [{ id: 'native-pin' }], nextCursor: null })
  const pins = await request('/codex-api/thread-pins')
  expect(pins.res.statusCode).toBe(200)
  expect(pins.json.data.threadIds).toEqual(['native-pin'])
  const listed = await request('/codex-api/rpc', 'POST', { method: 'thread/list', params: {} })
  expect(listed.res.statusCode).toBe(200)
  rpc.mockResolvedValueOnce({ thread: { id: 'native', turns: [] } })
  const read = await request('/codex-api/rpc', 'POST', { method: 'thread/read', params: { threadId: 'native', includeTurns: false } })
  expect(read.res.statusCode).toBe(200)
  expect(read.json.result.thread.id).toBe('native')
  expect(await readFile(path, 'utf8')).toBe(before)
})
