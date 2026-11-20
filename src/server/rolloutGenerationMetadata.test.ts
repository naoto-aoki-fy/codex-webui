import { afterEach, expect, it, vi } from 'vitest'
import { RolloutGenerationMetadata, parseRolloutMetadata, rolloutSourcePath } from './rolloutGenerationMetadata'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { profileStorageDirectory } from './connectionProfile'
import { storageNames } from './webuiStorage.mjs'
import { AppServerClient } from './appServerClient'
import { mergeGenerationMetadata } from '../turnGenerationMetadata'
import type { RolloutQuestionReply } from './questionResponses'

afterEach(() => vi.unstubAllEnvs())
const cacheDirectory = () => join(profileStorageDirectory('cache'), storageNames.rolloutCache, 'v1')
const cachePath = (id = 't') => join(cacheDirectory(), createHash('sha256').update(id).digest('hex') + '.json')
const path = '/remote/.codex/sessions/2026/11/14/rollout-test.jsonl'
const context = (turn_id: string, fields: object) => JSON.stringify({ type: 'turn_context', timestamp: '2026-11-14T00:00:00Z', payload: { turn_id, ...fields } }) + '\n'
const execution = (model: string, effort?: string | null) => ({ model, modelSource: 'execution', ...(effort !== undefined ? { effort, effortSource: 'execution' } : {}) })
function fixture() {
  let stamp = 1, generation = 0
  const files = new Map<string, string>([[path, context('old', { model: 'A', effort: 'high' }) + context('new', { model: 'B', effort: 'none' })]])
  const rpc = vi.fn(async (method: string, params: any): Promise<any> => {
    if (method === 'thread/read') return { thread: { id: params.threadId, path } }
    if (method === 'fs/getMetadata') return { isFile: true, modifiedAtMs: stamp }
    if (method === 'fs/readFile') {
      if (!files.has(params.path)) throw new Error('ENOENT')
      return { dataBase64: Buffer.from(files.get(params.path)!).toString('base64') }
    }
    throw new Error('Unexpected RPC')
  })
  const client = { rpc, generation: () => generation, home: () => '/remote/.codex' }
  return { client, rpc, files, service: new RolloutGenerationMetadata(client), change: () => stamp++, disconnect: () => generation++ }
}
const sourceReads = (f: ReturnType<typeof fixture>) => f.rpc.mock.calls.filter(([m, p]) => m === 'fs/readFile' && p.path === path).length

const questionAnswers = { choice: { answers: ['Full', 'Keep examples'] }, private: { answers: ['synthetic private value'] } }
const questionReply = (): RolloutQuestionReply => ({ turnId: 'new', callId: 'call', answers: questionAnswers, confirmed: false })
const row = (type: string, payload: object) => JSON.stringify({ type, payload }) + '\n'
const boundary = (type: string, turnId = 'new') => row('event_msg', { type, turn_id: turnId })
const questionCall = row('response_item', { type: 'function_call', name: 'request_user_input', call_id: 'call' })
const questionResult = (answers: unknown = questionAnswers, callId = 'call') =>
  row('response_item', { type: 'function_call_output', call_id: callId, output: JSON.stringify({ answers }) })
const session = (id = 't') => row('session_meta', { id })
const completeQuestion = questionCall + questionResult() + boundary('task_complete')

it('shares a fresh scan with metadata even when the cached mtime matches, without persisting private evidence', async () => {
  const f = fixture()
  await f.service.recover('t')
  f.files.set(path, session() + boundary('task_started') + context('new', { model: 'C' }) + questionCall +
    questionResult() + questionResult() + boundary('task_complete'))
  const reply = questionReply()
  const metadata = f.service.recover('t')
  expect(f.service.recover('t', true, reply)).toBe(metadata)
  expect((await metadata).get('new')).toEqual(execution('C'))
  expect(reply.confirmed).toBe(true)
  expect(sourceReads(f)).toBe(2)
  expect(f.rpc.mock.calls.slice(4).map(([method]) => method)).toEqual(['thread/read', 'fs/getMetadata', 'fs/readFile', 'fs/getMetadata'])
  expect(await readFile(cachePath(), 'utf8')).not.toContain('synthetic private value')
})

