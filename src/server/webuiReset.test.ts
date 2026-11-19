import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { profileDirectoryName, remoteUploadsDirectory, resolveWebuiStorage } from './webuiStorage.mjs'

const repository = resolve(import.meta.dirname, '../..')
const scriptPath = 'scripts/reset-webui.mjs'
const maintenancePath = 'src/server/webuiMaintenance.mjs'
let backendScript: string
let maintenance: string
const id = '1b937cf7-0751-4c14-972a-cedc95270924'
const execute = ['--execute', '--offline']

let root: string
let home: string
let data: string
let cache: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'webui-reset-test-'))
  home = join(root, 'codex-core')
  const storage = resolveWebuiStorage()
  data = storage.data
  cache = storage.cache
  const checkout = join(root, 'checkout')
  backendScript = join(checkout, scriptPath)
  maintenance = join(checkout, maintenancePath)
  for (const path of [scriptPath, 'scripts/reset-webui-files.mjs', 'src/server/webuiStorage.mjs']) {
    write(join(checkout, path), readFileSync(join(repository, path), 'utf8'))
  }
  // Give fixtures a private coordination directory. A developer's live backend
  // can hold the real maintenance lease while this suite exercises test data.
  write(maintenance, readFileSync(join(repository, maintenancePath), 'utf8').replace(
    '`/tmp/codex-webui-maintenance-${process.getuid()}`', JSON.stringify(join(root, 'coordination')),
  ))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const profile = (base: string, id = 'workstation') => join(base, 'app-servers', profileDirectoryName(id))
const auth = () => join(data, 'global', 'auth-sessions.json')

function write(path: string, value = 'contents') {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value)
}

function run(args: string[] = [], overrides: Record<string, string> = {}, script = backendScript) {
  const child = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CODEX_HOME: home, CODEXUI_CONNECTION_PROFILE: 'workstation', ...overrides },
  })
  if (child.error) throw child.error
  return { code: child.status, output: child.stdout + child.stderr }
}

