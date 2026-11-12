import { expect, it, vi, afterEach } from 'vitest'
import { refreshChatgptAuthTokensForExternalAuth } from './externalAuthRefresh'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
afterEach(() => vi.unstubAllEnvs())
it.each(['file', 'keyring', 'auto', 'ephemeral', 'unknown'])('refuses client-managed %s credentials without reading or changing local login', async store => {
  const home = await mkdtemp(join(tmpdir(), 'auth-ownership-'))
  vi.stubEnv('CODEX_HOME', home)
  const contents = '{"tokens":{"refresh_token":"local-only"}}'
  await writeFile(join(home, 'auth.json'), contents)
  const fetch = vi.spyOn(globalThis, 'fetch')
  const readStore = vi.fn(async () => store)
  try {
    await expect(refreshChatgptAuthTokensForExternalAuth({}, readStore)).rejects.toThrow('codex login on the App Server host')
    expect(fetch).not.toHaveBeenCalled()
    expect(readStore).not.toHaveBeenCalled()
    expect(await readFile(join(home, 'auth.json'), 'utf8')).toBe(contents)
  } finally { fetch.mockRestore(); await rm(home, { recursive: true }) }
})