it.each([
  ['another session', session('other') + boundary('task_started') + completeQuestion],
  ['another turn', session() + boundary('task_started', 'old') + questionCall + questionResult() + boundary('task_complete', 'old')],
  ['another call', session() + boundary('task_started') + questionCall + questionResult(questionAnswers, 'other') + boundary('task_complete')],
  ['no question tool call', session() + boundary('task_started') + questionResult() + boundary('task_complete')],
  ['changed answer ordering', session() + boundary('task_started') + questionCall +
    questionResult({ ...questionAnswers, choice: { answers: ['Keep examples', 'Full'] } }) + boundary('task_complete')],
  ['incomplete record', session() + boundary('task_started') + completeQuestion.trimEnd()],
  ['abort', session() + boundary('task_started') + questionCall + questionResult() + boundary('turn_aborted') + boundary('task_complete')],
  ['abort without a turn ID', session() + boundary('task_started') + questionCall + questionResult() +
    row('event_msg', { type: 'turn_aborted' }) + boundary('task_complete')],
  ['rollback', session() + boundary('task_started') + completeQuestion + boundary('thread_rolled_back')],
])('does not confirm a question reply using evidence from %s', async (_name, raw) => {
  const f = fixture()
  const reply = questionReply()
  f.files.set(path, raw)
  await f.service.recover('t', true, reply)
  expect(reply.confirmed).toBe(false)
  expect(sourceReads(f)).toBe(1)
})

it('queues one fresh question scan when an older metadata transfer already started', async () => {
  const f = fixture(), original = f.rpc.getMockImplementation()!
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  f.rpc.mockImplementation(async (method, params) => {
    const result = await original(method, params)
    if (method === 'fs/readFile' && sourceReads(f) === 1) await held
    return result
  })
  const old = f.service.recover('t')
  try {
    await vi.waitFor(() => expect(sourceReads(f)).toBe(1))
    f.files.set(path, session() + boundary('task_started') + completeQuestion)
    f.change()
    const reply = questionReply()
    const fresh = f.service.recover('t', true, reply)
    expect(fresh).not.toBe(old)
    expect(f.service.recover('t')).toBe(fresh)
    release()
    await fresh
    expect(reply.confirmed).toBe(true)
    expect(sourceReads(f)).toBe(2)
  } finally { release(); await old }
})

it.each([false, true])('retries a question scan once after an append during verification (changes again: %s)', async changesAgain => {
  const f = fixture()
  const original = f.rpc.getMockImplementation()!
  f.files.set(path, session() + boundary('task_started') + completeQuestion)
  f.rpc.mockImplementation(async (method, params) => {
    const result = await original(method, params)
    if (method === 'fs/readFile' && (sourceReads(f) === 1 || changesAgain)) {
      f.files.set(path, f.files.get(path)! + boundary('task_started', 'follow-up') + context('follow-up', { model: 'C' }))
      f.change()
    }
    return result
  })

  const reply = questionReply()
  const recovered = await f.service.recover('t', true, reply)

  expect(reply.confirmed).toBe(!changesAgain)
  expect(recovered.get('follow-up')).toEqual(changesAgain ? undefined : execution('C'))
  expect(f.rpc.mock.calls.map(([method]) => method)).toEqual([
    'thread/read', 'fs/getMetadata', 'fs/readFile', 'fs/getMetadata', 'fs/readFile', 'fs/getMetadata',
  ])
})

it('parses exact IDs, missing/null/none, malformed and interrupted records; suppresses conflicting fields', () => {
  const raw = context('a', { model: 'A', effort: null }) + 'bad\n' + context('b', { model: 'B', effort: 'none' }) + context('a', { model: 'A' }) + context('conflict', { model: 'X', effort: 'high' }) + context('conflict', { model: 'Y', effort: 'high' }) + context('', { model: 'wrong' }) + JSON.stringify({ type: 'event_msg', payload: { turn_id: 'foreign', model: 'wrong' } }) + '\n' + context('partial', { model: 'wrong' }).trim()
  const data = parseRolloutMetadata(raw)
  expect(data.get('a')).toEqual(execution('A', null))
  expect(data.get('b')).toEqual(execution('B', 'none'))
  expect(data.get('conflict')).toEqual({ effort: 'high', effortSource: 'execution' })
  expect([...data.keys()]).toEqual(['a', 'b', 'conflict'])
  expect(mergeGenerationMetadata({ model: 'submitted', modelSource: 'submitted', effort: 'low', effortSource: 'submitted' }, execution('actual') as any)).toEqual({ ...execution('actual'), effort: 'low', effortSource: 'submitted' })
})

