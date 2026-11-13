import { afterEach, expect, it, vi } from 'vitest'
import { getAvailableModelIds, startThread, startThreadTurn, reasoningCatalog } from './codexGateway'
import { modelSelectionKey as key } from './modelCapabilities'

const response = (result: unknown) => new Response(JSON.stringify({ result }))
afterEach(() => { vi.unstubAllGlobals(); reasoningCatalog.value = [] })

it('walks independent paginated catalogs, preserves duplicate IDs and isolates failed providers', async () => {
  const calls: Array<{ method: string; params: Record<string, string> }> = []
  let active = 0
  let maximum = 0
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    active++; maximum = Math.max(maximum, active)
    const body = JSON.parse(init.body); calls.push(body)
    await Promise.resolve(); active--
    if (body.method === 'modelProvider/list') return response({ providers: [
      { id: 'cloud', displayName: 'Cloud', isDefault: true }, { id: 'offline' }, { id: 'local', displayName: 'Local' },
    ] })
    if (body.params.modelProvider === 'offline') throw new Error('offline')
    if (body.params.cursor) return response({ data: [{ id: 'second' }] })
    return response({ data: [{ id: 'same', displayName: 'Shared', supportedReasoningEfforts: ['low'], defaultReasoningEffort: 'low' }],
      nextCursor: body.params.modelProvider === 'cloud' ? 'next' : null })
  }))
  const catalog = await getAvailableModelIds()
  expect(catalog.ids).toEqual([key('cloud', 'same'), key('cloud', 'second'), key('local', 'same')])
  expect(catalog.defaultProvider).toBe('cloud')
  expect(catalog.failures).toEqual(['offline'])
  expect(catalog.models[2]).toMatchObject({ modelProvider: 'local', providerDisplayName: 'Local', defaultReasoningEffort: 'low' })
  expect(calls.map((c) => c.params)).toEqual([{}, { modelProvider: 'cloud' }, { modelProvider: 'cloud', cursor: 'next' }, { modelProvider: 'offline' }, { modelProvider: 'local' }])
  expect(maximum).toBe(1)
})

it.each(['modelProvider/list', 'model/list'])('falls back when %s is unsupported', async (unsupported) => {
  const calls: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body)
    if (body.method === unsupported && (unsupported === 'modelProvider/list' || body.params.modelProvider)) {
      return new Response('Invalid params: method not found', { status: 400 })
    }
    return response(body.method === 'modelProvider/list' ? { data: [{ id: 'provider' }] } : { data: [{ id: 'legacy' }] })
  }))
  expect(await getAvailableModelIds()).toEqual({ ids: ['legacy'], models: [{ id: 'legacy' }] })
  expect(calls.at(-1)).toEqual({ method: 'model/list', params: {} })
})

it.each(['cloud', 'local'])('sends provider %s on thread creation and only the raw model on turns', async (provider) => {
  const calls: any[] = []
  reasoningCatalog.value = [{ id: 'same', modelProvider: provider, supportedReasoningEfforts: ['low'], defaultReasoningEffort: 'low' }]
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body)
    return response(body.method === 'thread/start' ? { thread: { id: 'new' }, model: 'same', modelProvider: provider } : { turn: { id: 'turn' } })
  }))
  expect((await startThread('/workspace', key(provider, 'same'))).modelProvider).toBe(provider)
  await startThreadTurn('new', 'hello', [], key(provider, 'same'), 'high', undefined, [], 'default')
  expect(calls[0].params).toEqual({ cwd: '/workspace', model: 'same', modelProvider: provider })
  expect(calls[1].params).toMatchObject({ model: 'same', effort: 'low', collaborationMode: { settings: { model: 'same' } } })
  expect(calls[1].params).not.toHaveProperty('modelProvider')
})

it('submits raw model IDs and supported effort from a legacy providerless catalog', async () => {
  const calls: any[] = []
  reasoningCatalog.value = [{ id: 'b', supportedReasoningEfforts: ['low'], defaultReasoningEffort: 'low' }]
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    calls.push(JSON.parse(init.body))
    return response({ turn: { id: 'next' } })
  }))
  await startThreadTurn('existing', 'hello', [], key('openai', 'b'), 'high', undefined, [], 'default')
  expect(calls).toHaveLength(1)
  expect(calls[0].params).toMatchObject({ threadId: 'existing', model: 'b', effort: 'low', collaborationMode: { settings: { model: 'b', reasoning_effort: 'low' } } })
})
