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

describe('desktop persistence', () => {
  it('derives thread and composer contexts', () => {
    expect(persistence.toThreadContextId(' t ')).toBe('t')
    expect(persistence.toThreadContextId(' ')).toBe('__new-thread__')
    expect(persistence.NEW_THREAD_MODEL_CONTEXT).toBe('__new-thread-provider__::codex')
  })

  it('reads and clears independent current model choices and ignores old maps', () => {
    const base = 'codex-web-local.selected-model-by-context.v2.'
    const legacy = 'codex-web-local.selected-model-by-context.v1'
    const mock = storage({
      [legacy]: '{"old":"model"}',
      [base + 't']: '" m "',
      [base + '__proto__']: '"safe"',
      [base + 'corrupt']: '{',
      [base + 'invalid']: '4',
    })
    const state = persistence.loadSelectedModelMap()
    expect(Object.getPrototypeOf(state)).toBeNull()
    expect(state).toEqual({ ['__proto__']: 'safe', t: ' m ' })
    persistence.saveSelectedModelMap({}, state)
    expect(mock.getItem(base + 't')).toBe('""')
    expect(mock.getItem(legacy)).toBe('{"old":"model"}')
  })

  it('keeps context-specific collaboration preferences', () => {
    const base = 'codex-web-local.collaboration-mode-by-context.v2.'
    storage({ [base + 't']: '"plan"', [base + 'other']: '"default"' })
    const state = persistence.loadSelectedCollaborationModeMap()
    expect(persistence.readSelectedCollaborationMode(state, 't')).toBe('plan')
    expect(persistence.readSelectedCollaborationMode(state, 'new')).toBe('default')
    expect(persistence.writeSelectedCollaborationModeForContext(state, '', 'plan')['__new-thread__']).toBe('plan')
    expect(persistence.writeSelectedCollaborationModeForContext(state, 'absent', 'default')).toBe(state)
    const next = persistence.writeSelectedCollaborationModeForContext(state, 't', 'default')
    expect(next).not.toBe(state)
    expect(next.t).toBeUndefined()
    persistence.saveSelectedCollaborationModeMap(next, state)
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

  const forgivingLoaders = [persistence.loadSelectedModelMap, persistence.loadSelectedCollaborationModeMap]
  it('keeps malformed and unsupported values harmless for forgiving loaders', () => {
    for (const raw of ['{', 'null', '42', 'true', '[]', '""']) {
      storage({
        'codex-web-local.selected-model-by-context.v2.t': raw,
        'codex-web-local.collaboration-mode-by-context.v2.t': raw,
      })
      for (const load of forgivingLoaders) expect(Object.keys(load())).toEqual([])
    }
  })

  it('preserves read/write exception boundaries', () => {
    const mock = storage()
    mock.getItem.mockImplementation(() => { throw new Error('read') })
    for (const load of forgivingLoaders) expect(() => load()).not.toThrow()
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

  it('preserves record identity and the current Home model context while pruning', () => {
    const state = persistence.createStringKeyedRecord<string>()
    state.t = 'model'
    state[persistence.NEW_THREAD_MODEL_CONTEXT] = 'default'
    expect(persistence.pruneThreadContextStateMap(state, new Set(['t']))).toBe(state)
    const pruned = persistence.pruneThreadContextStateMap(state, new Set())
    expect(Object.getPrototypeOf(pruned)).toBeNull()
    expect(Object.keys(pruned)).toEqual([persistence.NEW_THREAD_MODEL_CONTEXT])
    expect(state.t).toBe('model')
  })

  it('preserves behavior when accessing localStorage itself throws', () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('unavailable') } })
    for (const load of forgivingLoaders) expect(() => load()).not.toThrow()
    expect(() => persistence.saveSelectedModelMap({ t: 'm' })).not.toThrow()
    expect(() => persistence.saveSelectedCollaborationModeMap({ t: 'plan' })).not.toThrow()
  })

  it('handles missing window without storage side effects', () => {
    vi.stubGlobal('window', undefined)
    for (const load of forgivingLoaders) expect(Object.keys(load())).toEqual([])
    persistence.saveSelectedModelMap({})
    persistence.saveSelectedCollaborationModeMap({})
  })
})
