import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const repository = resolve(import.meta.dirname, '../..')
const backendScript = join(repository, 'scripts/reset-webui.mjs')
const maintenance = join(repository, 'src/server/webuiMaintenance.mjs')
const id = '1b937cf7-0751-4c14-972a-cedc95270924'
const stateFile = '.codex-global-state.json'
const index = 'codexapp-thread-index.json'
const preferences = 'codexapp-model-preferences.json'
const auth = 'webui-auth-sessions.json'
const inventory = 'codexapp-upload-inventory.json'
const journal = 'codexapp-uploads.jsonl'
const transfer = 'conversation-transfers-v1'
const migration = 'codexapp-native-project-migrations-v1'
const execute = ['--execute', '--offline']
const profile = (home: string, id: string) => join(home, 'codexapp-profiles', createHash('sha256').update(id).digest('hex'))

let root: string
let home: string
let media: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'webui-reset-test-'))
  home = join(root, 'backend')
  media = join(root, 'codex-web-inline-media')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function write(path: string, value = 'contents') {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value)
}
function json(path: string, value: unknown) {
  write(path, JSON.stringify(value))
}
function run(args: string[] = [], overrides: Record<string, string> = {}, script = backendScript) {
  const child = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8', env: { ...process.env, CODEX_HOME: home, TMPDIR: root, CODEXUI_CONNECTION_PROFILE: '', ...overrides },
  })
  if (child.error) throw child.error
  return { code: child.status, output: child.stdout + child.stderr }
}

describe('WebUI reset preview and validation', () => {
  it('defaults to a dry run and reports the plan without mutations', () => {
    const raw = `{"${transfer}":{"one":"secret value"},"official":true}`
    write(join(home, stateFile), raw)
    write(join(home, index))
    write(join(home, auth))
    const result = run(['--all-profiles', '--shared'])
    expect(result.code, result.output).toBe(0)
    expect(result.output).toContain(`Would modify "${join(home, stateFile)}"`)
    expect(result.output).toContain(`Would delete "${join(home, auth)}"`)
    expect(result.output).toContain('Preserve keys')
    expect(result.output).toContain('"official"')
    expect(result.output).not.toContain('secret value')
    expect(readFileSync(join(home, stateFile), 'utf8')).toBe(raw)
    expect(existsSync(join(home, index))).toBe(true)
    expect(existsSync(join(home, auth))).toBe(true)
  })

  it('rejects unsafe roots and conflicting options', () => {
    expect(run([], { CODEX_HOME: '/' }).output).toContain('Unsafe backend Codex home')
    expect(run([], { CODEX_HOME: join(home, '..') + '/../elsewhere' }).code).toBe(1)
    expect(run(['--profile', '../bad']).code).toBe(1)
    expect(run(['--profile', 'one', '--all-profiles']).code).toBe(1)
    expect(run(['--execute']).output).toContain('--execute requires --offline')
    expect(run(['--dry-run', ...execute]).output).toContain('Choose either')
    expect(run(['--remote', '--shared']).output).toContain('separate commands')
  })
})

