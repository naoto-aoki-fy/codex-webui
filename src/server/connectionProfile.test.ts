import { getCodexGlobalStatePath, readCodexGlobalState, updateCodexGlobalState } from './codexGlobalState'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { getConnectionProfileId, profileStorageDirectory } from './connectionProfile'
import { profileDirectoryName, profileDirectoryPattern, resolveWebuiStorage, storageNames } from './webuiStorage.mjs'

afterEach(() => vi.unstubAllEnvs())

vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  hostname: () => 'Workstation.example.test',
}))

it('isolates case-sensitive IDs at the same endpoint and leaves native and old WebUI data untouched', async () => {
  const home = await mkdtemp(join(tmpdir(), 'core-home-'))
  vi.stubEnv('CODEX_HOME', home)
  vi.stubEnv('CODEXUI_APP_SERVER_URL', 'ws://127.0.0.1:4500')
  const oldFiles = {
    'config.toml': '# native sentinel',
    '.codex-global-state.json': '{"test-state":["old"]}',
    'codexapp-model-preferences.json': '{"schemaVersion":1}',
    'codexapp-thread-index.json': '{"old-thread":{}}',
    'webui-auth-sessions.json': '{"tokens":[]}',
  }
  try {
    for (const [name, raw] of Object.entries(oldFiles)) await writeFile(join(home, name), raw)
    for (const profile of ['legacy', 'machine-a', 'Machine-a', 'CON.']) {
      vi.stubEnv('CODEXUI_CONNECTION_PROFILE', profile)
      expect(await readCodexGlobalState()).toEqual({})
      await updateCodexGlobalState(state => { state['test-state'] = profile })
      expect(getCodexGlobalStatePath()).toBe(join(resolveWebuiStorage().data, storageNames.profiles, profileDirectoryName(profile), storageNames.state))
      expect(profileDirectoryName(profile)).toMatch(profileDirectoryPattern)
      expect(profileStorageDirectory('cache')).toBe(join(resolveWebuiStorage().cache, storageNames.profiles, profileDirectoryName(profile)))
    }
    for (const profile of ['Machine-a', 'legacy', 'machine-a', 'CON.']) {
      vi.stubEnv('CODEXUI_CONNECTION_PROFILE', profile)
      expect((await readCodexGlobalState())['test-state']).toBe(profile)
    }
    expect((await readdir(home)).sort()).toEqual(Object.keys(oldFiles).sort())
    for (const [name, raw] of Object.entries(oldFiles)) expect(await readFile(join(home, name), 'utf8')).toBe(raw)
  } finally { await rm(home, { recursive: true, force: true }) }
})

it('defaults to the short WebUI hostname when the profile is unset', () => {
  vi.stubEnv('CODEXUI_CONNECTION_PROFILE', undefined)
  vi.stubEnv('CODEXUI_APP_SERVER_URL', 'ws://app-server.example.test:4500')
  expect(getConnectionProfileId()).toBe('Workstation')
  expect(profileStorageDirectory('data')).toBe(profileStorageDirectory('data', 'Workstation'))
})

it.each(['', '  '])('rejects an explicitly blank ID (%j)', value => {
  vi.stubEnv('CODEXUI_CONNECTION_PROFILE', value)
  expect(() => getConnectionProfileId()).toThrow('App Server ID is required')
})

it.each(['../outside', 'a/b', 'a\\b', 'a:b', 'a b', 'é', '.hidden', 'a'.repeat(81)])('rejects malformed IDs (%j)', value => {
  vi.stubEnv('CODEXUI_CONNECTION_PROFILE', value)
  expect(() => profileStorageDirectory('data')).toThrow('Invalid App Server ID')
})

it('resolves Linux defaults and only uses absolute XDG overrides', () => {
  expect(resolveWebuiStorage({}, 'linux', '/home/user')).toEqual({
    config: '/home/user/.config/codex-webui',
    data: '/home/user/.local/share/codex-webui',
    cache: '/home/user/.cache/codex-webui',
    logs: '/home/user/.local/state/codex-webui',
  })
  expect(resolveWebuiStorage({
    XDG_CONFIG_HOME: '/xdg/config', XDG_DATA_HOME: '/xdg/data',
    XDG_CACHE_HOME: 'relative', XDG_STATE_HOME: '/xdg/state',
  }, 'linux', '/home/user')).toEqual({
    config: '/xdg/config/codex-webui', data: '/xdg/data/codex-webui',
    cache: '/home/user/.cache/codex-webui', logs: '/xdg/state/codex-webui',
  })
})

it('resolves macOS Application Support, Caches and Logs', () => {
  expect(resolveWebuiStorage({ XDG_DATA_HOME: '/ignored' }, 'darwin', '/Users/user')).toEqual({
    config: '/Users/user/Library/Application Support/codex-webui',
    data: '/Users/user/Library/Application Support/codex-webui',
    cache: '/Users/user/Library/Caches/codex-webui',
    logs: '/Users/user/Library/Logs/codex-webui',
  })
})

it('resolves Windows roaming and local app data with home fallbacks', () => {
  const home = 'C:\\Users\\user'
  expect(resolveWebuiStorage({ APPDATA: 'D:\\Roaming', LOCALAPPDATA: 'E:\\Local' }, 'win32', home)).toEqual({
    config: 'D:\\Roaming\\codex-webui', data: 'E:\\Local\\codex-webui',
    cache: 'E:\\Local\\codex-webui\\Cache', logs: 'E:\\Local\\codex-webui\\Logs',
  })
  expect(resolveWebuiStorage({}, 'win32', home)).toEqual({
    config: home + '\\AppData\\Roaming\\codex-webui', data: home + '\\AppData\\Local\\codex-webui',
    cache: home + '\\AppData\\Local\\codex-webui\\Cache', logs: home + '\\AppData\\Local\\codex-webui\\Logs',
  })
})

it.each(['{broken', 'null', '[]'])('preserves malformed connection state on read: %s', async raw => {
  const path = getCodexGlobalStatePath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, raw)
  await expect(readCodexGlobalState()).rejects.toThrow()
  expect(await readFile(path, 'utf8')).toBe(raw)
})

it('reopens Portable Fork records only under the App Server ID that created them', async () => {
  const { createConversationTransfers } = await import('./conversationTransfer')
  const rpc = vi.fn(async (method: string) => {
    if (method === 'thread/read') return { thread: { id: 'source', cwd: '/workspace', turns: [{
      id: 'turn', status: 'completed', items: [{ type: 'userMessage', id: 'prompt', content: [{ type: 'text', text: 'Portable prompt' }] }],
    }] } }
    if (method === 'thread/start') return { thread: { id: 'destination' }, model: 'model', modelProvider: 'provider' }
    if (method === 'thread/inject_items') return {}
    throw new Error('Unexpected RPC: ' + method)
  })
  const service = createConversationTransfers(rpc)
  const prepared = await service.prepare('source')
  await service.create(prepared.id, 'model', 'provider')
  expect(await createConversationTransfers(rpc).status(prepared.id)).toMatchObject({ stage: 'ready' })
  vi.stubEnv('CODEXUI_CONNECTION_PROFILE', 'other')
  await expect(createConversationTransfers(rpc).status(prepared.id)).rejects.toThrow('not found')
  vi.stubEnv('CODEXUI_CONNECTION_PROFILE', 'unit-test')
  const reopened = await createConversationTransfers(rpc).decorate({ thread: { id: 'destination', turns: [] } })
  expect(reopened.importedTranscript).toHaveLength(1)
  expect(rpc.mock.calls.map(([method]) => method)).toEqual(['thread/read', 'thread/start', 'thread/inject_items'])
})