it('validates remote POSIX/Windows paths and initialization home without local HOME', () => {
  expect(rolloutSourcePath(path, '/remote/.codex')).toBe(path)
  expect(rolloutSourcePath('C:\\Codex\\sessions\\2026\\11\\14\\rollout-x.jsonl', 'C:\\Codex')).toBe('C:\\Codex\\sessions\\2026\\11\\14\\rollout-x.jsonl')
  for (const bad of [null, 1, 'relative.jsonl', '/tmp/x.jsonl', '/x/../remote/.codex/sessions/2026/11/14/rollout-x.jsonl', 'file://' + path]) expect(rolloutSourcePath(bad, '/remote/.codex')).toBeUndefined()
  expect(rolloutSourcePath(path, '/different')).toBeUndefined()
  expect(rolloutSourcePath('/custom/archived_sessions/rollout-x.jsonl', '/custom')).toBe('/custom/archived_sessions/rollout-x.jsonl')
})

it('coalesces concurrent requests, caches minimal evidence, and survives backend restart with no source transfer', async () => {
  const f = fixture()
  const start = performance.now()
  const [a, b] = await Promise.all([f.service.recover('t'), f.service.recover('t')])
  expect(a).toEqual(b)
  expect(sourceReads(f)).toBe(1)
  expect(f.rpc).toHaveBeenCalledTimes(4)
  const restarted = new RolloutGenerationMetadata(f.client)
  expect(await restarted.recover('t')).toEqual(a)
  expect(sourceReads(f)).toBe(1)
  expect(f.rpc).toHaveBeenCalledTimes(6)
  const cache = await readFile(cachePath(), 'utf8')
  expect(Object.keys(JSON.parse(cache))).toEqual(['version', 'sourcePath', 'modifiedAtMs', 'rolloutModeScanned', 'turns', 'submittedModes'])
  expect(f.rpc.mock.calls.map(([method]) => method)).toEqual([
    'thread/read', 'fs/getMetadata', 'fs/readFile', 'fs/getMetadata', 'thread/read', 'fs/getMetadata',
  ])
  console.log(`Rollout fixture audit: cold+restart=${(performance.now() - start).toFixed(2)}ms; source=${Buffer.byteLength(f.files.get(path)!)} bytes; cache=${Buffer.byteLength(cache)} bytes; source reads=1; RPCs=${f.rpc.mock.calls.length}`)
})

it('invalidates appended sources, explicit refresh, schema and path changes', async () => {
  const f = fixture()
  await f.service.recover('t')
  f.files.set(path, f.files.get(path)! + context('third', { model: 'C', effort: null })); f.change()
  expect((await f.service.recover('t')).get('third')).toEqual(execution('C', null))
  expect(sourceReads(f)).toBe(2)
  await f.service.recover('t', true); expect(sourceReads(f)).toBe(3)
  const key = cachePath()
  for (const field of [{ version: 1 }, { sourcePath: '/wrong' }]) {
    await writeFile(key, JSON.stringify({ ...JSON.parse(await readFile(key, 'utf8')), ...field }))
    await f.service.recover('t')
  }
  expect(sourceReads(f)).toBe(5)
})

it('does not publish changing-source snapshots or retired connection results', async () => {
  for (const retire of [false, true]) {
    const f = fixture(), original = f.rpc.getMockImplementation()!
    f.rpc.mockImplementation(async (m, p) => {
      const result = await original(m, p)
      if (m === 'fs/readFile' && p.path === path) { if (retire) f.disconnect(); else f.change() }
      return result
    })
    expect((await f.service.recover('t')).size).toBe(0)
    await expect(stat(cachePath())).rejects.toMatchObject({ code: 'ENOENT' })
  }
})

