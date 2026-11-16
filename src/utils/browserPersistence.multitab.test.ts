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
