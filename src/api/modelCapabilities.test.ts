import { afterEach, describe, expect, it } from 'vitest'
import { computed } from 'vue'
import {
  findReasoningModel,
  modelSelectionKey,
  parseModelSelection,
  normalizeReasoningEffort,
  reasoningOptions,
  resolveReasoningEffort,
  type ReasoningModel,
} from './modelCapabilities'
import * as gateway from './codexGateway'

describe('pure model capabilities', () => {
  it('preserves effort order, labels, string entries and object descriptions', () => {
    const model: ReasoningModel = { supportedReasoningEfforts: [
      'none', 'minimal', 'low', { reasoningEffort: 'medium', description: 'Balanced' },
      'high', { reasoningEffort: 'xhigh', description: 'Extra detail' },
    ] }
    expect(reasoningOptions(model)).toEqual([
      { value: 'none', label: 'None', description: '' },
      { value: 'minimal', label: 'Minimal', description: '' },
      { value: 'low', label: 'Low', description: '' },
      { value: 'medium', label: 'Medium', description: 'Balanced' },
      { value: 'high', label: 'High', description: '' },
      { value: 'xhigh', label: 'Extra high', description: 'Extra detail' },
    ])
  })

  it('trims efforts, keeps the first duplicate and accepts arbitrary strings', () => {
    expect(reasoningOptions({ supportedReasoningEfforts: [
      { reasoningEffort: ' high ', description: 'first' },
      { reasoningEffort: 'high', description: 'second' }, ' high ', ' custom ', '',
    ] })).toEqual([
      { value: 'high', label: 'High', description: 'first' },
      { value: 'custom', label: 'Custom', description: '' },
    ])
    expect(normalizeReasoningEffort(' HIGH ')).toBe('HIGH')
    for (const value of [null, undefined, 1, {}, false]) {
      expect(normalizeReasoningEffort(value)).toBe('')
    }
  })

  it.each([null, {}, { supportedReasoningEfforts: [] },
    { supportedReasoningEfforts: 'high' }, { supportedReasoningEfforts: null },
  ])('returns fresh empty options and empty fallback for %j', (input) => {
    const model = input as ReasoningModel | null
    expect(reasoningOptions(model)).toEqual([])
    expect(reasoningOptions(model)).not.toBe(reasoningOptions(model))
    expect(resolveReasoningEffort(model, 'high')).toBe('')
  })

  it('keeps malformed-entry handling without adding validation', () => {
    const model = { supportedReasoningEfforts: [
      null, undefined, 4, {}, { reasoningEffort: 4 }, { reasoningEffort: ' ' },
      { reasoningEffort: 'low', description: 4 },
      { reasoningEffort: ' xhigh ', description: '  verbatim  ' },
    ] } as unknown as ReasoningModel
    expect(reasoningOptions(model)).toEqual([
      { value: 'low', label: 'Low', description: '' },
      { value: 'xhigh', label: 'Extra high', description: '  verbatim  ' },
    ])
  })

  it('resolves exact requested efforts before catalog defaults and first-supported fallback', () => {
    const model = { supportedReasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'high' }
    expect(resolveReasoningEffort(model, 'low')).toBe('low')
    for (const requested of [undefined, '', 'unknown', ' low ', 'LOW']) {
      expect(resolveReasoningEffort(model, requested)).toBe('high')
    }
    for (const defaultReasoningEffort of [undefined, '', 'unknown', ' high ']) {
      expect(resolveReasoningEffort({ ...model, defaultReasoningEffort }, 'unknown')).toBe('low')
    }
    expect(resolveReasoningEffort({ defaultReasoningEffort: 'high' })).toBe('')
  })

  it('finds by id or model in catalog order and preserves object identity', () => {
    const first = { id: 'a', model: 'alias' }
    const second = { id: 'alias' }
    const catalog = [{}, first, second]
    expect(findReasoningModel(catalog, 'a')).toBe(first)
    expect(findReasoningModel(catalog, 'alias')).toBe(first)
    expect(findReasoningModel(catalog, 'unknown')).toBeNull()
    expect(findReasoningModel([], 'a')).toBeNull()
    expect(findReasoningModel([{ id: '' }], '')).toEqual({ id: '' })
    // Null catalog entries already throw; do not silently skip them.
    expect(() => findReasoningModel([null] as unknown as ReasoningModel[], 'a')).toThrow(TypeError)
  })
})

describe('gateway capability compatibility', () => {
  const originalCatalog = gateway.reasoningCatalog.value
  afterEach(() => { gateway.reasoningCatalog.value = originalCatalog })

  it('re-exports the pure functions with identical function identity', () => {
    expect(gateway.reasoningOptions).toBe(reasoningOptions)
    expect(gateway.resolveReasoningEffort).toBe(resolveReasoningEffort)
  })

  it('reads the current shared reactive catalog without a cache', () => {
    const catalogRef = gateway.reasoningCatalog
    const selected = computed(() => gateway.findReasoningModel('a'))
    catalogRef.value = [{ id: 'a', supportedReasoningEfforts: ['low'] }]
    expect(selected.value).toBe(catalogRef.value[0])
    expect(gateway.resolveReasoningEffort(selected.value)).toBe('low')
    catalogRef.value[0]!.supportedReasoningEfforts = ['high']
    expect(gateway.reasoningOptions(selected.value)[0]!.value).toBe('high')
    catalogRef.value = [{ model: 'a', defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['medium'] }]
    expect(selected.value).toBe(catalogRef.value[0])
    expect(gateway.resolveReasoningEffort(selected.value)).toBe('medium')
    catalogRef.value = []
    expect(selected.value).toBeNull()
    expect(gateway.resolveReasoningEffort(selected.value)).toBe('')
    expect(gateway.reasoningCatalog).toBe(catalogRef)
  })
})

it('does not borrow capabilities from another provider or an ambiguous mixed catalog', () => {
  const key = 'provider-model:["openai","same"]'
  expect(findReasoningModel([{ id: 'same', modelProvider: 'local' }], key)).toBeNull()
  expect(findReasoningModel([{ id: 'same' }, { id: 'same', modelProvider: 'local' }], key)).toBeNull()
  expect(findReasoningModel([{ id: 'same' }, { model: 'same' }], key)).toBeNull()
})


it('normalizes provider and model whitespace without folding distinct provider IDs', () => {
  expect(modelSelectionKey(' openai ', ' a ')).toBe('provider-model:["openai","a"]')
  expect(parseModelSelection('provider-model:[" openai "," a "]')).toEqual({ provider: 'openai', model: 'a' })
  expect(parseModelSelection(' a ')).toEqual({ provider: '', model: 'a' })
  expect(modelSelectionKey('OpenAI', 'a')).not.toBe(modelSelectionKey('openai', 'a'))
})
