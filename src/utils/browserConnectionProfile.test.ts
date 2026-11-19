import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it('uses the backend ID instead of browser hints, and scopes even an explicit legacy ID', async () => {
  const reload = vi.fn()
  vi.stubGlobal('window', {
    location: { href: 'http://localhost/?connection-profile=stale', reload },
    localStorage: { getItem: () => 'another-stale-id' },
  })
  const profile = await import('./browserConnectionProfile')
  const draft = 'codex-web-local.thread-draft.v1.shared-id'
  expect(profile.profileStorageKey(draft)).toBe('codex-unbound.' + draft)
  profile.setInitialConnectionProfile('legacy')
  expect(profile.profileStorageKey(draft)).toBe('codex-profile.legacy.' + draft)
  expect(profile.reloadForConnectionProfile('machine-b')).toBe(true)
  expect(reload).toHaveBeenCalledOnce()
  expect(profile.profileStorageKey(draft)).toBe('codex-profile.legacy.' + draft)
  vi.resetModules()
  const restarted = await import('./browserConnectionProfile')
  restarted.setInitialConnectionProfile('machine-b')
  expect(restarted.profileStorageKey(draft)).toBe('codex-profile.machine-b.' + draft)
  expect(restarted.reloadForConnectionProfile('machine-b')).toBe(false)
})

it('escapes dots in the ID so namespaces cannot overlap key prefixes', async () => {
  const profile = await import('./browserConnectionProfile')
  profile.setInitialConnectionProfile('machine.a')
  expect(profile.profileStorageKey('codex-web-local.thread-draft.v2')).toBe(
    'codex-profile.machine%2Ea.codex-web-local.thread-draft.v2',
  )
})
