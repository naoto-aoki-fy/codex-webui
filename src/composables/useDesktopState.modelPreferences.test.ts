import { computed } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { emptyModelPreferences, preferenceModelKey, type ModelPreferences, type ModelSettings } from '../modelPreferences'
import { modelSelectionKey as key } from '../api/modelCapabilities'
import { rpcCall } from '../api/codexRpcClient'
import { reasoningCatalog, getAvailableModelIds, type RpcNotification } from '../api/codexGateway'
import { useDesktopState } from './useDesktopState'

vi.mock('./backendAuthentication', async importOriginal => {
  const actual = await importOriginal<typeof import('./backendAuthentication')>()
  return { createBackendAuthentication: () => {
    const auth = actual.createBackendAuthentication()
    auth.observe({ phase: 'ready', blocking: false, revision: 1 })
    return { ...auth, refresh: vi.fn(async () => {}) }
  } }
})
vi.mock('../api/codexRpcClient', async importOriginal => ({
  ...await importOriginal<typeof import('../api/codexRpcClient')>(), rpcCall: vi.fn(),
}))
const streams = new Set<(n: RpcNotification) => void>()
vi.mock('../api/codexGateway', async importOriginal => ({
  ...await importOriginal<typeof import('../api/codexGateway')>(),
  getCurrentModelConfig: vi.fn(async () => ({ model: 'A', modelProvider: 'openai', speedMode: 'standard', reasoningEffort: 'medium' })),
  getAvailableModelIds: vi.fn(),
  getThreadGroupsPage: vi.fn(async () => ({ groups: [{ projectName: 'project', threads: [{ id: 'existing', title: 'Existing', cwd: '/workspace', projectName: 'project', createdAtIso: '2026-11-16T00:00:00Z', updatedAtIso: '2026-11-16T00:00:00Z', preview: '', unread: false, inProgress: false, hasWorktree: false }] }], nextCursor: null })),
  getProjects: vi.fn(async () => []),
  getThreadTitleCache: vi.fn(async () => ({ titles: {} })),
  getAvailableCollaborationModes: vi.fn(async () => [{ value: 'default', label: 'Default' }, { value: 'plan', label: 'Plan' }]),
  getSkillsList: vi.fn(async () => []), getAccountRateLimits: vi.fn(async () => null),
  getPendingServerRequests: vi.fn(async () => []),
  subscribeCodexNotifications: vi.fn((cb: (n: RpcNotification) => void) => { streams.add(cb); return () => streams.delete(cb) }),
}))
const homeModelKey = 'codex-web-local.selected-model-by-context.v2.__new-thread-provider__%3A%3Acodex'
const homeExplicitModelKey = 'codex-web-local.explicit-model-contexts.v2.__new-thread-provider__%3A%3Acodex'
const homeModeKey = 'codex-web-local.collaboration-mode-by-context.v2.__new-thread__'
const existingModelKey = 'codex-web-local.selected-model-by-context.v2.existing'
const effortKey = 'codex-web-local.reasoning-by-provider-model.v1'
const usageKey = 'codex-web-local.model-usage-order.v1'
let local: Map<string, string>, backend: ModelPreferences
const states: ReturnType<typeof useDesktopState>[] = []
const settings = (modelId = 'B', providerId = 'openai'): ModelSettings => ({ providerId, modelId, reasoningEffort: 'high', collaborationMode: 'plan' })
const options = { includeSelectedThreadMessages: false, awaitAncillaryRefreshes: true }
function create() { const s = useDesktopState(); states.push(s); return s }
function notify() { for (const cb of streams) cb({ method: 'model-preferences/changed', params: structuredClone(backend), atIso: new Date().toISOString() }) }
beforeEach(() => {
  local = new Map(); backend = emptyModelPreferences()
  vi.stubGlobal('window', { localStorage: {
      get length() { return local.size }, key: (i: number) => [...local.keys()][i] ?? null,
    getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => local.set(k, v), removeItem: (k: string) => local.delete(k),
  }, setTimeout: vi.fn(), clearTimeout: vi.fn() })
  reasoningCatalog.value = [
    { id: 'A', modelProvider: 'openai', supportedReasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'low' },
    { id: 'B', modelProvider: 'openai', supportedReasoningEfforts: ['medium', 'high'], defaultReasoningEffort: 'medium' },
  ]
  vi.mocked(getAvailableModelIds).mockReset().mockImplementation(async () => ({ ids: [key('openai', 'A'), key('openai', 'B')], models: reasoningCatalog.value }))
  vi.mocked(rpcCall).mockReset().mockImplementation(async (method, payload) => {
    const p = payload as any
    if (method === 'model-preferences/update') {
      if (p.preferred) backend.preferred = p.preferred
      if (p.reasoning) backend.reasoningByModel[preferenceModelKey(p.reasoning.providerId, p.reasoning.modelId)] = p.reasoning.effort
      backend.revision++; notify()
    }
    return structuredClone(backend)
  })
})
afterEach(async () => {
  for (const state of states.splice(0)) { await state.settleModelPreferenceWrites(); state.stopPolling() }
  streams.clear(); reasoningCatalog.value = []; vi.unstubAllGlobals(); vi.restoreAllMocks()
})

