import { afterEach, expect, it, vi } from 'vitest'

const payload = (text: string) => ({ text, imageUrls: ['data:image/png;base64,abc'], fileAttachments: [{ label: 'a', path: '/a', fsPath: '/a' }], skills: [{ name: 's', path: '/s' }], apps: [{ id: 'app', name: 'App' }] })
function storage(data = new Map<string, string>()) {
  return { data, get length() { return data.size }, key: (i: number) => [...data.keys()][i] ?? null, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) } }
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it('isolates duplicated session identities, reloads, clearing, profiles and all payload fields', async () => {
  const local = storage(), sessionA = storage()
  const win = (session: ReturnType<typeof storage>, profile = 'legacy') => ({ localStorage: local, sessionStorage: session, location: { href: `http://fixture/?connection-profile=${profile}` } })
  vi.stubGlobal('window', win(sessionA))
  const a = await import('./composerDraftStorage')
  a.persistDraftForThread('same', payload('a'))
  a.persistDraftForThread('different', payload('other conversation'))
  const sessionB = storage(new Map(sessionA.data)) // browser Duplicate Tab
  vi.resetModules(); vi.stubGlobal('window', win(sessionB))
  const b = await import('./composerDraftStorage')
  expect(b.loadPersistedDraftForThread('same')).toEqual(payload('a'))
  await Promise.all([
    Promise.resolve().then(() => { vi.stubGlobal('window', win(sessionA)); a.persistDraftForThread('same', payload('a edited')) }),
    Promise.resolve().then(() => { vi.stubGlobal('window', win(sessionB)); b.persistDraftForThread('same', payload('b edited')) }),
  ])
  expect(b.loadPersistedDraftForThread('same')).toEqual(payload('b edited'))
  vi.stubGlobal('window', win(sessionA))
  expect(a.loadPersistedDraftForThread('same')).toEqual(payload('a edited'))
  a.persistDraftForThread('same', { text: '', imageUrls: [], fileAttachments: [], skills: [] })
  vi.stubGlobal('window', win(sessionB))
  expect(b.loadPersistedDraftForThread('same')).toEqual(payload('b edited'))
  vi.resetModules()
  const reloadedB = await import('./composerDraftStorage')
  expect(reloadedB.loadPersistedDraftForThread('same')).toEqual(payload('b edited'))
  expect(reloadedB.recoverableDrafts('different')[0]?.draft).toEqual(payload('other conversation'))
  vi.resetModules(); vi.stubGlobal('window', win(sessionA))
  const reloadedA = await import('./composerDraftStorage')
  expect(reloadedA.loadPersistedDraftForThread('same')?.text).toBe('')
  vi.resetModules(); vi.stubGlobal('window', win(storage(), 'remote'))
  const remote = await import('./composerDraftStorage')
  expect(remote.loadPersistedDraftForThread('same')).toBeNull()
  expect(remote.recoverableDrafts('same')).toEqual([])
})

it('copies legacy drafts without consuming recovery data and survives denied writes', async () => {
  const local = storage(), session = storage()
  const legacy = 'codex-web-local.thread-draft.v1.t'
  local.setItem(legacy, JSON.stringify(payload('legacy')))
  vi.stubGlobal('window', { localStorage: local, sessionStorage: session })
  const drafts = await import('./composerDraftStorage')
  expect(drafts.loadPersistedDraftForThread('t')).toEqual(payload('legacy'))
  drafts.persistDraftForThread('t', payload('changed'))
  expect(local.getItem(legacy)).toBe(JSON.stringify(payload('legacy')))
  local.setItem = () => { throw new Error('Quota exceeded') }
  drafts.persistDraftForThread('t', payload('in memory'))
  expect(drafts.loadPersistedDraftForThread('t')).toEqual(payload('in memory'))
  expect(drafts.draftStorageError).toContain('copy it before closing')
})


it('keeps dotted thread IDs and recovery backups separate and never revives submitted v1 text', async () => {
  const local = storage(), session = storage()
  vi.stubGlobal('window', { localStorage: local, sessionStorage: session })
  const drafts = await import('./composerDraftStorage')
  local.setItem('codex-web-local.thread-draft.v1.a', JSON.stringify(payload('legacy')))
  drafts.persistDraftForThread('a', { text: '', imageUrls: [], fileAttachments: [], skills: [] })
  drafts.persistDraftForThread('a.b', payload('other thread'))
  expect(drafts.archiveDraftBeforeRecovery('a', payload('archived'))).toBe(true)
  expect(drafts.recoverableDrafts('a').map(row => row.draft.text)).toEqual(['legacy', 'archived'])
  vi.resetModules()
  vi.stubGlobal('window', { localStorage: local, sessionStorage: storage() })
  const fresh = await import('./composerDraftStorage')
  expect(fresh.loadPersistedDraftForThread('a')).toBeNull()
  expect(fresh.recoverableDrafts('a.b')[0]?.draft.text).toBe('other thread')
})

it('recovers a copy into this writer without altering another tab or profile, including legacy fork recovery', async () => {
  const local = storage(), sessionA = storage(), sessionB = storage()
  const win = (session: ReturnType<typeof storage>, profile = 'remote-A') => ({ localStorage: local, sessionStorage: session, location: { href: `http://fixture/?connection-profile=${profile}` } })
  vi.stubGlobal('window', win(sessionA))
  const a = await import('./composerDraftStorage')
  a.persistDraftForThread('same', payload('tab A'))
  const originalA = new Map(local.data)
  vi.resetModules(); vi.stubGlobal('window', win(sessionB))
  const b = await import('./composerDraftStorage')
  b.persistDraftForThread('same', payload('tab B'))
  local.setItem('codex-profile.remote-A.codex-web-local.thread-fork-recovery.v1.same', JSON.stringify(payload('fork legacy')))
  local.setItem('codex-profile.remote-B.codex-web-local.thread-draft.v1.same', JSON.stringify(payload('other profile')))
  const sources = b.recoverableDrafts('same')
  expect(sources.map(row => row.draft.text)).toEqual(expect.arrayContaining(['tab A', 'fork legacy']))
  expect(sources.some(row => row.draft.text === 'other profile')).toBe(false)
  expect(b.archiveDraftBeforeRecovery('same', b.loadPersistedDraftForThread('same')!)).toBe(true)
  b.persistDraftForThread('same', sources.find(row => row.draft.text === 'tab A')!.draft)
  for (const [key, value] of originalA) expect(local.getItem(key)).toBe(value)
  expect(b.recoverableDrafts('same').map(row => row.draft.text)).toEqual(expect.arrayContaining(['tab A', 'tab B', 'fork legacy']))
  expect(local.getItem('codex-profile.remote-B.codex-web-local.thread-draft.v1.same')).toBe(JSON.stringify(payload('other profile')))
})
