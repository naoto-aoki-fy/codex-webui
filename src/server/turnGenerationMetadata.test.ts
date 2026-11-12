import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, readdir, appendFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { TurnGenerationMetadataStore } from './turnGenerationMetadata'
import { AppServerClient } from './appServerClient'
import { inheritForkTurnMetadata } from './forkGenerationMetadata'
import { generationMetadataLabel, mergeGenerationMetadata, readGenerationMetadata, submittedGenerationMetadata } from '../turnGenerationMetadata'

let home: string
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'turn-metadata-')); vi.stubEnv('CODEX_HOME', home) })
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(home, { recursive: true, force: true }) })
const sent = (model = 'A', effort: string | null = 'high') => submittedGenerationMetadata({ model, effort })
function client(endpoint = 'ws://127.0.0.1:4500', remoteHome = '/remote/codex') {
  vi.stubEnv('CODEXUI_APP_SERVER_URL', endpoint)
  const rpc = vi.fn()
  const instance = new AppServerClient({ threadIndex: { call: (m, p) => rpc(m, p) } })
  vi.spyOn(instance as any, 'ensureInitialized').mockResolvedValue(undefined)
  vi.spyOn(instance, 'getInitializationMetadata').mockReturnValue({ codexHome: remoteHome } as any)
  return { instance, rpc }
}

it.each(['completed', 'inProgress'])('recovers mixed turns after refresh and backend restart (%s), including old-page turns', async status => {
  const a = client()
  a.rpc.mockResolvedValueOnce({ turn: { id: '1' } }).mockResolvedValueOnce({ turn: { id: '2' } })
  await a.instance.rpc('turn/start', { threadId: 't', model: 'A', effort: 'high' })
  await a.instance.rpc('turn/start', { threadId: 't', model: 'B', effort: 'none' })
  a.instance.dispose()
  const b = client()
  const turns = [{ id: '1', status, items: [] }, { id: '2', status, items: [] }, { id: 'unknown' }]
  b.rpc.mockResolvedValue({ thread: { id: 't', turns } })
  try {
    for (const method of ['thread/read', 'thread/resume']) {
      const result = await b.instance.rpc(method, { threadId: 't', includeTurns: true }) as any
      expect(result.thread.turns.map((t: any) => t.generationMetadata)).toEqual([sent('A'), sent('B', 'none'), undefined])
    }
    const page = await b.instance.readThreadForTurnPage('t') as any
    expect(page.thread.turns[0].generationMetadata).toEqual(sent('A'))
    await b.instance.readThreadForTurnPage('t')
    expect(b.rpc).toHaveBeenCalledTimes(3)
  } finally { b.instance.dispose() }
})

it('correlates concurrent clients by RPC turn IDs and never annotates an unrelated started notification', async () => {
  const a = client(), b = client()
  let resolve!: (v: unknown) => void
  a.rpc.mockReturnValue(new Promise(r => { resolve = r }))
  b.rpc.mockResolvedValue({ turn: { id: 'b' } })
  const listener = vi.fn(); a.instance.onNotification(listener)
  try {
    const pending = a.instance.rpc('turn/start', { threadId: 't', model: 'A', effort: null })
    await Promise.resolve()
    const frame = { method: 'turn/started', params: { threadId: 't', turn: { id: 'foreign' } } }
    ;(a.instance as any).emitNotification(frame)
    expect(listener).toHaveBeenCalledWith(frame)
    await b.instance.rpc('turn/start', { threadId: 't', model: 'B', effort: 'none' })
    resolve({ turn: { id: 'a' } }); await pending
    a.rpc.mockResolvedValue({ thread: { id: 't', turns: [{ id: 'a' }, { id: 'b' }] } })
    const result = await a.instance.rpc('thread/read', { threadId: 't' }) as any
    expect(result.thread.turns.map((t: any) => t.generationMetadata)).toEqual([sent('A', null), sent('B', 'none')])
  } finally { a.instance.dispose(); b.instance.dispose() }
})

