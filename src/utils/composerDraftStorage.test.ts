import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it('preserves attachment and skill drafts within their connection profile', async () => {
  const storage = new Map<string, string>()
  vi.stubGlobal('window', { location: { href: 'http://fixture/?connection-profile=remote-A' }, localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } })
  const { persistDraftForThread, loadPersistedDraftForThread } = await import('./composerDraftStorage')
  const draft = { text: 'Draft', imageUrls: ['data:image/png;base64,abc'], fileAttachments: [{ label: 'a', path: '/a', fsPath: '/a' }], skills: [{ name: 'skill', path: '/skill/SKILL.md' }] }
  persistDraftForThread('thread', draft)
  expect(loadPersistedDraftForThread('thread')).toEqual(draft)
  expect([...storage.keys()].some(key => key.startsWith('codex-profile.remote-A.codex-web-local.thread-draft.v2.thread.'))).toBe(true)
  storage.set('codex-web-local.thread-draft.v1.other', JSON.stringify(draft))
  expect(loadPersistedDraftForThread('other')).toBeNull()
})

it('reads the existing fork recovery key and tolerates unavailable storage', async () => {
  vi.stubGlobal('window', { location: { href: 'http://fixture/' }, localStorage: {
    getItem: (key: string) => key.includes('thread-fork-recovery') ? JSON.stringify('Restored prompt') : null,
  } })
  const { loadPersistedDraftForThread } = await import('./composerDraftStorage')
  expect(loadPersistedDraftForThread('thread')?.text).toBe('Restored prompt')
  vi.stubGlobal('window', { get localStorage() { throw new Error('Unavailable') } })
  expect(loadPersistedDraftForThread('thread')).toBeNull()
})
