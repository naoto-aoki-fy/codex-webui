import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach } from 'vitest'

beforeEach(() => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-webui-test-'))
  const values = {
    CODEXUI_CONNECTION_PROFILE: 'unit-test',
    XDG_CONFIG_HOME: join(directory, 'config'),
    XDG_DATA_HOME: join(directory, 'data'),
    XDG_CACHE_HOME: join(directory, 'cache'),
    XDG_STATE_HOME: join(directory, 'state'),
    APPDATA: join(directory, 'roaming'),
    LOCALAPPDATA: join(directory, 'local'),
    ...(process.platform === 'darwin' ? { HOME: directory } : {}),
  }
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  Object.assign(process.env, values)
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(directory, { recursive: true, force: true })
  }
})
