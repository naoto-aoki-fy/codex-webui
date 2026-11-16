import { afterEach, expect, it, vi } from 'vitest'
import { readPreferenceRecords, savePreferenceRecords } from './browserPreferenceRecords'

afterEach(() => vi.unstubAllGlobals())
it('retains simultaneous different-context updates from stale snapshots and tombstones legacy defaults', async () => {
  const data = new Map<string, string>()
  vi.stubGlobal('window', { localStorage: { get length() { return data.size }, key: (i: number) => [...data.keys()][i], getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) } })
  for (const base of ['models', 'collaboration', 'explicit']) {
    const legacy = { old: 'plan' }
    const a = readPreferenceRecords(base, legacy), b = readPreferenceRecords(base, legacy)
    await Promise.all([
      Promise.resolve().then(() => savePreferenceRecords(base, { ...a, a: 'A' }, a)),
      Promise.resolve().then(() => savePreferenceRecords(base, { ...b, b: 'B' }, b)),
    ])
    expect(readPreferenceRecords(base, legacy)).toEqual({ old: 'plan', a: 'A', b: 'B' })
    savePreferenceRecords(base, { b: 'B' }, { ...b, b: 'B' })
    expect(readPreferenceRecords(base, legacy)).toEqual({ a: 'A', b: 'B' })
  }
})