describe('WebUI reset preview and validation', () => {
  it.each(['darwin', 'win32'])('rejects execution on %s before inspecting storage paths', platform => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} })
      process.argv.splice(1, process.argv.length, '--execute', '--offline', '--profile', 'workstation')
      await import(${JSON.stringify(pathToFileURL(backendScript).href)})
    `], { encoding: 'utf8' })
    expect(child.status).toBe(1)
    expect(child.stderr).toContain('Reset execution requires Linux')
  })

  it('defaults to a dry run and resolves exactly the runtime storage layout', () => {
    const state = join(profile(data), 'state.json')
    const other = join(profile(data, 'other'), 'state.json')
    write(state, '{"conversation-transfers-v1":{"one":"sensitive content"}}')
    write(other)
    write(auth())
    write(join(home, '.codex-global-state.json'))
    const result = run(['--shared'])
    expect(result.code, result.output).toBe(0)
    expect(result.output).toContain('Would delete ' + JSON.stringify(state))
    expect(result.output).toContain('Would delete ' + JSON.stringify(auth()))
    for (const text of [other, home, 'sensitive content']) expect(result.output).not.toContain(text)
    for (const path of [state, other, auth()]) expect(existsSync(path)).toBe(true)
  })

  it('rejects missing or invalid IDs and conflicting or retired options', () => {
    expect(run([], { CODEXUI_CONNECTION_PROFILE: '' }).output).toContain('App Server ID is required')
    expect(run(['--all-profiles'], { CODEXUI_CONNECTION_PROFILE: '' }).code).toBe(0)
    expect(run(['--profile', '../bad']).output).toContain('Invalid App Server ID')
    expect(run(['--profile', 'one', '--all-profiles']).code).toBe(1)
    expect(run(['--execute']).output).toContain('--execute requires --offline')
    expect(run(['--dry-run', ...execute]).output).toContain('Choose either')
    expect(run(['--remote', '--shared']).output).toContain('separate commands')
    expect(run(['--include-legacy']).code).toBe(1)
  })

  it.skipIf(process.platform !== 'linux')('refuses build cleanup when WebUI storage overlaps output', () => {
    const result = run(['--build'], { XDG_CACHE_HOME: join(root, 'checkout', 'dist') })
    expect(result.code).toBe(1)
    expect(result.output).toContain('WebUI storage overlaps a build cleanup target')
  })
})

describe.skipIf(process.platform !== 'linux')('WebUI reset execution', () => {
  it('resets only the chosen ID and preserves Codex, other IDs and accounting bytes', () => {
    const server = profile(data)
    const serverCache = profile(cache)
    const remove = [
      join(server, 'state.json'), join(server, 'model-preferences.json'), join(server, `.state.json.${id}.tmp`),
      join(serverCache, 'inline-media', 'generated-image-turn-' + 'a'.repeat(40) + '.png'),
      join(serverCache, 'model-history/v1', 'a'.repeat(64) + '.json'),
      join(serverCache, 'model-history/v1', 'b'.repeat(64) + '.json.' + id + '.tmp'),
    ]
    const preserve = [
      join(home, 'config.toml'), join(home, 'sessions/2026/11/19/rollout-native.jsonl'),
      join(home, '.codex-global-state.json'), join(home, 'webui-auth-sessions.json'),
      join(home, 'codexapp-thread-index.json'), join(home, 'codexapp-upload-inventory.json'),
      join(server, 'uploads/inventory.json'), join(server, 'uploads/journal.jsonl'), join(server, 'endpoint.json'),
      join(profile(data, 'other'), 'model-preferences.json'), join(profile(cache, 'other'), 'inline-media/other'),
      join(serverCache, 'inline-media/unknown'), join(server, 'unknown'), auth(),
    ]
    for (const path of remove) write(path)
    for (const path of preserve) write(path, path)
    const lock = join(server, 'state.json.lock')
    mkdirSync(lock)
    utimesSync(lock, new Date(0), new Date(0))
    const result = run(execute)
    expect(result.code, result.output).toBe(0)
    for (const path of [...remove, lock]) expect(existsSync(path)).toBe(false)
    for (const path of preserve) expect(readFileSync(path, 'utf8')).toBe(path)
    expect(run(['--all-profiles', '--shared', ...execute]).code).toBe(0)
    expect(existsSync(auth())).toBe(false)
    expect(existsSync(profile(data, 'other'))).toBe(false)
    expect(existsSync(join(server, 'uploads/journal.jsonl'))).toBe(true)
  })

  it.each(['link', 'hardlink', 'lock'])('preflights a %s and keeps the complete plan intact on failure', kind => {
    const state = join(profile(data), 'state.json')
    const target = join(profile(data), 'model-preferences.json')
    write(state)
    if (kind === 'link') symlinkSync(state, target)
    else if (kind === 'hardlink') linkSync(state, target)
    else mkdirSync(target + '.lock')
    const result = run(execute)
    expect(result.code, result.output).toBe(1)
    expect(result.output).toMatch(/Refusing a symbolic link|hard-linked file|lock may be active/)
    expect(readFileSync(state, 'utf8')).toBe('contents')
  })

  it('excludes active WebUI writer and reset leases', async () => {
    const writerScript = `import { holdWebuiWriterLease } from ${JSON.stringify(maintenance)}; holdWebuiWriterLease(); process.once('SIGTERM', () => process.exit(0)); console.log('ready'); setInterval(() => {}, 1000)`
    const writer = spawn(process.execPath, ['--input-type=module', '-e', writerScript])
    try {
      await Promise.race([
        once(writer.stdout, 'data'),
        once(writer, 'exit').then(([code]) => { throw new Error('Writer exited with ' + code) }),
      ])
      const result = run(execute)
      expect(result.code).toBe(1)
      expect(result.output).toContain('server or build is running')
    } finally {
      if (writer.exitCode === null) {
        const exited = once(writer, 'exit')
        writer.kill()
        await exited
      }
    }
    const { acquireWebuiResetLease } = await import(maintenance)
    const release = acquireWebuiResetLease()
    try {
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', writerScript], { encoding: 'utf8' })
      expect(child.status).toBe(1)
      expect(child.stderr).toContain('reset is in progress')
    } finally { release() }
  })

  it('clears only explicitly selected uploads for the specified ID on the confirmed host', () => {
    const uploadRoot = join(root, 'dedicated-uploads')
    const name = id + '-file.txt'
    const upload = join(remoteUploadsDirectory(uploadRoot, 'workstation'), name)
    const keep = [
      join(remoteUploadsDirectory(uploadRoot, 'other'), name),
      join(dirname(upload), id + '-other.txt'),
      join(home, 'cache/model-history/v1', 'c'.repeat(64) + '.json'),
      join(home, 'codexapp-uploads', name),
    ]
    write(upload)
    for (const path of keep) write(path, path)
    const args = ['--remote', '--profile', 'workstation', '--remote-upload-root', uploadRoot]
    expect(run([...args, '--remote-upload', '../file.txt']).code).toBe(1)
    expect(run([...args, ...execute, '--confirm-remote', 'wrong-host']).code).toBe(1)
    const dry = run([...args, '--remote-upload', name])
    expect(dry.code, dry.output).toBe(0)
    expect(dry.output).toContain('Would delete ' + JSON.stringify(upload))
    expect(existsSync(upload)).toBe(true)
    const selected = run([...args, '--remote-upload', name, ...execute, '--confirm-remote', hostname()])
    expect(selected.code, selected.output).toBe(0)
    expect(existsSync(upload)).toBe(false)
    for (const path of keep) expect(readFileSync(path, 'utf8')).toBe(path)
  })

  it('cleans optional build outputs and rejects tracked content', () => {
    const checkout = join(root, 'checkout')
    function git(...args: string[]) {
      expect(spawnSync('git', args, { cwd: checkout }).status).toBe(0)
    }
    git('init', '-q')
    const script = join(checkout, 'scripts/reset-webui.mjs')
    const artifact = 'dist/assets/app.js'
    write(join(checkout, artifact))
    write(join(checkout, 'output/unrelated'))
    expect(run(execute, {}, script).code).toBe(0)
    expect(existsSync(join(checkout, artifact))).toBe(true)
    git('add', '--', artifact)
    expect(run(['--build', ...execute], {}, script).output).toContain('contains tracked files')
    git('rm', '--cached', '--', artifact)
    const result = run(['--build', ...execute], {}, script)
    expect(result.code, result.output).toBe(0)
    expect(existsSync(join(checkout, artifact))).toBe(false)
    expect(existsSync(join(checkout, 'output/unrelated'))).toBe(true)
  })
})