describe.skipIf(process.platform !== 'linux')('WebUI reset execution', () => {
  it('resets active state and owned scratch while preserving official files byte-for-byte', () => {
    const protectedFiles = ['auth.json', 'config.toml', 'sessions/2026/11/19/rollout-native.jsonl', 'archived_sessions/rollout-old.jsonl',
      'state_5.sqlite', 'projects.sqlite', 'skills/custom/SKILL.md', 'AGENTS.md', '.mcp.json', 'worktree/.git',
      'codexapp-uploads/remote-file', 'cache/model-history/v1/official.bin', 'codexapp-turn-metadata/retired.jsonl',
      `..${stateFile.slice(1)}.${id}.tmp`]
    for (const name of protectedFiles) write(join(home, name), name)
    const native = ' "native": { "number": 9007199254740993123456, "nested": ["} , \\""] } '
    write(join(home, stateFile), `{ "${transfer}":{"x":{ "value":true }},${native},"codexapp-unknown":true,"\u0065lectron":1 }`)
    chmodSync(join(home, stateFile), 0o640)
    const owned = [index, preferences, journal, auth, inventory, auth + '.tmp', `${index}.${id}.tmp`,
      `.${preferences}.${id}.tmp`, `.${inventory}.${id}.tmp`, `.${stateFile}.webui-reset-${id}.tmp`]
    for (const name of owned) write(join(home, name))
    const abandoned = join(home, index + '.lock')
    mkdirSync(abandoned)
    utimesSync(abandoned, new Date(1), new Date(1))
    const image = join(media, `generated-image-turn-item-${'f'.repeat(40)}.png`)
    write(image)
    const unknown = join(media, 'unowned.png')
    write(unknown)
    const result = run(['--all-profiles', '--shared', ...execute])
    expect(result.code, result.output).toBe(0)
    for (const file of [...owned.map(name => join(home, name)), abandoned, image]) {
      expect(result.output).toContain(`Deleted "${file}"`)
      expect(existsSync(file), file).toBe(false)
    }
    for (const name of protectedFiles) expect(readFileSync(join(home, name), 'utf8')).toBe(name)
    expect(readFileSync(unknown, 'utf8')).toBe('contents')
    const state = readFileSync(join(home, stateFile), 'utf8')
    expect(state).toContain(native)
    expect(JSON.parse(state)).toMatchObject({ 'codexapp-unknown': true, electron: 1 })
    expect(JSON.parse(state)).not.toHaveProperty(transfer)
    expect(statSync(join(home, stateFile)).mode & 0o777).toBe(0o640)
    expect(run(['--all-profiles', '--shared', ...execute]).output).toContain('0 filesystem actions')
  })

  it('selects one profile by ID or environment, keeps shared state opt-in and removes empty owned profiles', () => {
    const a = profile(home, 'a.prod')
    const b = profile(home, 'b')
    for (const folder of [home, a, b]) write(join(folder, index))
    json(join(a, stateFile), { [transfer]: { a: true }, [migration]: { connection: { completed: true } } })
    json(join(b, stateFile), { [transfer]: { b: true }, [migration]: { connection: { completed: false } }, official: 1 })
    write(join(home, auth))
    const one = run(execute, { CODEXUI_CONNECTION_PROFILE: 'a.prod' })
    expect(one.code, one.output).toBe(0)
    expect(existsSync(a)).toBe(false)
    expect(existsSync(join(b, index))).toBe(true)
    expect(existsSync(join(home, index))).toBe(true)
    expect(existsSync(join(home, auth))).toBe(true)
    const all = run(['--all-profiles', ...execute])
    expect(all.code, all.output).toBe(0)
    expect(existsSync(join(b, index))).toBe(false)
    expect(existsSync(join(home, index))).toBe(false)
    expect(existsSync(join(home, auth))).toBe(true)
    expect(JSON.parse(readFileSync(join(b, stateFile), 'utf8'))).toEqual({ [migration]: { connection: { completed: false } }, official: 1 })
  })

  it('keeps migration receipts when native or legacy roots still need them', () => {
    const expected = { 'electron-saved-workspace-roots': ['/project'], 'pinned-thread-ids': ['pin'],
      [migration]: { connection: { completed: true } }, 'active-workspace-roots': ['/project'] }
    json(join(home, stateFile), { ...expected, [transfer]: {} })
    const result = run(execute)
    expect(result.code, result.output).toBe(0)
    expect(JSON.parse(readFileSync(join(home, stateFile), 'utf8'))).toEqual(expected)
  })

  it('keeps the shared root JSON file even when only removable WebUI keys are present', () => {
    json(join(home, stateFile), { [transfer]: {}, [migration]: { x: { completed: true } } })
    const result = run(execute)
    expect(result.code, result.output).toBe(0)
    expect(readFileSync(join(home, stateFile), 'utf8')).toBe('{}')
  })

  it('handles missing state without creating Codex directories', () => {
    const result = run(['--all-profiles', '--shared', ...execute])
    expect(result.code, result.output).toBe(0)
    expect(result.output).toContain('0 filesystem actions')
    expect(existsSync(home)).toBe(false)
    expect(existsSync(media)).toBe(false)
  })

  it.each(['base', 'profile', 'file', 'media', 'hardlink'])('refuses unsafe %s paths before applying a plan', (which) => {
    const official = join(root, 'official')
    mkdirSync(official)
    write(join(official, index), 'native data')
    if (which === 'base') symlinkSync(official, home)
    else if (which === 'profile') {
      const target = profile(home, 'linked')
      mkdirSync(dirname(target), { recursive: true })
      symlinkSync(official, target)
    } else {
      write(join(home, preferences))
      if (which === 'file') symlinkSync(join(official, index), join(home, index))
      if (which === 'media') symlinkSync(official, media)
      if (which === 'hardlink') linkSync(join(official, index), join(home, index))
    }
    const result = run(['--all-profiles', '--shared', ...execute])
    expect(result.code, result.output).toBe(1)
    expect(result.output).toMatch(/Refusing a (symbolic link|special or hard-linked file)/)
    expect(result.output).not.toContain('Deleted ')
    expect(readFileSync(join(official, index), 'utf8')).toBe('native data')
  })

  it.each(['{oops', '{"x":1,"x":2}'])('preserves malformed or ambiguous global state %s', (raw) => {
    write(join(home, stateFile), raw)
    write(join(home, index))
    expect(run(execute).code).toBe(1)
    expect(existsSync(join(home, index))).toBe(true)
    expect(readFileSync(join(home, stateFile), 'utf8')).toBe(raw)
  })

  it('refuses active-looking persistence locks', () => {
    write(join(home, preferences))
    mkdirSync(join(home, index + '.lock'))
    const result = run(execute)
    expect(result.code, result.output).toBe(1)
    expect(result.output).toContain('Persistence lock may be active')
    expect(existsSync(join(home, preferences))).toBe(true)
  })

  it('refuses execution while a WebUI writer lease is held', async () => {
    const writer = spawn(process.execPath, ['--input-type=module', '-e',
      `import { holdWebuiWriterLease } from ${JSON.stringify(maintenance)}; holdWebuiWriterLease(); console.log('ready'); setInterval(() => {}, 1000)`])
    try {
      await new Promise<void>((resolve, reject) => {
        writer.stdout.once('data', () => resolve())
        writer.once('error', reject)
        writer.once('exit', code => reject(new Error('Writer exited with code ' + code)))
      })
      write(join(home, index))
      const result = run(execute)
      expect(result.code, result.output).toBe(1)
      expect(result.output).toContain('server or build is running')
      expect(existsSync(join(home, index))).toBe(true)
    } finally {
      const exited = new Promise(resolve => writer.once('exit', resolve))
      if (writer.kill()) await exited
    }
  })

  it('refuses a new WebUI writer while the reset lease is held', async () => {
    const { acquireWebuiResetLease } = await import('./webuiMaintenance.mjs')
    const release = acquireWebuiResetLease()
    try {
      const writer = spawnSync(process.execPath, ['--input-type=module', '-e',
        `import { holdWebuiWriterLease } from ${JSON.stringify(maintenance)}; holdWebuiWriterLease()`], { encoding: 'utf8' })
      expect(writer.status).toBe(1)
      expect(writer.stderr).toContain('reset is in progress')
    } finally {
      release()
    }
  })

  it('clears verified remote caches and only explicitly selected uploads on the confirmed host', () => {
    const remote = join(root, 'server')
    const uploadRoot = join(root, 'custom')
    const upload = join(uploadRoot, 'codexapp-uploads', id + '-file.txt')
    const untouched = join(uploadRoot, 'codexapp-uploads', id + '-keep.txt')
    const sourcePath = join(remote, 'sessions/2026/11/19/rollout-protected.jsonl')
    const cache = join(remote, 'cache/model-history/v1')
    const owned = join(cache, 'a'.repeat(64) + '.json')
    const unverified = join(cache, 'b'.repeat(64) + '.json')
    write(sourcePath)
    write(upload)
    write(untouched)
    write(unverified, '{"unrelated":true}')
    json(owned, { version: 1, sourcePath, modifiedAtMs: 1, turns: [{ turnId: 'turn', metadata: { model: 'm', modelSource: 'execution' } }] })
    write(join(home, index))
    const args = ['--remote', '--remote-codex-home', remote, '--remote-upload-root', uploadRoot]
    expect(run([...args, ...execute, '--confirm-remote', hostname() + '-wrong']).code).toBe(1)
    expect(run([...args, '--remote-upload', '../file.txt']).code).toBe(1)
    const dry = run([...args, '--remote-upload', basename(upload)])
    expect(dry.code, dry.output).toBe(0)
    expect(dry.output).toContain(`Would delete "${upload}"`)
    expect(existsSync(owned)).toBe(true)
    const cacheOnly = run([...args, ...execute, '--confirm-remote', hostname()])
    expect(cacheOnly.code, cacheOnly.output).toBe(0)
    expect(existsSync(owned)).toBe(false)
    expect(existsSync(upload)).toBe(true)
    const selected = run([...args, '--remote-upload', basename(upload), ...execute, '--confirm-remote', hostname()])
    expect(selected.code, selected.output).toBe(0)
    expect(existsSync(upload)).toBe(false)
    for (const path of [unverified, sourcePath, untouched, join(home, index)]) expect(existsSync(path)).toBe(true)
  })

  it('cleans optional build outputs from its own checkout and rejects tracked content', () => {
    const checkout = join(root, 'checkout')
    mkdirSync(checkout)
    for (const path of ['scripts/reset-webui.mjs', 'scripts/reset-webui-files.mjs', 'scripts/reset-webui-global-state.mjs',
      'src/server/webuiMaintenance.mjs']) {
      mkdirSync(dirname(join(checkout, path)), { recursive: true })
      cpSync(join(repository, path), join(checkout, path))
    }
    function git(...args: string[]) {
      expect(spawnSync('git', args, { cwd: checkout }).status).toBe(0)
    }
    git('init', '-q')
    const script = join(checkout, 'scripts/reset-webui.mjs')
    const generated = ['dist/assets/app.js', 'dist-cli/index.js', 'output/playwright/report.json',
      'test-results/snapshot.png', 'tsconfig.node.tsbuildinfo']
    for (const path of [...generated, 'output/unrelated', 'src/source.txt']) write(join(checkout, path))
    expect(run(execute, {}, script).code).toBe(0)
    expect(existsSync(join(checkout, generated[0]!))).toBe(true)
    git('add', '--', generated[0]!)
    const blocked = run(['--build', ...execute], {}, script)
    expect(blocked.output).toContain('contains tracked files')
    git('rm', '--cached', '--', generated[0]!)
    const result = run(['--build', ...execute], {}, script)
    expect(result.code, result.output).toBe(0)
    for (const path of generated) expect(existsSync(join(checkout, path))).toBe(false)
    for (const path of ['output/unrelated', 'src/source.txt']) expect(existsSync(join(checkout, path))).toBe(true)
  })
})
