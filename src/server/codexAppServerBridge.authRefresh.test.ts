import { expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

it('delivers an explicit error reply to unsupported refresh requests without emitting success', async () => {
  const { AppServerClient } = await import('./appServerClient')
  const client = new AppServerClient()
  const reply = vi.spyOn(client as any, 'sendServerRequestReply').mockImplementation(() => {})
  const notifications = vi.fn(); client.onNotification(notifications)
  const home = await mkdtemp(join(tmpdir(), 'unsupported-refresh-'))
  const contents = '{"tokens":{"refresh_token":"disposable-fixture"}}'
  await writeFile(join(home, 'auth.json'), contents)
  vi.stubEnv('CODEX_HOME', home)
  const fetch = vi.spyOn(globalThis, 'fetch')
  const readAsync = vi.spyOn(fs.promises, 'readFile')
  const readCallback = vi.spyOn(fs, 'readFile')
  const readSync = vi.spyOn(fs, 'readFileSync')
  try {
    await (client as any).handleServerRequest('request-id', 'account/chatgptAuthTokens/refresh', {})
    expect(reply).toHaveBeenCalledExactlyOnceWith('request-id', { error: {
      code: -32001,
      message: 'Client-managed token refresh is unsupported. Run codex login on the App Server host and use Codex-managed authentication there.',
    } })
    expect(notifications).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(readAsync).not.toHaveBeenCalled()
    expect(readCallback).not.toHaveBeenCalled()
    expect(readSync).not.toHaveBeenCalled()
    readAsync.mockRestore()
    expect(await readFile(join(home, 'auth.json'), 'utf8')).toBe(contents)
  } finally {
    fetch.mockRestore(); readAsync.mockRestore(); readCallback.mockRestore(); readSync.mockRestore()
    vi.unstubAllEnvs()
    client.dispose()
    await rm(home, { recursive: true, force: true })
  }
})