it('restores the last accepted model, effort and collaboration mode in a fresh browser over stale local preferences', async () => {
  backend = { ...backend, revision: 4, lastUsed: settings(), preferred: settings('A') }
  local.set(homeModelKey, JSON.stringify(key('openai', 'A')))
  local.set(effortKey, JSON.stringify({ '["openai","B"]': 'medium' }))
  const state = create(), displayed = computed(() => state.readModelIdForThread(''))
  await state.refreshAll(options)
  expect(displayed.value).toBe(key('openai', 'B'))
  expect(state.readReasoningEffortForThread('')).toBe('high')
  expect(state.readCollaborationModeForThread('').toString()).toBe('plan')
  expect(vi.mocked(rpcCall).mock.calls.map(([m]) => m)).toEqual(['model-preferences/read'])
})

it('stores Home choices only on the backend and leaves prior browser entries untouched', async () => {
  local.set(homeModelKey, JSON.stringify(key('openai', 'B')))
  local.set(homeModeKey, JSON.stringify('plan'))
  const original = new Map(local)
  const state = create(); await state.refreshAll(options)
  expect(state.readModelIdForThread('')).toBe(key('openai', 'A'))
  expect(state.readCollaborationModeForThread('')).toBe('default')
  state.setSelectedModelIdForThread('', key('openai', 'B'))
  state.setSelectedCollaborationModeForThread('', 'plan')
  await state.settleModelPreferenceWrites()
  expect(backend.preferred).toMatchObject({ providerId: 'openai', modelId: 'B', collaborationMode: 'plan' })
  expect(local).toEqual(original)
  expect(local.has(homeExplicitModelKey)).toBe(false)
  state.setSelectedCollaborationModeForThread('existing', 'plan')
  expect(local.get('codex-web-local.collaboration-mode-by-context.v2.existing')).toBe('"plan"')
  expect(local.get(homeModeKey)).toBe(original.get(homeModeKey))
})

it('synchronizes two live sessions through revisioned notifications with no polling', async () => {
  const a = create(), b = create()
  await Promise.all([a.refreshAll(options), b.refreshAll(options)])
  a.startPolling(); b.startPolling()
  a.setSelectedModelIdForThread('', key('openai', 'B'))
  a.setSelectedReasoningEffort('high', '')
  await a.settleModelPreferenceWrites()
  expect(b.readModelIdForThread('')).toBe(key('openai', 'B'))
  expect(b.readReasoningEffortForThread('')).toBe('high')
  backend.lastUsed = settings('A'); backend.revision++
  backend.modelUsage[preferenceModelKey('openai', 'A')] = { providerId: 'openai', modelId: 'A', lastUsedAt: '2026-11-16T01:30:00.000Z', usageCount: 3 }
  notify()
  expect(b.readModelIdForThread('')).toBe(key('openai', 'A'))
  expect(a.readModelIdForThread('')).toBe(key('openai', 'B')) // Keep the unsent draft.
  a.restoreNewConversationPreferences()
  expect(a.readModelIdForThread('')).toBe(key('openai', 'A'))
  expect(b.readCollaborationModeForThread('')).toBe('default')
  expect(vi.mocked(rpcCall).mock.calls.filter(([m]) => m.endsWith('/read'))).toHaveLength(2)
})

