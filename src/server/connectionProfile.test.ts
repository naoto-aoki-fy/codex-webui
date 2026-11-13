import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getConnectionProfileId, profileStateDirectory } from './connectionProfile'
import { persistWorkspaceRoot, readWorkspaceRootsState } from './workspaceRootsStore'

afterEach(() => vi.unstubAllEnvs())
it('isolates profiles using the same forwarding URL and preserves legacy settings without copying', async () => {
  const home = await mkdtemp(join(tmpdir(), 'profiles-'))
  vi.stubEnv('CODEX_HOME', home)
  vi.stubEnv('CODEXUI_APP_SERVER_URL', 'ws://127.0.0.1:4500')
  try {
    await writeFile(join(home, '.codex-global-state.json'), JSON.stringify({ 'electron-saved-workspace-roots': ['/legacy'] }))
    expect((await readWorkspaceRootsState()).order).toEqual(['/legacy'])
    for (const profile of ['machine-a', 'machine-b']) {
      vi.stubEnv('CODEXUI_CONNECTION_PROFILE', profile)
      expect((await readWorkspaceRootsState()).order).toEqual([])
      await persistWorkspaceRoot('/' + profile)
    }
    for (const profile of ['machine-a', 'machine-b', 'machine-a']) {
      vi.stubEnv('CODEXUI_CONNECTION_PROFILE', profile)
      expect((await readWorkspaceRootsState()).order).toEqual(['/' + profile])
    }
    vi.stubEnv('CODEXUI_CONNECTION_PROFILE', 'legacy')
    expect(profileStateDirectory(home)).toBe(home)
    expect((await readWorkspaceRootsState()).order).toEqual(['/legacy'])
  } finally { await rm(home, { recursive: true, force: true }) }
})
it('rejects invalid profile identities before constructing paths', () => {
  vi.stubEnv('CODEXUI_CONNECTION_PROFILE', '../../outside')
  expect(() => getConnectionProfileId()).toThrow('Connection profile')
})