it('keeps an accepted turn successful when persistence fails, without replay', async () => {
  const a = client(); a.rpc.mockResolvedValue({ turn: { id: 'accepted' } })
  await writeFile(join(home, 'codexapp-turn-metadata'), 'not a directory')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    await expect(a.instance.rpc('turn/start', { threadId: 't', model: 'A', effort: 'high' })).resolves.toMatchObject({ turn: { id: 'accepted', generationMetadata: sent() } })
    expect(a.rpc).toHaveBeenCalledTimes(1)
  } finally { a.instance.dispose() }
})

it('isolates external endpoints, remote homes, and threads', async () => {
  const a = new TurnGenerationMetadataStore(home, 'server-A/home1')
  await a.saveMany('t', [{ turnId: 'same', metadata: sent() }])
  for (const [identity, thread] of [['server-B/home1', 't'], ['server-A/home2', 't'], ['server-A/home1', 'other']]) {
    expect(await new TurnGenerationMetadataStore(home, identity).read(thread)).toEqual(new Map())
  }
})

it('tolerates missing, malformed, partial records and serializes concurrent writers', async () => {
  const a = new TurnGenerationMetadataStore(home, 'a'), b = new TurnGenerationMetadataStore(home, 'a')
  expect(await a.read('missing')).toEqual(new Map())
  await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).saveMany('t', [{ turnId: String(i), metadata: sent(String(i)) }])))
  const dir = join(home, 'codexapp-turn-metadata', (await readdir(join(home, 'codexapp-turn-metadata')))[0]!)
  const path = join(dir, (await readdir(dir))[0]!)
  await appendFile(path, 'bad\n{"turnId":"partial","metadata":')
  expect((await a.read('t')).size).toBe(12)
  await b.saveMany('t', [{ turnId: 'new', metadata: sent('new') }])
  expect((await a.read('t')).size).toBe(13)
})

it('imports legacy rows only with explicit binding and preserves execution evidence', async () => {
  const dir = join(home, 'codexapp-turn-metadata'); await mkdir(dir)
  const execution = readGenerationMetadata({ model: 'executed', modelSource: 'execution', effort: null, effortSource: 'execution' })!
  await writeFile(join(dir, createHash('sha256').update('t').digest('hex') + '.jsonl'), JSON.stringify({ turnId: '1', metadata: execution }) + '\nbad\n')
  expect(await new TurnGenerationMetadataStore(home, 'a').read('t')).toEqual(new Map())
  const store = new TurnGenerationMetadataStore(home, 'a', true)
  await store.saveMany('t', [{ turnId: '1', metadata: sent() }])
  expect((await store.read('t')).get('1')).toEqual(execution)
  expect(mergeGenerationMetadata(execution, sent())).toEqual(execution)
})

it('preserves unknown, null and none independently and rejects unproven metadata', () => {
  expect(submittedGenerationMetadata({})).toEqual({})
  expect(readGenerationMetadata({ model: 'unproven', effort: 'high' })).toBeUndefined()
  expect(generationMetadataLabel()).toBe('Model unknown · reasoning: unknown')
  expect(generationMetadataLabel(sent('A', null))).toContain('reasoning: unspecified (sent setting)')
  expect(generationMetadataLabel(sent('A', 'none'))).toContain('reasoning: none (sent setting)')
  expect(readGenerationMetadata({ model: null, modelSource: 'submitted' })).toEqual({ model: null, modelSource: 'submitted' })
})

