import { afterEach, expect, it, vi } from 'vitest'
import { getAvailableModelIds, startThread, startThreadTurn, reasoningCatalog } from './codexGateway'
import { modelSelectionKey as key } from './modelCapabilities'

const response = (result: unknown) => new Response(JSON.stringify({ result }))
afterEach(() => { vi.unstubAllGlobals(); reasoningCatalog.value = [] })

it('walks remote provider catalogs, preserves duplicate IDs and isolates failed providers', async () => {
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
    if (body.params.provider === 'offline') throw new Error('offline')
    return response({ data: [{ id: 'same', displayName: 'Shared', supportedReasoningEfforts: ['low'], defaultReasoningEffort: 'low' }],
      nextCursor: null })
  }))
  const catalog = await getAvailableModelIds()
  expect(catalog.ids).toEqual([key('cloud', 'same'), key('local', 'same')])
  expect(catalog.defaultProvider).toBe('cloud')
  expect(catalog.failures).toEqual(['offline'])
  expect(catalog.models[1]).toMatchObject({ modelProvider: 'local', providerDisplayName: 'Local', defaultReasoningEffort: 'low' })
  expect(calls.map((c) => c.params)).toEqual([{}, { provider: 'cloud' }, { provider: 'offline' }, { provider: 'local' }])
  expect(maximum).toBe(1)
})

it.each(['modelProvider/list', 'model/providerCatalog'])('falls back when %s is unsupported', async (unsupported) => {
  const calls: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body)
    if (body.method === unsupported && (unsupported === 'modelProvider/list' || body.params.provider)) {
      return new Response('Invalid params: method not found', { status: 400 })
    }
    return response(body.method === 'modelProvider/list' ? { data: [{ id: 'provider' }] } : { data: [{ id: 'legacy' }] })
  }))
  expect(await getAvailableModelIds()).toMatchObject({ ids: ['legacy'], models: [{ id: 'legacy' }] })
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

it('uses explicit remote config providers when enumeration is unsupported', async () => {
  const calls: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body)
    if (body.method === 'modelProvider/list') return new Response('Method not found', { status: 400 })
    if (body.method === 'config/read') return response({ config: { model_provider: 'active', model_providers: { local: { name: 'Local' } } } })
    return response({ data: [{ id: 'same' }] })
  }))
  expect((await getAvailableModelIds()).ids).toEqual([key('local', 'same'), key('active', 'same')])
  expect(calls.slice(2)).toEqual([{ method: 'model/providerCatalog', params: { provider: 'local' } },
    { method: 'model/providerCatalog', params: { provider: 'active' } }])
})

it('does not fall back to unrelated models after a partial success', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.method === 'modelProvider/list') return response({ data: [{ id: 'ok' }, { id: 'old' }], defaultProviderId: 'ok' })
    if (body.params.provider === 'old') return new Response('Method not found', { status: 400 })
    expect(body.method).toBe('model/providerCatalog')
    return response({ data: [{ id: 'visible' }, { id: 'internal', hidden: true }] })
  }))
  expect(await getAvailableModelIds()).toMatchObject({ ids: [key('ok', 'visible')], failures: ['old'], defaultProvider: 'ok' })
})

it('retains configured defaults scoped to each provider instead of a source model', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.method === 'modelProvider/list') return response({ data: [{ id: 'P', defaultModel: 'source-default' }, { id: 'Q', defaultModel: 'destination-default' }] })
    return response({ data: [{ id: 'shared' }, { id: 'destination-default' }] })
  }))
  const catalog = await getAvailableModelIds()
  expect(catalog.models.filter(m => m.modelProvider === 'Q').every(m => m.providerDefaultModel === 'destination-default')).toBe(true)
  expect(catalog.models.filter(m => m.modelProvider === 'P').every(m => m.providerDefaultModel === 'source-default')).toBe(true)
})
