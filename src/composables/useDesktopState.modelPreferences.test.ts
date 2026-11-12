import { computed } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reasoningCatalog } from '../api/codexGateway'
import { useDesktopState } from './useDesktopState'

vi.mock('../api/codexGateway', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/codexGateway')>(),
  getCurrentModelConfig: vi.fn(async () => ({ model: 'A', speedMode: 'standard', reasoningEffort: 'medium' })),
  getAvailableModelIds: vi.fn(async () => ({ ids: ['A', 'B'], models: reasoningCatalog.value })),
  getThreadGroupsPage: vi.fn(async () => ({ groups: [], nextCursor: null })),
  getWorkspaceRootsState: vi.fn(async () => ({ order: [], labels: {}, active: [], projectOrder: [] })),
  getThreadTitleCache: vi.fn(async () => ({ titles: {} })),
  getAvailableCollaborationModes: vi.fn(async () => [{ value: 'default', label: 'Default' }]),
  getSkillsList: vi.fn(async () => []),
  getAccountRateLimits: vi.fn(async () => null),
}))

const modelKey = 'codex-web-local.selected-model-by-context.v1'
const effortKey = 'codex-web-local.reasoning-by-provider-model.v1'
let store: Map<string, string>
beforeEach(() => {
  store = new Map()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
    setTimeout: vi.fn(),
    clearTimeout: vi.fn(),
  })
  reasoningCatalog.value = [
    { id: 'A', supportedReasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'low' },
    { id: 'B', supportedReasoningEfforts: ['medium', 'high'], defaultReasoningEffort: 'medium' },
  ]
})
afterEach(() => {
  reasoningCatalog.value = []
  vi.unstubAllGlobals()
})

describe('persistent composer model preferences', () => {
  it('restores separate model efforts immediately and after recreating desktop state', () => {
    const state = useDesktopState()
    state.setSelectedModelIdForThread('', 'A')
    state.setSelectedReasoningEffort('high', '')
    state.setSelectedModelIdForThread('', 'B')
    expect(state.readReasoningEffortForThread('')).toBe('medium')
    state.setSelectedReasoningEffort('medium', '')
    state.setSelectedModelIdForThread('', 'A')
    expect(state.readReasoningEffortForThread('')).toBe('high')
    state.setSelectedModelIdForThread('', 'B')
    const reopened = useDesktopState()
    expect(reopened.readModelIdForThread('')).toBe('B')
    expect(reopened.readReasoningEffortForThread('')).toBe('medium')
    reopened.setSelectedModelIdForThread('', 'A')
    expect(reopened.readReasoningEffortForThread('')).toBe('high')
  })

  it('uses capability defaults for missing, corrupt, and unsupported preferences without rewriting storage', () => {
    store.set(effortKey, '{invalid')
    const state = useDesktopState()
    state.setSelectedModelIdForThread('', 'A')
    expect(state.readReasoningEffortForThread('')).toBe('low')
    store.set(effortKey, JSON.stringify({ '["codex","A"]': 'xhigh' }))
    const reopened = useDesktopState()
    expect(reopened.readReasoningEffortForThread('')).toBe('low')
    expect(store.get(effortKey)).toContain('xhigh')
  })

  it('resolves home reasoning against its own model while another thread is selected', () => {
    const state = useDesktopState()
    state.setSelectedModelIdForThread('existing-thread', 'A')
    state.primeSelectedThread('existing-thread')
    state.setSelectedReasoningEffort('high', 'existing-thread')
    state.setSelectedModelIdForThread('__new-thread__', 'B')
    expect(state.readReasoningEffortForThread('__new-thread__')).toBe('medium')
    expect(state.readReasoningOptionsForThread('__new-thread__').map((option) => option.value)).toEqual(['medium', 'high'])
    expect(state.readReasoningEffortForThread('existing-thread')).toBe('high')
  })

  it('keeps saved choices during catalog fallback and restores them when available again', async () => {
    store.set(modelKey, JSON.stringify({ '__new-thread-provider__::codex': 'unavailable' }))
    store.set(effortKey, JSON.stringify({ '["codex","unavailable"]': 'high' }))
    const state = useDesktopState()
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
    expect(state.readModelIdForThread('')).toBe('A')
    expect(JSON.parse(store.get(modelKey)!)).toEqual({ '__new-thread-provider__::codex': 'unavailable' })
    expect(store.get(effortKey)).toContain('high')
    const { getAvailableModelIds } = await import('../api/codexGateway')
    vi.mocked(getAvailableModelIds).mockResolvedValueOnce({ ids: ['A', 'unavailable'], models: [
      { id: 'unavailable', supportedReasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'low' },
    ] })
    await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
    expect(state.readModelIdForThread('')).toBe('unavailable')
    expect(state.readReasoningEffortForThread('')).toBe('high')
  })
})