it('unknown mtimes never validate or persist cache', async () => {
  const f = fixture(), original = f.rpc.getMockImplementation()!
  f.rpc.mockImplementation((m, p) => m === 'fs/getMetadata' ? Promise.resolve({ isFile: true, modifiedAtMs: 0 }) : original(m, p))
  expect((await f.service.recover('t')).size).toBe(2)
  await f.service.recover('t')
  expect(sourceReads(f)).toBe(2)
  await expect(stat(cachePath())).rejects.toMatchObject({ code: 'ENOENT' })
})

it.each(['fs/readFile', 'fs/getMetadata'])('isolates unsupported/denied %s failures', async method => {
  const f = fixture(), original = f.rpc.getMockImplementation()!
  f.rpc.mockImplementation((m, p) => m === method ? Promise.reject(Object.assign(new Error('denied or unsupported'), { code: -32601 })) : original(m, p))
  expect((await f.service.recover('t')).size).toBe(0)
})

it('recovers evidence even when the local cache cannot be written', async () => {
  const f = fixture()
  await mkdir(cacheDirectory(), { recursive: true })
  await mkdir(cachePath())
  expect((await f.service.recover('t')).get('old')).toEqual(execution('A', 'high'))
  expect(await readdir(cacheDirectory())).toHaveLength(1)
})

it('updates only requested exact turn IDs through existing notifications, including older pages', async () => {
  const f = fixture()
  const instance = new AppServerClient()
  vi.spyOn(instance as any, 'ensureInitialized').mockResolvedValue(undefined)
  vi.spyOn(instance as any, 'callObserved').mockImplementation(async (method: any, params: any) => {
    if (method === 'thread/turns/list') return { data: [{ id: params.cursor === 'older' ? 'old' : 'new', items: [] }, { id: 'unrelated', items: [] }] }
    if (method === 'thread/read' && params.includeTurns) return { thread: { id: 't', path, turns: [{ id: 'new', items: [] }] } }
    return f.rpc(method, params)
  })
  const notify = vi.fn(); instance.onNotification(notify)
  try {
    await instance.rpc('thread/read', { threadId: 't', includeTurns: true })
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith({ method: 'turn/generationMetadata', params: { threadId: 't', turnId: 'new', generationMetadata: execution('B', 'none') } }))
    notify.mockClear()
    await instance.rpc('thread/turns/list', { threadId: 't', cursor: 'older' })
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith({ method: 'turn/generationMetadata', params: { threadId: 't', turnId: 'old', generationMetadata: execution('A', 'high') } }))
    expect(notify).toHaveBeenCalledTimes(1)
    expect(sourceReads(f)).toBe(1)
  } finally { instance.dispose() }
})


it('rejects oversized transfers before decoding and does not touch original files', async () => {
  const f = fixture(), original = f.rpc.getMockImplementation()!
  f.rpc.mockImplementation((m, p) => m === 'fs/readFile' && p.path === path
    ? Promise.resolve({ dataBase64: 'A'.repeat(24 * 1024 * 1024) }) : original(m, p))
  expect((await f.service.recover('t')).size).toBe(0)
  await expect(stat(cachePath())).rejects.toMatchObject({ code: 'ENOENT' })
})

it('does not reuse persistent data across different remote homes', async () => {
  const f = fixture()
  await f.service.recover('t')
  const other = new RolloutGenerationMetadata({ ...f.client, home: () => '/another-host/.codex' })
  expect((await other.recover('t')).size).toBe(0)
  expect(sourceReads(f)).toBe(1)
})

it('does not leak metadata between source, native fork and unrelated threads with colliding turn IDs', async () => {
  const f = fixture(), original = f.rpc.getMockImplementation()!
  const forkPath = path.replace('test.jsonl', 'fork.jsonl')
  const otherPath = path.replace('test.jsonl', 'other.jsonl')
  f.files.set(forkPath, context('old', { model: 'fork-model', effort: 'low' }))
  f.files.set(otherPath, context('old', { model: 'unrelated-model' }))
  f.rpc.mockImplementation((m, p) => m === 'thread/read' ? Promise.resolve({ thread: {
    id: p.threadId, path: p.threadId === 'fork' ? forkPath : p.threadId === 'other' ? otherPath : path,
  } }) : original(m, p))
  expect((await f.service.recover('t')).get('old')).toEqual(execution('A', 'high'))
  expect((await f.service.recover('fork')).get('old')).toEqual(execution('fork-model', 'low'))
  expect((await f.service.recover('other')).get('old')).toEqual(execution('unrelated-model'))
  // A revert rewrites the fork rollout; unavailable inherited evidence stays unknown.
  f.files.set(forkPath, 'malformed\n' + context('old', {})); f.change()
  expect(await f.service.recover('fork')).toEqual(new Map())
  expect((await f.service.recover('t')).get('old')).toEqual(execution('A', 'high'))
  expect(await readdir(cacheDirectory())).toHaveLength(3)
  expect(f.files.get(path)).toContain('"model":"A"')
})