it('preserves per-thread choices and the provider guard when shared defaults change', async () => {
  local.set(existingModelKey, JSON.stringify(key('openai', 'A')))
  const state = create(); await state.refreshAll(options); state.startPolling()
  state.setSelectedModelIdForThread('existing', key('openai', 'A'))
  state.setSelectedModelIdForThread('existing', key('other', 'A'))
  expect(state.error.value).toContain('Portable Transfer')
  backend.lastUsed = settings('B'); backend.revision++; notify()
  expect(state.readModelIdForThread('existing')).toBe(key('openai', 'A'))
  expect(state.readModelIdForThread('')).toBe(key('openai', 'B'))
  expect(JSON.parse(local.get(existingModelKey)!)).toBe(key('openai', 'A'))
})

it('keeps the full catalog, orders accepted usage, and never records usage on selection', async () => {
  backend.modelUsage[preferenceModelKey('openai', 'B')] = { providerId: 'openai', modelId: 'B', lastUsedAt: '2026-11-16T01:30:00.000Z', usageCount: 2 }
  const state = create(); await state.refreshAll(options)
  expect(state.availableModelIds.value).toEqual([key('openai', 'B'), key('openai', 'A')])
  state.setSelectedModelIdForThread('', key('openai', 'A')); await state.settleModelPreferenceWrites()
  expect(Object.values(backend.modelUsage)).toHaveLength(1)
  expect(local.has(usageKey)).toBe(false)
  expect(local.size).toBe(0)
})

it('restores an unavailable saved provider/model when it returns without replacing the saved preference', async () => {
  backend.lastUsed = settings('missing', 'offline')
  const state = create(); await state.refreshAll(options)
  expect(state.readModelIdForThread('')).toBe(key('openai', 'A'))
  expect(state.availableModelIds.value).not.toContain(key('offline', 'missing'))
  expect(backend.lastUsed).toEqual(settings('missing', 'offline'))
  vi.mocked(getAvailableModelIds).mockResolvedValueOnce({ ids: [key('openai', 'A'), key('offline', 'missing')], models: [{ id: 'missing', modelProvider: 'offline', supportedReasoningEfforts: ['high'], defaultReasoningEffort: 'high' }] })
  await state.refreshAll(options)
  expect(state.readModelIdForThread('')).toBe(key('offline', 'missing'))
  expect(state.readReasoningEffortForThread('')).toBe('high')
})

it('restores provider-specific efforts after recreation without writing global browser storage', async () => {
  const state = create(); await state.refreshAll(options)
  state.setSelectedReasoningEffort('high', '')
  state.setSelectedModelIdForThread('', key('openai', 'B'))
  state.setSelectedReasoningEffort('medium', '')
  await state.settleModelPreferenceWrites()
  const reopened = create(); await reopened.refreshAll(options)
  expect(reopened.readModelIdForThread('')).toBe(key('openai', 'B'))
  expect(reopened.readReasoningEffortForThread('')).toBe('medium')
  reopened.setSelectedModelIdForThread('', key('openai', 'A'))
  expect(reopened.readReasoningEffortForThread('')).toBe('high')
  expect(local.has(effortKey)).toBe(false)
})

it('uses capability defaults for unsupported saved effort without destroying it', async () => {
  backend.preferred = settings('A'); backend.reasoningByModel['["openai","A"]'] = 'xhigh'
  const state = create(); await state.refreshAll(options)
  expect(state.readReasoningEffortForThread('')).toBe('low')
  expect(backend.reasoningByModel['["openai","A"]']).toBe('xhigh')
})

it('recovers communication failures on reconnect and does not write stale browser defaults', async () => {
  backend.lastUsed = settings()
  const request = vi.mocked(rpcCall); request.mockRejectedValueOnce(new Error('offline'))
  const state = create(); await state.refreshAll(options)
  expect(state.modelPreferencesError.value).toContain('offline')
  state.startPolling()
  for (const cb of streams) cb({ method: 'ready', params: { reconnected: true }, atIso: new Date().toISOString() })
  await vi.waitFor(() => expect(state.readModelIdForThread('')).toBe(key('openai', 'B')))
  expect(state.modelPreferencesError.value).toBe('')
})


