import { afterEach, expect, it, vi } from 'vitest'
import { readUiPreference, writeUiPreference } from './browserUiStorage'
afterEach(() => vi.unstubAllGlobals())
it('keeps optional UI preferences harmless when access is denied or writes exceed quota', () => {
  vi.stubGlobal('window', { get localStorage() { throw new Error('Denied') } })
  expect(readUiPreference('theme')).toBeNull()
  expect(() => writeUiPreference('theme', 'dark')).not.toThrow()
  vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: () => { throw new Error('Quota exceeded') } } })
  expect(() => writeUiPreference('theme', 'dark')).not.toThrow()
})