it('updates the displayed model when the Codex catalog arrives after the composer mounts', async () => {
  const state = useDesktopState()
  const displayed = computed(() => state.readModelIdForThread(''))
  expect(displayed.value).toBe('')
  await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
  expect(displayed.value).toBe('A')
})

const usageKey = 'codex-web-local.model-usage-order.v1'

it('orders explicit selections across contexts and persists without changing selection or efforts', async () => {
  const state = useDesktopState()
  await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
  state.setSelectedModelIdForThread('', 'B')
  state.setSelectedReasoningEffort('high', '')
  state.setSelectedModelIdForThread('existing', 'A')
  expect(state.availableModelIds.value).toEqual(['A', 'B'])
  state.setSelectedModelIdForThread('existing', 'B')
  expect(state.availableModelIds.value).toEqual(['B', 'A'])
  const reopened = useDesktopState()
  await reopened.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
  expect(reopened.availableModelIds.value).toEqual(['B', 'A'])
  expect(reopened.readReasoningEffortForThread('')).toBe('high')
  const stored = store.get(usageKey)
  reopened.primeSelectedThread('existing')
  await reopened.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
  expect(store.get(usageKey)).toBe(stored)
})

it.each(['{invalid', '{}', 'null', '[1,null,"", "B", "B", "missing"]'])('handles stored usage %s and preserves unused catalog order', async (raw) => {
  store.set(usageKey, raw)
  const state = useDesktopState()
  await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
  expect(state.availableModelIds.value).toEqual(raw.includes('"B"') ? ['B', 'A'] : ['A', 'B'])
  expect(store.get(usageKey)).toBe(raw)
})

it('records the model actually submitted in an existing thread', async () => {
  const gateway = await import('../api/codexGateway')
  const resume = vi.spyOn(gateway, 'resumeThread').mockResolvedValue({ model: 'A' } as Awaited<ReturnType<typeof gateway.resumeThread>>)
  const start = vi.spyOn(gateway, 'startThreadTurn').mockRejectedValue(new Error('test submission'))
  const state = useDesktopState()
  state.setSelectedModelIdForThread('existing', 'A')
  state.setSelectedModelIdForThread('', 'B')
  state.primeSelectedThread('existing')
  await expect(state.sendMessageToSelectedThread('MRU test')).rejects.toThrow('test submission')
  expect(JSON.parse(store.get(usageKey)!)).toEqual(['A', 'B'])
  expect(start).toHaveBeenCalled()
  resume.mockRestore()
  start.mockRestore()
})

it('keeps selected-thread and home automatic fallbacks separate without rewriting explicit preferences', async () => {
  const state = useDesktopState()
  state.setSelectedModelIdForThread('existing', 'missing-thread-model')
  state.setSelectedModelIdForThread('', 'B')
  state.primeSelectedThread('existing')
  const saved = store.get(modelKey)
  const usage = store.get(usageKey)
  await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
  expect(state.readModelIdForThread('existing')).toBe('A')
  expect(state.selectedModelId.value).toBe('A')
  expect(state.readModelIdForThread('')).toBe('B')
  expect(store.get(modelKey)).toBe(saved)
  expect(store.get(usageKey)).toBe(usage)
})

it('persists pairs and scopes reasoning independently for duplicate model IDs', async () => {
  const { modelSelectionKey: key } = await import('../api/modelCapabilities')
  reasoningCatalog.value = [
    { id: 'same', modelProvider: 'cloud', supportedReasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'low' },
    { id: 'same', modelProvider: 'local', supportedReasoningEfforts: ['medium'], defaultReasoningEffort: 'medium' },
  ]
  const state = useDesktopState()
  state.setSelectedModelIdForThread('', key('cloud', 'same'))
  state.setSelectedReasoningEffort('high', '')
  state.setSelectedModelIdForThread('', key('local', 'same'))
  expect(state.readReasoningEffortForThread('')).toBe('medium')
  const reopened = useDesktopState()
  expect(reopened.readModelIdForThread('')).toBe(key('local', 'same'))
  reopened.setSelectedModelIdForThread('', key('cloud', 'same'))
  expect(reopened.readReasoningEffortForThread('')).toBe('high')
})