it('uses restored accepted settings when creating a new conversation', async () => {
  backend.lastUsed = settings()
  const gateway = await import('../api/codexGateway')
  const start = vi.spyOn(gateway, 'startThread').mockResolvedValue({ threadId: 'new', model: 'B', modelProvider: 'openai' })
  const turn = vi.spyOn(gateway, 'startThreadTurn').mockResolvedValue('accepted')
  const state = create(); await state.refreshAll(options)
  await state.sendMessageToNewThread('hello', '/workspace')
  await vi.waitFor(() => expect(turn).toHaveBeenCalled())
  expect(start).toHaveBeenCalledWith('/workspace', 'B', 'openai')
  expect(turn.mock.calls[0]?.slice(0, 9)).toEqual(['new', 'hello', [], key('openai', 'B'), 'high', undefined, [], 'default', 'standard'])
})

it('does not reorder usage or write browser state on rejected submissions', async () => {
  local.set(existingModelKey, JSON.stringify(key('openai', 'A')))
  const gateway = await import('../api/codexGateway')
  vi.spyOn(gateway, 'resumeThread').mockResolvedValue({ model: 'A', modelProvider: 'openai' } as Awaited<ReturnType<typeof gateway.resumeThread>>)
  vi.spyOn(gateway, 'startThreadTurn').mockRejectedValue(new Error('rejected'))
  const state = create(); await state.refreshAll(options); state.primeSelectedThread('existing')
  await expect(state.sendMessageToSelectedThread('no usage')).rejects.toThrow('rejected')
  expect(backend.modelUsage).toEqual({})
  expect(local.has(usageKey)).toBe(false)
})


it('isolates remembered reasoning for duplicate model IDs across providers', async () => {
  const models = [
    { id: 'same', modelProvider: 'codex', supportedReasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'low' },
    { id: 'same', modelProvider: 'openai', supportedReasoningEfforts: ['medium', 'high'], defaultReasoningEffort: 'medium' },
  ]
  reasoningCatalog.value = models
  vi.mocked(getAvailableModelIds).mockResolvedValue({ ids: [key('codex', 'same'), key('openai', 'same')], models })
  const state = create(); await state.refreshAll(options)
  state.setSelectedModelIdForThread('', key('codex', 'same')); state.setSelectedReasoningEffort('high', '')
  state.setSelectedModelIdForThread('', key('openai', 'same')); await state.settleModelPreferenceWrites()
  const reopened = create(); await reopened.refreshAll(options)
  expect(reopened.readModelIdForThread('')).toBe(key('openai', 'same'))
  expect(reopened.readReasoningEffortForThread('')).toBe('medium')
  expect(backend.reasoningByModel).toEqual({ [preferenceModelKey('codex', 'same')]: 'high' })
  reopened.setSelectedModelIdForThread('', key('codex', 'same'))
  expect(reopened.readReasoningEffortForThread('')).toBe('high')
})

it('keeps accepted Plan usage historical while restoring Default for subsequent composers', async () => {
  backend = { ...backend, revision: 4, lastUsed: settings(), preferred: settings('A') }
  const state = create()
  await state.refreshAll(options)
  state.setSelectedCollaborationModeForThread('existing', 'plan')
  state.resetSubmittedPlanMode('existing')
  await state.settleModelPreferenceWrites()
  expect(backend.lastUsed?.collaborationMode).toBe('plan')
  expect(backend.preferred).toEqual({ ...settings('A'), collaborationMode: 'default' })
  const reopened = create()
  await reopened.refreshAll(options)
  expect(reopened.readCollaborationModeForThread('')).toBe('default')
  expect(reopened.readModelIdForThread('')).toBe(key('openai', 'B'))
  expect(reopened.readReasoningEffortForThread('')).toBe('high')
  reopened.restoreNewConversationPreferences()
  expect(reopened.readCollaborationModeForThread('')).toBe('default')
})
