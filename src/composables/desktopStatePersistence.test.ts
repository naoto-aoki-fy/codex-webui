import { afterEach, describe, expect, it, vi } from 'vitest'
import * as persistence from './desktopStatePersistence'

function storage(values: Record<string, string> = {}) {
  const data = new Map(Object.entries(values))
  const mock = {
    get length() { return data.size }, key: (i: number) => [...data.keys()][i] ?? null,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { data.set(key, value) }),
    removeItem: vi.fn((key: string) => { data.delete(key) }),
  }
  vi.stubGlobal('window', { localStorage: mock })
  return mock
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('desktop persistence compatibility', () => {
  it('keeps every storage key and context derivation', () => {
    const keys = Object.entries(persistence).filter(([name]) => name.endsWith('_STORAGE_KEY'))
    expect(Object.fromEntries(keys)).toEqual({
      SELECTED_MODEL_BY_CONTEXT_STORAGE_KEY: 'codex-web-local.selected-model-by-context.v1',
      REASONING_BY_MODEL_STORAGE_KEY: 'codex-web-local.reasoning-by-provider-model.v1',
      LEGACY_SELECTED_MODEL_STORAGE_KEY: 'codex-web-local.selected-model-id.v1',
      COLLABORATION_MODE_STORAGE_KEY: 'codex-web-local.collaboration-mode-by-context.v1',
      LEGACY_COLLABORATION_MODE_STORAGE_KEY: 'codex-web-local.collaboration-mode.v1',
    })
    expect(persistence.toThreadContextId(' t ')).toBe('t')
    expect(persistence.toThreadContextId(' ')).toBe('__new-thread__')
    expect(persistence.NEW_THREAD_MODEL_CONTEXT).toBe('__new-thread-provider__::codex')
  })

  it('preserves model fallback, malformed versus unsupported data, and migration writes', () => {
    const mock = storage({ [persistence.LEGACY_SELECTED_MODEL_STORAGE_KEY]: ' legacy ' })
    expect(persistence.readSelectedModel(persistence.loadSelectedModelMap(), 'thread')).toBe('legacy')
    mock.setItem(persistence.SELECTED_MODEL_BY_CONTEXT_STORAGE_KEY, '{')
    expect(persistence.loadSelectedModelMap()['__new-thread__']).toBe('legacy')
    for (const raw of ['null', '[]', 'false', '42', '"model"']) {
      mock.setItem(persistence.SELECTED_MODEL_BY_CONTEXT_STORAGE_KEY, raw)
      expect(Object.keys(persistence.loadSelectedModelMap())).toEqual([])
    }
    mock.setItem(persistence.SELECTED_MODEL_BY_CONTEXT_STORAGE_KEY, '{"t":" m ","":"bad","x":4,"__proto__":" safe "}')
    const state = persistence.loadSelectedModelMap()
    expect(Object.getPrototypeOf(state)).toBeNull()
    expect(state.__proto__).toBe('safe')
    expect(persistence.readSelectedModel(state, ' t ')).toBe('m')
    persistence.saveSelectedModelMap(state)
    expect(persistence.loadSelectedModelMap()).toEqual(state)
    expect(mock.removeItem).not.toHaveBeenCalledWith(persistence.LEGACY_SELECTED_MODEL_STORAGE_KEY)
    persistence.saveSelectedModelMap({}, state)
    expect(persistence.loadSelectedModelMap()).toEqual({})
  })

  it('keeps context-specific collaboration and untrimmed reasoning preferences', () => {
    const mock = storage({
      [persistence.COLLABORATION_MODE_STORAGE_KEY]: '{"t":"plan","other":"default","__proto__":"plan"}',
      [persistence.LEGACY_COLLABORATION_MODE_STORAGE_KEY]: 'plan',
      [persistence.REASONING_BY_MODEL_STORAGE_KEY]: '{"codex::m":" high ","__proto__":"low","invalid":4}',
    })
    const state = persistence.loadSelectedCollaborationModeMap()
    expect(persistence.readSelectedCollaborationMode(state, 't')).toBe('plan')
    expect(persistence.readSelectedCollaborationMode(state, 'new')).toBe('default')
    expect(persistence.writeSelectedCollaborationModeForContext(state, '', 'plan')['__new-thread__']).toBe('plan')
    expect(persistence.writeSelectedCollaborationModeForContext(state, 'absent', 'default')).toBe(state)
    const next = persistence.writeSelectedCollaborationModeForContext(state, 't', 'default')
    expect(next).not.toBe(state)
    expect(next.t).toBeUndefined()
    persistence.saveSelectedCollaborationModeMap(next, state)
    expect(mock.removeItem).not.toHaveBeenCalledWith(persistence.LEGACY_COLLABORATION_MODE_STORAGE_KEY)
    const reasoning = persistence.loadReasoningPreferences()
    expect(Object.getPrototypeOf(reasoning)).toBeNull()
    expect(reasoning['codex::m']).toBe(' high ')
    expect(reasoning.__proto__).toBe('low')
    mock.removeItem(persistence.COLLABORATION_MODE_STORAGE_KEY)
    expect(Object.keys(persistence.loadSelectedCollaborationModeMap())).toEqual([])
  })

  it('preserves stored token numeric coercion, defaults and context calculations', () => {
    for (const value of [null, true, {}, [], '', ' ', 'NaN', Infinity]) {
      expect(persistence.normalizeStoredTokenCount(value)).toBeNull()
    }
    expect(persistence.normalizeStoredTokenCount(' 12.9 ')).toBe(12)
    expect(persistence.normalizeStoredTokenCount(-3.9)).toBe(0)
    expect(persistence.normalizeThreadTokenUsage({ total: {} })).toBeNull()
    expect(persistence.normalizeThreadTokenUsage({ total: [], last: {} })).toBeNull()
    const usage = persistence.normalizeThreadTokenUsage({ total: {}, last: { totalTokens: '25.9', input_tokens: 90 }, modelContextWindow: '100' })!
    expect(usage).toEqual({ total: { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 }, last: { totalTokens: 25, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 }, modelContextWindow: 100, currentContextTokens: 25, remainingContextTokens: 75, remainingContextPercent: 75 })
    expect(persistence.normalizeThreadTokenUsage({ total: {}, last: { totalTokens: 200 }, modelContextWindow: 100 })?.remainingContextPercent).toBe(0)
    expect(persistence.normalizeThreadTokenUsage({ total: {}, last: {} })?.remainingContextPercent).toBeNull()
  })

  const forgivingLoaders = [persistence.loadReasoningPreferences, persistence.loadSelectedCollaborationModeMap]
  it('keeps malformed and unsupported values harmless for forgiving loaders', () => {
    for (const raw of ['{', 'null', '42', 'true', '"text"']) {
      const mock = storage()
      mock.getItem.mockReturnValue(raw)
      for (const load of forgivingLoaders) expect(Object.keys(load())).toEqual([])
    }
  })

  it('preserves read/write exception boundaries', () => {
    const mock = storage()
    mock.getItem.mockImplementation(() => { throw new Error('read') })
    for (const load of forgivingLoaders) expect(() => load()).not.toThrow()
    expect(persistence.loadSelectedModelMap()).toEqual({})
    mock.setItem.mockImplementation(() => { throw new Error('write') })
    expect(() => persistence.saveSelectedModelMap({ t: 'm' })).not.toThrow()
    expect(() => persistence.saveSelectedCollaborationModeMap({ t: 'plan' })).not.toThrow()
    mock.getItem.mockReturnValue(null)
  })

  it('does not touch storage on module import', async () => {
    const mock = storage()
    vi.resetModules()
    await import('./desktopStatePersistence')
    expect(mock.getItem).not.toHaveBeenCalled()
    expect(mock.setItem).not.toHaveBeenCalled()
  })

  it('preserves record identity and legacy contexts while pruning', () => {
    const state = persistence.createStringKeyedRecord<string>()
    state.t = 'model'
    state['__new-thread__'] = 'default'
    state['__new-thread-provider__::legacy'] = 'legacy'
    expect(persistence.pruneThreadContextStateMap(state, new Set(['t']))).toBe(state)
    const pruned = persistence.pruneThreadContextStateMap(state, new Set())
    expect(Object.getPrototypeOf(pruned)).toBeNull()
    expect(Object.keys(pruned)).toEqual(['__new-thread__', '__new-thread-provider__::legacy'])
    expect(state.t).toBe('model')
  })

  it('preserves behavior when accessing localStorage itself throws', () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('unavailable') } })
    for (const load of forgivingLoaders) expect(() => load()).not.toThrow()
    expect(persistence.loadSelectedModelMap()).toEqual({})
    expect(() => persistence.saveSelectedModelMap({ t: 'm' })).not.toThrow()
    expect(() => persistence.saveSelectedCollaborationModeMap({ t: 'plan' })).not.toThrow()
  })

  it('handles missing window without storage side effects', () => {
    vi.stubGlobal('window', undefined)
    for (const load of [...forgivingLoaders, persistence.loadSelectedModelMap]) expect(Object.keys(load())).toEqual([])
    persistence.saveSelectedModelMap({})
    persistence.saveSelectedCollaborationModeMap({})
  })
})
