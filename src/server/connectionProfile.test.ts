import { readCodexGlobalState, updateCodexGlobalState } from './codexGlobalState'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getConnectionProfileId, profileStateDirectory } from './connectionProfile'

afterEach(() => vi.unstubAllEnvs())
it('isolates profiles using the same forwarding URL and preserves legacy settings without copying', async () => {
  const home = await mkdtemp(join(tmpdir(), 'profiles-'))
  vi.stubEnv('CODEX_HOME', home)
  vi.stubEnv('CODEXUI_APP_SERVER_URL', 'ws://127.0.0.1:4500')
  vi.stubEnv('CODEXUI_CONNECTION_PROFILE', 'legacy')
  try {
    await writeFile(join(home, '.codex-global-state.json'), JSON.stringify({ 'test-state': ['/legacy'] }))
    expect((await readCodexGlobalState())['test-state']).toEqual(['/legacy'])
    for (const profile of ['machine-a', 'machine-b']) {
      vi.stubEnv('CODEXUI_CONNECTION_PROFILE', profile)
      expect((await readCodexGlobalState())['test-state']).toBeUndefined()
      await updateCodexGlobalState(state => { state['test-state'] = ['/' + profile] })
    }
    for (const profile of ['machine-a', 'machine-b', 'machine-a']) {
      vi.stubEnv('CODEXUI_CONNECTION_PROFILE', profile)
      expect((await readCodexGlobalState())['test-state']).toEqual(['/' + profile])
    }
    vi.stubEnv('CODEXUI_CONNECTION_PROFILE', 'legacy')
    expect(profileStateDirectory(home)).toBe(home)
    expect((await readCodexGlobalState())['test-state']).toEqual(['/legacy'])
  } finally { await rm(home, { recursive: true, force: true }) }
})
it('rejects invalid profile identities before constructing paths', () => {
  vi.stubEnv('CODEXUI_CONNECTION_PROFILE', '../../outside')
  expect(() => getConnectionProfileId()).toThrow('Connection profile')
})

it.each(['{broken', 'null', '[]'])('rejects malformed global state without overwriting it: %s', async raw => {
  const home = await mkdtemp(join(tmpdir(), 'profile-state-'))
  vi.stubEnv('CODEX_HOME', home)
  vi.stubEnv('CODEXUI_CONNECTION_PROFILE', 'legacy')
  const path = join(home, '.codex-global-state.json')
  try {
    await writeFile(path, raw)
    await expect(readCodexGlobalState()).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(raw)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
