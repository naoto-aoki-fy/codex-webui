import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
function browser(href: string, items = new Map<string, string>(), blocked = false) {
  const replace = vi.fn()
  vi.stubGlobal('window', {
    location: { href, replace },
    localStorage: {
      getItem: (key: string) => { if (blocked) throw new Error('blocked'); return items.get(key) ?? null },
      setItem: (key: string, value: string) => { if (blocked) throw new Error('blocked'); items.set(key, value) },
    },
  })
  return { replace, items }
}
it('keeps legacy drafts intact and isolates drafts and context across profile reloads', async () => {
  const { items, replace } = browser('http://localhost/#/thread/shared-id')
  let module = await import('./browserConnectionProfile')
  const draft = 'codex-web-local.thread-draft.v1.shared-id'
  items.set(module.profileStorageKey(draft), 'legacy draft')
  expect(module.reloadForConnectionProfile('machine-b')).toBe(true)
  const nextUrl = replace.mock.calls[0]![0]
  expect(nextUrl).toContain('connection-profile=machine-b')
  expect(nextUrl).toContain('#/thread/shared-id')
  vi.resetModules()
  browser(nextUrl, items)
  module = await import('./browserConnectionProfile')
  expect(items.get(module.profileStorageKey(draft))).toBeUndefined()
  items.set(module.profileStorageKey(draft), 'B draft')
  expect(module.reloadForConnectionProfile('machine-b')).toBe(false)
  vi.resetModules()
  browser('http://localhost/?connection-profile=legacy', items)
  module = await import('./browserConnectionProfile')
  expect(items.get(module.profileStorageKey(draft))).toBe('legacy draft')
  expect(items.get('codex-profile.machine-b.' + draft)).toBe('B draft')
})
it('uses URL identity to prevent a reload loop with disabled browser storage', async () => {
  const { replace } = browser('http://localhost/', new Map(), true)
  let module = await import('./browserConnectionProfile')
  expect(module.reloadForConnectionProfile('B')).toBe(true)
  vi.resetModules()
  browser(replace.mock.calls[0]![0], new Map(), true)
  module = await import('./browserConnectionProfile')
  expect(module.reloadForConnectionProfile('B')).toBe(false)
})
