import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it('preserves attachment and skill drafts within their connection profile', async () => {
  const storage = new Map<string, string>()
  vi.stubGlobal('window', { location: { href: 'http://fixture/?connection-profile=remote-A' }, localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } })
  ;(await import('./browserConnectionProfile')).setInitialConnectionProfile('remote-A')
  const { persistDraftForThread, loadPersistedDraftForThread } = await import('./composerDraftStorage')
  const draft = { text: 'Draft', imageUrls: ['data:image/png;base64,abc'], fileAttachments: [{ label: 'a', path: '/a', fsPath: '/a' }], skills: [{ name: 'skill', path: '/skill/SKILL.md' }] }
  persistDraftForThread('thread', draft)
  expect(loadPersistedDraftForThread('thread')).toEqual(draft)
  expect([...storage.keys()].some(key => key.startsWith('codex-profile.remote-A.codex-web-local.thread-draft.v2.thread.'))).toBe(true)
  storage.set('codex-web-local.thread-draft.v1.other', JSON.stringify(draft))
  expect(loadPersistedDraftForThread('other')).toBeNull()
})

it('exposes historical fork drafts only in explicit recovery and tolerates unavailable storage', async () => {
  vi.stubGlobal('window', { location: { href: 'http://fixture/' }, localStorage: {
    getItem: (key: string) => key.includes('thread-fork-recovery') ? JSON.stringify('Restored prompt') : null,
  } })
  const drafts = await import('./composerDraftStorage')
  const { loadPersistedDraftForThread } = drafts
  expect(loadPersistedDraftForThread('thread')).toBeNull()
  expect(drafts.recoverableDrafts('thread').map(({ draft }) => draft.text)).toEqual(['Restored prompt'])
  vi.stubGlobal('window', { get localStorage() { throw new Error('Unavailable') } })
  expect(loadPersistedDraftForThread('thread')).toBeNull()
  expect(drafts.draftStorageError).toContain('Existing saved drafts were not removed')
  const storage = new Map<string, string>()
  let readable = false
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => { if (!readable) throw new Error('Read denied'); return storage.get(key) ?? null },
    setItem: (key: string, value: string) => storage.set(key, value),
  } })
  drafts.persistDraftForThread('thread', { text: 'new edits', imageUrls: [], fileAttachments: [], skills: [] })
  expect(drafts.draftStorageError).toContain('Existing saved drafts were not removed')
  readable = true
  expect(loadPersistedDraftForThread('thread')?.text).toBe('new edits')
  expect(drafts.draftStorageError).toBe('')
})