it('discards request-derived values inserted into a rollout cache and rebuilds from the source', async () => {
  const f = fixture()
  await f.service.recover('t')
  const key = cachePath()
  const cached = JSON.parse(await readFile(key, 'utf8'))
  cached.turns[0].metadata = { model: 'request-only', modelSource: 'submitted' }
  await writeFile(key, JSON.stringify(cached))
  expect((await new RolloutGenerationMetadata(f.client).recover('t')).get('old')).toEqual(execution('A', 'high'))
  expect(sourceReads(f)).toBe(2)
})

it('isolates cached evidence for identical thread IDs, source paths and mtimes on different App Servers', async () => {
  const f = fixture()
  await f.service.recover('t')
  vi.stubEnv('CODEXUI_CONNECTION_PROFILE', 'other')
  f.files.set(path, context('old', { model: 'different' }))
  expect((await new RolloutGenerationMetadata(f.client).recover('t')).get('old')).toEqual(execution('different'))
  expect(sourceReads(f)).toBe(2)
  vi.stubEnv('CODEXUI_CONNECTION_PROFILE', 'unit-test')
  expect((await new RolloutGenerationMetadata(f.client).recover('t')).get('old')).toEqual(execution('A', 'high'))
  expect(sourceReads(f)).toBe(2)
})

const modeContext = (id: string, mode: string) => context(id, { collaboration_mode: { mode } })
const modeStart = (id: string, mode: string) => JSON.stringify({ type: 'event_msg', payload: {
  type: 'task_started', turn_id: id, collaboration_mode_kind: mode,
} }) + '\n'
const modeEvidence = (collaborationMode: 'default' | 'plan' | null, collaborationModeSource = 'execution') => ({
  collaborationMode, collaborationModeSource,
})

it('parses exact collaboration-mode evidence independently of model and effort and clears conflicts', () => {
  const result = parseRolloutMetadata(
    modeStart('plan', 'plan') + modeContext('plan', 'plan') + modeStart('default', 'default') +
    modeContext('conflict', 'plan') + modeStart('conflict', 'default') + modeContext('conflict', 'plan') +
    context('conflict', { model: 'A', effort: 'none' }) +
    modeStart('', 'plan') + modeStart('unknown', 'unknown') + modeStart('incomplete', 'plan').trimEnd(),
  )
  expect([...result]).toEqual([
    ['plan', modeEvidence('plan')], ['default', modeEvidence('default')],
    ['conflict', { ...execution('A', 'none'), ...modeEvidence(null) }],
  ])
})

it('upgrades v1 in place and keeps explicit modes across restart with the rollout unavailable', async () => {
  const f = fixture()
  const profile = process.env.CODEXUI_CONNECTION_PROFILE!
  await mkdir(cacheDirectory(), { recursive: true })
  await writeFile(cachePath(), JSON.stringify({ version: 1, sourcePath: path, modifiedAtMs: 1,
    turns: [{ turnId: 'old', metadata: execution('A', 'high') }] }))
  await f.service.rememberSubmittedMode('t', 'new', 'plan', profile)
  const upgraded = JSON.parse(await readFile(cachePath(), 'utf8'))
  expect(upgraded).toMatchObject({ version: 2, sourcePath: path, turns: [{ turnId: 'old', metadata: execution('A', 'high') }], submittedModes: { new: 'plan' } })
  const unavailable = { ...f.client, rpc: vi.fn(async () => { throw new Error('no rollout reads') }) }
  const restarted = new RolloutGenerationMetadata(unavailable)
  expect([...await restarted.recover('t')]).toEqual([['new', modeEvidence('plan', 'submitted')]])
  expect((await restarted.recover('fork')).size).toBe(0)
  const original = f.files.get(path)!
  f.files.set(path, original + modeStart('old', 'plan'))
  expect((await f.service.recover('t')).get('old')).toEqual({ ...execution('A', 'high'), ...modeEvidence('plan') })
  expect(sourceReads(f)).toBe(1)
})

