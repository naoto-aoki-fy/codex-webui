import { afterEach, expect, it, vi } from 'vitest'
import { RolloutGenerationMetadata, parseRolloutMetadata, rolloutSourcePath } from './rolloutGenerationMetadata'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { profileStorageDirectory } from './connectionProfile'
import { storageNames } from './webuiStorage.mjs'
import { AppServerClient } from './appServerClient'
import { mergeGenerationMetadata } from '../turnGenerationMetadata'

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
    if (method === 'thread/read') return { thread: { id: 't', path } }
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
  expect(Object.keys(JSON.parse(cache))).toEqual(['version', 'sourcePath', 'modifiedAtMs', 'turns'])
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
  for (const field of [{ version: 2 }, { sourcePath: '/wrong' }]) {
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
