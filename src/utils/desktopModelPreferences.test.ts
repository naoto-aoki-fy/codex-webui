import { describe, expect, it } from 'vitest'
import { buildModelCatalogIds, orderModelIdsByUsage, resolveModelPreference } from './desktopModelPreferences'

describe('orderModelIdsByUsage', () => {
  it.each([
    [[], [], []],
    [[], ['A'], []],
    [['C', 'A', 'B'], [], ['C', 'A', 'B']],
    [['C', 'A', 'B', 'D'], ['B', 'A'], ['B', 'A', 'C', 'D']],
    [['C', 'A', 'B'], ['missing', 'B'], ['B', 'C', 'A']],
    [['A', 'A', 'B', 'B', 'C'], ['A', 'A'], ['A', 'A', 'B', 'B', 'C']],
    [['A', 'B'], ['a', ' A ', 'B'], ['B', 'A']],
  ])('orders catalog %j with usage %j as %j', (catalog, usage, expected) => {
    const ids = Object.freeze([...catalog])
    const recent = Object.freeze([...usage])
    const result = orderModelIdsByUsage(ids, recent)
    expect(result).toEqual(expected)
    expect(result).not.toBe(ids)
    expect(ids).toEqual(catalog)
    expect(recent).toEqual(usage)
  })
})

describe('model catalog and fallback selection', () => {
  it.each([
    [['A', 'B'], 'B', 'A', ['A', 'B'], 'B'],
    [['A', 'B'], 'missing', ' B ', ['A', 'B'], 'B'],
    [['B', 'A'], 'missing', 'missing', ['B', 'A'], 'B'],
    [[], 'saved', 'configured', ['saved'], 'saved'],
    [[], '', ' configured ', ['configured'], 'configured'],
    [[], '', '  ', [], ''],
    [['A', 'A', 'B'], '', '', ['A', 'A', 'B'], 'A'],
    [['A', 'B'], ' B ', 'A', ['A', 'B'], 'A'],
  ])('preserves fallback for %j, saved %j, configured %j', (catalog, saved, configured, expectedIds, expectedModel) => {
    const input = Object.freeze([...catalog])
    const ids = buildModelCatalogIds(input, saved, configured)
    expect(ids).toEqual(expectedIds)
    expect(ids).not.toBe(input)
    expect(input).toEqual(catalog)
    Object.freeze(ids)
    expect(resolveModelPreference(ids, saved, configured)).toBe(expectedModel)
    expect(ids).toEqual(expectedIds)
  })

  it('leaves an empty selection empty when resolving without catalog construction', () => {
    expect(resolveModelPreference([], 'saved', 'configured')).toBe('')
  })
})