it('retains unavailable provider preferences and prevents cross-provider changes to restored threads', async () => {
  const gateway = await import('../api/codexGateway')
  const { modelSelectionKey: key } = await import('../api/modelCapabilities')
  const state = useDesktopState()
  state.setSelectedModelIdForThread('', key('offline', 'same'))
  await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
  expect(state.readModelIdForThread('')).toBe(key('offline', 'same'))
  const resume = vi.spyOn(gateway, 'resumeThread').mockResolvedValue({ model: 'same', modelProvider: 'cloud' } as Awaited<ReturnType<typeof gateway.resumeThread>>)
  const turn = vi.spyOn(gateway, 'startThreadTurn').mockRejectedValue(new Error('stop'))
  state.primeSelectedThread('existing')
  await expect(state.sendMessageToSelectedThread('restore')).rejects.toThrow('stop')
  expect(state.readModelIdForThread('existing')).toBe(key('cloud', 'same'))
  state.setSelectedModelIdForThread('existing', key('local', 'same'))
  expect(state.readModelIdForThread('existing')).toBe(key('cloud', 'same'))
  expect(state.error.value).toContain('Start a new thread')
  expect(state.readModelIdForThread('')).toBe(key('offline', 'same'))
  resume.mockRestore(); turn.mockRestore()
})

it('starts new threads with either selected provider without changing the next draft during restoration', async () => {
  const gateway = await import('../api/codexGateway')
  const { modelSelectionKey: key } = await import('../api/modelCapabilities')
  const start = vi.spyOn(gateway, 'startThread')
  const turn = vi.spyOn(gateway, 'startThreadTurn').mockResolvedValue('turn')
  const state = useDesktopState()
  for (const provider of ['cloud', 'local']) {
    state.setSelectedModelIdForThread('', key(provider, 'same'))
    start.mockResolvedValueOnce({ threadId: `${provider}-thread`, model: 'same', modelProvider: provider })
    await state.sendMessageToNewThread('hello', '/workspace')
    expect(start).toHaveBeenLastCalledWith('/workspace', 'same', provider)
    expect(state.readModelIdForThread(`${provider}-thread`)).toBe(key(provider, 'same'))
  }
  expect(state.readModelIdForThread('cloud-thread')).toBe(key('cloud', 'same'))
  expect(state.readModelIdForThread('')).toBe(key('local', 'same'))
  start.mockRestore(); turn.mockRestore()
})

it('binds legacy single-provider catalogs to the server configuration and migrates effort in memory', async () => {
  const gateway = await import('../api/codexGateway')
  const config = vi.mocked(gateway.getCurrentModelConfig)
  config.mockResolvedValueOnce({ model: 'A', modelProvider: 'configured', speedMode: 'standard', reasoningEffort: '' })
  store.set(modelKey, JSON.stringify({ '__new-thread-provider__::codex': 'A' }))
  store.set(effortKey, JSON.stringify({ '["codex","A"]': 'high' }))
  const state = useDesktopState()
  await state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
  expect(state.readModelIdForThread('')).toBe('provider-model:["configured","A"]')
  expect(state.readReasoningEffortForThread('')).toBe('high')
  expect(JSON.parse(store.get(modelKey)!)).toEqual({ '__new-thread-provider__::codex': 'A' })
})

it('does not publish a stale refresh over a newer explicit provider selection', async () => {
  const gateway = await import('../api/codexGateway')
  let resolve!: (value: Awaited<ReturnType<typeof gateway.getAvailableModelIds>>) => void
  vi.mocked(gateway.getAvailableModelIds).mockReturnValueOnce(new Promise((yes) => { resolve = yes }))
  const state = useDesktopState()
  const refresh = state.refreshAll({ includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true })
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
  state.setSelectedModelIdForThread('', 'provider-model:["local","same"]')
  resolve({ ids: ['A'], models: [{ id: 'A' }] })
  await refresh
  expect(state.readModelIdForThread('')).toBe('provider-model:["local","same"]')
})