it('retains concurrent submission and refresh writes and discards both contradicted and conflicted fallbacks', async () => {
  const f = fixture()
  const profile = process.env.CODEXUI_CONNECTION_PROFILE!
  const concurrentBackend = new RolloutGenerationMetadata(f.client)
  f.files.set(path, f.files.get(path)! + modeStart('old', 'default') + modeStart('conflict', 'default') + modeContext('conflict', 'plan'))
  const [rollout] = await Promise.all([
    f.service.recover('t'),
    concurrentBackend.rememberSubmittedMode('t', 'old', 'plan', profile),
    concurrentBackend.rememberSubmittedMode('t', 'conflict', 'plan', profile),
    f.service.rememberSubmittedMode('t', 'new', 'plan', profile),
    f.service.rememberSubmittedMode('t', 'default', 'default', profile),
  ])
  expect(rollout.get('conflict')).toEqual(modeEvidence(null))
  expect(rollout.get('old')).toEqual({ ...execution('A', 'high'), ...modeEvidence('default') })
  const persisted = JSON.parse(await readFile(cachePath(), 'utf8'))
  expect(persisted.submittedModes).toEqual({ new: 'plan', default: 'default' })
  expect(persisted.turns.map((row: { turnId: string }) => row.turnId)).toEqual(['old', 'new', 'conflict'])
  const unavailable = new RolloutGenerationMetadata({ ...f.client, rpc: async () => { throw new Error('offline rollout') } })
  expect([...await unavailable.recover('t')]).toEqual([
    ['new', modeEvidence('plan', 'submitted')], ['default', modeEvidence('default', 'submitted')],
  ])
})

it('persists only the explicit mode on native acceptance without a metadata or history RPC', async () => {
  const f = fixture()
  const instance = new AppServerClient()
  vi.spyOn(instance as any, 'ensureInitialized').mockResolvedValue(undefined)
  const call = vi.spyOn(instance as any, 'callObserved')
    .mockResolvedValueOnce({ turn: { id: 'exact' } })
    .mockRejectedValueOnce(new Error('rejected'))
    .mockResolvedValueOnce({ turn: {} })
  const listener = vi.fn()
  instance.onNotification(listener)
  const params = { threadId: 't', collaborationMode: { mode: 'plan' }, model: 'sent-model', effort: 'none' }
  try {
    expect(await instance.rpc('turn/start', params)).toEqual({ turn: { id: 'exact' } })
    expect(listener).toHaveBeenCalledWith({ method: 'turn/generationMetadata', params: {
      threadId: 't', turnId: 'exact', generationMetadata: modeEvidence('plan', 'submitted'),
    } })
    await expect(instance.rpc('turn/start', params)).rejects.toThrow('rejected')
    expect(await instance.rpc('turn/start', params)).toEqual({ turn: {} })
    expect(call.mock.calls.map(([method]) => method)).toEqual(['turn/start', 'turn/start', 'turn/start'])
    expect(JSON.parse(await readFile(cachePath(), 'utf8'))).toEqual({ version: 2, submittedModes: { exact: 'plan' } })
  } finally { instance.dispose() }
})

