import { afterEach, expect, it, vi } from 'vitest'
import { readPreferenceRecords, savePreferenceRecords } from './browserPreferenceRecords'

afterEach(() => vi.unstubAllGlobals())
it('retains simultaneous different-context updates from stale snapshots and clears individual preferences', async () => {
  const data = new Map<string, string>()
  vi.stubGlobal('window', { localStorage: { get length() { return data.size }, key: (i: number) => [...data.keys()][i], getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) } })
  for (const base of ['models', 'collaboration', 'explicit']) {
    savePreferenceRecords(base, { old: 'plan' }, {})
    const a = readPreferenceRecords(base), b = readPreferenceRecords(base)
    await Promise.all([
      Promise.resolve().then(() => savePreferenceRecords(base, { ...a, a: 'A' }, a)),
      Promise.resolve().then(() => savePreferenceRecords(base, { ...b, b: 'B' }, b)),
    ])
    expect(readPreferenceRecords(base)).toEqual({ old: 'plan', a: 'A', b: 'B' })
    savePreferenceRecords(base, { b: 'B' }, { ...b, b: 'B' })
    expect(readPreferenceRecords(base)).toEqual({ a: 'A', b: 'B' })
  }
})
