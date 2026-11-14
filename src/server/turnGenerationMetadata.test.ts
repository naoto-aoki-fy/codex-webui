import { expect, it } from 'vitest'
const sent = (model = 'A', effort: string | null = 'high') => ({ model, effort, modelSource: 'execution', effortSource: 'execution' })

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

it('does not record request or notification settings, read legacy sidecars, or copy source metadata on forks', async () => {
  const { AppServerClient } = await import('./appServerClient')
  const { mkdtemp, mkdir, writeFile, readFile, readdir, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { vi } = await import('vitest')
  const home = await mkdtemp(join(tmpdir(), 'no-runtime-metadata-'))
  vi.stubEnv('CODEX_HOME', home)
  const dir = join(home, 'codexapp-turn-metadata')
  await mkdir(dir)
  const legacy = '{"turnId":"same","metadata":{"model":"request-only","modelSource":"submitted"}}\n'
  await writeFile(join(dir, 'legacy.jsonl'), legacy)
  const wire = vi.fn(async (method: string) => method === 'turn/start' ? { turn: { id: 'same' } }
    : { thread: { id: method === 'thread/fork' ? 'fork' : 'source', turns: [{ id: 'same', items: [{ type: 'agentMessage', text: 'retained' }] }] } })
  const client = new AppServerClient({ threadIndex: { call: (m) => wire(m) } })
  vi.spyOn(client as any, 'ensureInitialized').mockResolvedValue(undefined)
  vi.spyOn(client as any, 'call').mockResolvedValue({ thread: {} })
  const listener = vi.fn(); client.onNotification(listener)
  try {
    expect(await client.rpc('turn/start', { threadId: 'source', model: 'selected', effort: 'high' })).toEqual({ turn: { id: 'same' } })
    ;(client as any).emitNotification({ method: 'turn/started', params: { threadId: 'source', turn: { id: 'same', model: 'selected' } } })
    const fork = await client.rpc('thread/fork', { threadId: 'source' }) as any
    expect(fork.thread.turns[0]).toEqual({ id: 'same', items: [{ type: 'agentMessage', text: 'retained' }] })
    expect(wire.mock.calls.map(([method]) => method)).toEqual(['turn/start', 'thread/fork'])
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(listener.mock.calls.some(([event]) => event.method === 'turn/generationMetadata')).toBe(false)
    expect(await readdir(dir)).toEqual(['legacy.jsonl'])
    expect(await readFile(join(dir, 'legacy.jsonl'), 'utf8')).toBe(legacy)
    expect(await readdir(home)).toEqual(['codexapp-turn-metadata'])
  } finally { client.dispose(); vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true }) }
})