it('publishes local modes for exact page and retained turns while the remote rollout queue is saturated', async () => {
  const f = fixture()
  const profile = process.env.CODEXUI_CONNECTION_PROFILE!
  await f.service.rememberSubmittedMode('t', 'old', 'plan', profile)
  await f.service.rememberSubmittedMode('t', 'new', 'plan', profile)
  await f.service.rememberSubmittedMode('t', 'unrequested', 'plan', profile)
  const instance = new AppServerClient()
  const service = Reflect.get(instance, 'rolloutMetadata') as RolloutGenerationMetadata
  const readSubmittedModes = vi.spyOn(service, 'readSubmittedModes')
  vi.spyOn(instance, 'resolveCodexHome').mockResolvedValue('/remote/.codex')
  vi.spyOn(instance as any, 'ensureInitialized').mockResolvedValue(undefined)
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  const call = vi.spyOn(instance as any, 'callObserved').mockImplementation(async (method: any, params: any) => {
    if (method === 'thread/turns/list') return { data: [{ id: 'new', items: [] }] }
    if (method === 'fs/readFile') await blocked
    return f.rpc(method, params)
  })
  const notify = vi.fn()
  instance.onNotification(notify)
  try {
    const queued = Array.from({ length: 16 }, (_, index) => service.recover('blocked-' + index))
    await vi.waitFor(() => expect(call.mock.calls.some(([method]) => method === 'fs/readFile')).toBe(true))
    const before = call.mock.calls.length
    await Promise.all([
      instance.rpc('thread/turns/list', { threadId: 't' }),
      instance.rpc('thread/turns/list', { threadId: 't' }, ['old']),
    ])
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2))
    expect(readSubmittedModes).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls.map(([event]) => [event.params.turnId, event.params.generationMetadata])).toEqual([
      ['new', modeEvidence('plan', 'submitted')], ['old', modeEvidence('plan', 'submitted')],
    ])
    expect(call.mock.calls.slice(before).map(([method]) => method)).toEqual(['thread/turns/list', 'thread/turns/list'])
    release()
    await Promise.all(queued)
  } finally { release(); instance.dispose() }
})

it('clears a recovered badge on a later contradiction and prevents a delayed cache snapshot from restoring it', async () => {
  const f = fixture()
  const profile = process.env.CODEXUI_CONNECTION_PROFILE!
  await f.service.rememberSubmittedMode('t', 'old', 'plan', profile)
  const instance = new AppServerClient()
  const service = Reflect.get(instance, 'rolloutMetadata') as RolloutGenerationMetadata
  vi.spyOn(instance, 'resolveCodexHome').mockResolvedValue('/remote/.codex')
  vi.spyOn(instance as any, 'ensureInitialized').mockResolvedValue(undefined)
  let releaseRollout!: () => void
  const blocked = new Promise<void>(resolve => { releaseRollout = resolve })
  const call = vi.spyOn(instance as any, 'callObserved').mockImplementation(async (method: any, params: any) => {
    if (method === 'thread/turns/list') return { data: [{ id: 'old', items: [] }] }
    if (method === 'fs/readFile') await blocked
    return f.rpc(method, params)
  })
  const notify = vi.fn()
  instance.onNotification(notify)
  const page = () => instance.rpc('thread/turns/list', { threadId: 't' })
  try {
    await page()
    await vi.waitFor(() => expect(notify).toHaveBeenCalledExactlyOnceWith({
      method: 'turn/generationMetadata', params: { threadId: 't', turnId: 'old', generationMetadata: modeEvidence('plan', 'submitted') },
    }))
    await vi.waitFor(() => expect(call.mock.calls.some(([method]) => method === 'fs/readFile')).toBe(true))
    const captured = await service.readSubmittedModes('t', profile)
    let releaseLocal!: (value: typeof captured) => void
    vi.spyOn(service, 'readSubmittedModes').mockImplementationOnce(() => new Promise(resolve => { releaseLocal = resolve }))
    await page()
    f.files.set(path, f.files.get(path)! + modeStart('old', 'default') + modeContext('old', 'plan'))
    releaseRollout()
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith({
      method: 'turn/generationMetadata', params: { threadId: 't', turnId: 'old', generationMetadata: { ...execution('A', 'high'), ...modeEvidence(null) } },
    }))
    releaseLocal(captured)
    await vi.waitFor(() => expect(Reflect.get(instance, 'submittedModeRequests').size).toBe(0))
    expect(notify).toHaveBeenCalledTimes(2)
    expect(await service.readSubmittedModes('t', profile)).toEqual(new Map())
    expect(call.mock.calls.map(([method]) => method)).toEqual([
      'thread/turns/list', 'thread/read', 'fs/getMetadata', 'fs/readFile', 'thread/turns/list', 'fs/getMetadata',
    ])
  } finally { releaseRollout(); instance.dispose() }
})