it('durably inherits mixed fork settings by stable IDs while new fork turns stay independent', async () => {
  const a = client()
  const store = (a.instance as any).metadataStore() as TurnGenerationMetadataStore
  await store.saveMany('source', [{ turnId: '1', metadata: sent() }, { turnId: '2', metadata: sent('B', 'none') }])
  a.rpc.mockImplementation(async (method: string) => ({ thread: { id: method === 'thread/fork' ? 'fork' : 'source', turns: [{ id: '1' }, { id: '2' }] } }))
  try {
    const result = await a.instance.rpc('thread/fork', { threadId: 'source' }) as any
    expect(result.thread.turns.map((t: any) => t.generationMetadata)).toEqual([sent(), sent('B', 'none')])
    expect((await store.read('fork')).get('2')).toEqual(sent('B', 'none'))
    await store.saveMany('fork', [{ turnId: '3', metadata: sent('C', 'low') }])
    expect((await store.read('source')).has('3')).toBe(false)
  } finally { a.instance.dispose() }
})

it('matches changed IDs only with unique item IDs or complete unique transcripts', () => {
  const turn = (id: string, item: string) => ({ id, items: [{ id: item, type: 'userMessage', content: [{ type: 'text', text: 'question' }] }, { id: item + 'a', type: 'agentMessage', text: 'answer' }], generationMetadata: sent() })
  expect(inheritForkTurnMetadata([turn('s', 'i')], [{ id: 'd', items: [{ id: 'i' }] }]).entries).toHaveLength(1)
  expect(inheritForkTurnMetadata([turn('s', 'i')], [turn('d', 'j')]).entries).toHaveLength(0) // destination already has the same evidence
  const destination = { ...turn('d', 'j'), generationMetadata: undefined }
  expect(inheritForkTurnMetadata([turn('s', 'i')], [destination]).entries).toHaveLength(1)
  expect(inheritForkTurnMetadata([turn('s', 'i'), turn('s2', 'k')], [destination]).entries).toHaveLength(0)
})

it('bounds large sidecars and measures cold/warm batched history enrichment', async () => {
  const store = new TurnGenerationMetadataStore(home, 'performance')
  const entries = Array.from({ length: 2000 }, (_, i) => ({ turnId: String(i), metadata: sent(i % 2 ? 'A' : 'B', i % 2 ? 'high' : 'none') }))
  await store.saveMany('t', entries)
  const turns = entries.map(entry => ({ id: entry.turnId }))
  const before = performance.now()
  expect(await store.enrich('t', turns)).toHaveLength(2000)
  const cold = performance.now() - before
  const warmStart = performance.now()
  expect(await store.enrich('t', turns.slice(0, 10))).toHaveLength(10)
  process.stdout.write(`Metadata audit: 2000-turn cold=${cold.toFixed(2)}ms; cached 10-turn page=${(performance.now() - warmStart).toFixed(2)}ms; zero RPCs\n`)
  const dir = join(home, 'codexapp-turn-metadata', (await readdir(join(home, 'codexapp-turn-metadata')))[0]!)
  const path = join(dir, (await readdir(dir))[0]!)
  await writeFile(path, 'x'.repeat(4 * 1024 * 1024 + 1))
  expect(await store.read('t')).toEqual(new Map())
})

it('normalizes each assistant item with its own turn metadata, including older-page offsets', async () => {
  const { normalizeThreadMessagesV2 } = await import('../api/normalizers/v2')
  const payload = { thread: { id: 't', turns: [
    { id: '1', generationMetadata: sent(), items: [{ id: 'u', type: 'userMessage', content: [{ type: 'text', text: 'question' }] }, { id: 'a', type: 'agentMessage', text: 'intermediate' }, { id: 'b', type: 'agentMessage', text: 'final' }] },
    { id: '2', generationMetadata: sent('B', 'none'), items: [{ id: 'c', type: 'agentMessage', text: 'next' }] },
    { id: '3', items: [{ id: 'd', type: 'agentMessage', text: 'unknown' }] },
  ] } }
  const messages = normalizeThreadMessagesV2(payload as any, 20)
  expect(messages.filter(m => m.role === 'assistant').map(m => [m.turnId, m.turnIndex, m.generationMetadata])).toEqual([
    ['1', 20, sent()], ['1', 20, sent()], ['2', 21, sent('B', 'none')], ['3', 22, undefined],
  ])
  expect(messages.find(m => m.role === 'user')?.generationMetadata).toBeUndefined()
})
