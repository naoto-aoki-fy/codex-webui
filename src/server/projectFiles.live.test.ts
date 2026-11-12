import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { expect, it, vi } from 'vitest'
import { AppServerClient } from './appServerClient'
import { ProjectFileService } from './appServerFileSystem'
import { createLocalFileMiddleware } from './localFileHttp'

// Explicitly opt in: the default suite never requires a Codex installation or credentials.
it.skipIf(process.env.CODEX_PROJECT_FILES_LIVE !== '1' || process.platform === 'win32')('serves files through Codex CLI 0.167.2 RPCs', async () => {
  expect(execFileSync('node_modules/.bin/codex', ['--version'], { encoding: 'utf8' }).trim()).toBe('codex-cli 0.167.2')
  const directory = await mkdtemp(join(tmpdir(), 'codex-project-files-live-'))
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = (reservation.address() as { port: number }).port
  await new Promise<void>(resolve => reservation.close(() => resolve()))
  const url = `ws://127.0.0.1:${port}`
  const child = spawn('node_modules/.bin/codex', ['app-server', '--listen', url], {
    env: { ...process.env, CODEX_HOME: directory }, stdio: ['ignore', 'ignore', 'pipe'],
  })
  let logs = ''
  child.stderr.on('data', data => { logs += data })
  vi.stubEnv('CODEXUI_APP_SERVER_URL', url)
  const client = new AppServerClient({ threadIndex: { call: (method, params, rpc) => rpc(method, params) }, metadataStore: { save: async () => {} } })
  let http: ReturnType<typeof createServer> | undefined
  try {
    for (let i = 0; ; i++) {
      try { await fetch(`http://127.0.0.1:${port}`); break } catch {
        if (i >= 100 || child.exitCode !== null) throw new Error('App-server not ready: ' + logs)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
    const file = join(directory, 'project', '日本 語.txt')
    await client.rpc('fs/createDirectory', { path: join(directory, 'project'), recursive: true })
    await client.rpc('fs/writeFile', { path: file, dataBase64: Buffer.from('remote-rpc-content').toString('base64') })
    const files = new ProjectFileService(client)
    expect((await files.readFile(file)).toString()).toBe('remote-rpc-content')
    expect((await files.getMetadata(file)).isFile).toBe(true)
    expect((await files.readDirectory(join(directory, 'project'))).entries[0]!.fileName).toBe('日本 語.txt')
    expect(client.getInitializationMetadata()).toMatchObject({ codexHome: directory, platformFamily: 'unix' })
    const handler = createLocalFileMiddleware(files)
    http = createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end() }))
    http.listen(0, '127.0.0.1')
    await once(http, 'listening')
    const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`
    const response = await fetch(base + '/codex-local-browse' + encodeURI(file), { headers: { Range: 'bytes=0-5' } })
    expect(response.status).toBe(206)
    expect(await response.text()).toBe('remote')
    expect((await fetch(base + '/codex-local-browse' + encodeURI(file + '.missing'))).status).toBe(404)
  } finally {
    if (http) { http.closeAllConnections(); await new Promise<void>(resolve => http!.close(() => resolve())) }
    client.dispose()
    child.kill('SIGTERM')
    if (child.exitCode === null) await once(child, 'exit')
    vi.unstubAllEnvs()
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)
