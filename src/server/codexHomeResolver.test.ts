import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CodexHomeResolver, sessionCodexHome } from './codexHomeResolver'

beforeEach(() => vi.stubEnv('CODEX_HOME', '/webui/state'))
afterEach(() => vi.unstubAllEnvs())
const config = (file: string, profile: string | null = null) => ({ layers: [{ name: { type: 'user', file, profile } }] })
const thread = (home: string) => ({ thread: { path: `${home}/sessions/2026/11/15/rollout-test.jsonl` } })
function fixture() {
  let scope = 'connection:profile'
  const rpc = vi.fn<(method: string, params: unknown) => Promise<unknown>>().mockResolvedValue(config('/custom/home/config.toml'))
  const resolver = new CodexHomeResolver(rpc, () => scope)
  return { rpc, resolver, change: () => { scope += '-new' } }
}
function deferred() {
  let resolve!: (value: unknown) => void
  const promise = new Promise<unknown>(done => { resolve = done })
  return { promise, resolve }
}

it('uses the server effective home instead of WebUI CODEX_HOME with zero discovery requests', async () => {
  const f = fixture()
  f.resolver.observeInitialization({ codexHome: '/server/state' }, f.resolver.token())
  f.resolver.observeThreadRead(thread('/other'), f.resolver.token())
  expect(await f.resolver.resolve()).toBe('/server/state')
  expect(f.rpc).not.toHaveBeenCalled()
})

it('learns from an existing read with zero extra requests and retains the first value', async () => {
  const f = fixture()
  f.resolver.observeThreadRead(thread('/custom/home'), f.resolver.token())
  f.resolver.observeThreadRead(thread('/later'), f.resolver.token())
  expect(await f.resolver.resolve()).toBe('/custom/home')
  expect(f.rpc).not.toHaveBeenCalled()
})

it('coalesces concurrent demands into exactly one config/read and reuses its result', async () => {
  const f = fixture(), d = deferred()
  f.rpc.mockReturnValue(d.promise)
  const a = f.resolver.resolve(), b = f.resolver.resolve()
  expect(a).toBe(b)
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('config/read', { includeLayers: true })
  d.resolve(config('/custom/home/config.toml'))
  expect(await a).toBe('/custom/home')
  expect(await f.resolver.resolve()).toBe('/custom/home')
  expect(f.rpc).toHaveBeenCalledTimes(1)
})

it.each([null, {}, { layers: [{ name: { type: 'project', file: '/p/config.toml' } }] },
  config('/profile/config.toml', 'named'), config('relative/config.toml'), config('/x/../config.toml')])('retries inconclusive metadata: %j', async invalid => {
  const f = fixture()
  f.resolver.observeThreadRead({ thread: { path: '/random/file.jsonl' } }, f.resolver.token())
  f.rpc.mockResolvedValueOnce(invalid)
  expect(await f.resolver.resolve()).toBe('')
  expect(await f.resolver.resolve()).toBe('/custom/home')
  expect(f.rpc).toHaveBeenCalledTimes(2)
})

it('retries failures without retaining a failed promise', async () => {
  const f = fixture()
  f.rpc.mockRejectedValueOnce(new Error('offline'))
  await expect(f.resolver.resolve()).rejects.toThrow('offline')
  expect(await f.resolver.resolve()).toBe('/custom/home')
  expect(f.rpc).toHaveBeenCalledTimes(2)
})

it('selects only the base user layer, including older omitted-profile metadata', async () => {
  const f = fixture()
  f.rpc.mockResolvedValue({ layers: [
    { name: { type: 'system', file: '/system/config.toml' } },
    { name: { type: 'project', file: '/project/config.toml' } },
    { name: { type: 'user', file: '/named/config.toml', profile: 'named' } },
    { name: { type: 'user', file: '/base/config.toml' } },
  ] })
  expect(await f.resolver.resolve()).toBe('/base')
})

it('keeps a thread value learned while config/read was in flight', async () => {
  const f = fixture(), d = deferred()
  f.rpc.mockReturnValue(d.promise)
  const demand = f.resolver.resolve()
  f.resolver.observeThreadRead(thread('/thread/home'), f.resolver.token())
  d.resolve(config('/config/home/config.toml'))
  expect(await demand).toBe('/thread/home')
  expect(await f.resolver.resolve()).toBe('/thread/home')
})

it.each(['connection', 'profile'])('invalidates cached/in-flight state on %s changes and ignores stale responses', async () => {
  const f = fixture(), old = deferred(), fresh = deferred()
  f.rpc.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
  const token = f.resolver.token(), a = f.resolver.resolve()
  const retired = expect(a).rejects.toThrow('Retired')
  f.change()
  const b = f.resolver.resolve()
  f.resolver.observeThreadRead(thread('/stale'), token)
  f.resolver.observeInitialization({ codexHome: '/obsolete' }, token)
  old.resolve(config('/stale/config.toml'))
  await retired
  expect(f.resolver.resolve()).toBe(b)
  fresh.resolve(config('/fresh/config.toml'))
  expect(await b).toBe('/fresh')
  f.change()
  f.resolver.observeInitialization({ codexHome: '/new/server/home' }, f.resolver.token())
  f.resolver.observeInitialization({ codexHome: '/stale' }, token)
  expect(await f.resolver.resolve()).toBe('/new/server/home')
  expect(f.rpc).toHaveBeenCalledTimes(2)
})

it.each([
  ['/custom/home', '/custom/home'], ['C:\\Users\\me\\custom', 'C:\\Users\\me\\custom'],
  ['\\\\host\\share\\custom', '\\\\host\\share\\custom'], ['//host/share/custom', '//host/share/custom'],
])('supports session/archive and config remote paths: %s', async (home, expected) => {
  for (const suffix of ['/sessions/2026/11/15/rollout-x.jsonl', '/archived_sessions/rollout-x.jsonl']) {
    const path = home.includes('\\') ? (home + suffix).split('/').join('\\') : home + suffix
    expect(sessionCodexHome(path)).toBe(expected)
  }
  const f = fixture()
  const file = home.includes('\\') ? home + '\\config.toml' : home + '/config.toml'
  f.rpc.mockResolvedValue(config(file))
  expect((await f.resolver.resolve()).split('\\').join('/')).toBe(expected.split('\\').join('/'))
})

it.each([null, {}, { codexHome: '' }, { codexHome: 'relative' }, { codexHome: '/x/../wrong' }, { codexHome: '/bad\u0000path' }])('ignores invalid initialization despite WebUI CODEX_HOME: %j', async metadata => {
  const f = fixture()
  f.resolver.observeInitialization(metadata, f.resolver.token())
  expect(await f.resolver.resolve()).toBe('/custom/home')
  expect(f.rpc).toHaveBeenCalledTimes(1)
})

it.each(['/server/.codex', 'C:\\server\\custom', '\\\\host\\share\\custom'])('accepts remote initialization path %s and retains it', async home => {
  const f = fixture()
  f.resolver.observeInitialization({ codexHome: home }, f.resolver.token())
  f.resolver.observeInitialization({ codexHome: '/later' }, f.resolver.token())
  expect(await f.resolver.resolve()).toBe(home)
  expect(f.rpc).not.toHaveBeenCalled()
})
