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
      'scripts/reset-webui-legacy.mjs', 'scripts/reset-webui-legacy-registry.mjs',
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

const marker = '.cloudflared-install-prompted'
const tip = 'first-launch-plugins-card-dismissed'
const telegram = 'telegram-bridge'
const metadataDir = 'codexapp-turn-metadata'
const oldUploadDir = 'codex-web-uploads'
const oldPatchDir = 'codexui-review-patches'
const targets = (...ids: string[]) => ['--include-legacy', ...ids.flatMap(id => ['--legacy-target', id])]
const acknowledge = (...ids: string[]) => ids.flatMap(id => ['--acknowledge-legacy-data-loss', id])
const hash = (id: string) => createHash('sha256').update(id).digest('hex')
const metadataRow = JSON.stringify({ turnId: 'turn-one', metadata: { model: 'legacy-model', modelSource: 'execution', effort: null, effortSource: 'submitted' } }) + '\n'
const markerContents = '1774425600000\n'

describe('legacy reset discovery and validation', () => {
  it('lists target scopes and protection without trying to resolve the state directory', () => {
    const result = run(['--list-legacy-targets'], { CODEX_HOME: '/' })
    expect(result.code, result.output).toBe(0)
    expect(result.output).toContain('cloudflared-prompt-marker [shared; safe]')
    expect(result.output).toContain('turn-metadata [profile; conditional')
    expect(result.output).toContain('native-project-and-pin-state [profile; blocked]')
    expect(result.output).toContain('retired-browser-storage [browser; manual]')
    expect(result.output).not.toContain('Would delete')
  })

  it('requires explicit valid targets and access to their scope', () => {
    expect(run(['--legacy-target', 'turn-metadata']).output).toContain('requires --include-legacy')
    expect(run(['--include-legacy']).output).toContain('at least one')
    expect(run(targets('../config.toml')).output).toContain('Unknown legacy target')
    expect(run(targets('generated-webui-password')).output).toContain('requires --shared')
    expect(run([...targets('first-launch-plugin-tip'), '--profile', 'named']).output).toContain('predates named profiles')
    expect(run([...targets('portable-fork-records'), ...acknowledge('portable-fork-records')]).output).toContain('blocked')
    expect(run(targets('retired-browser-storage')).output).toContain('manual')
    expect(run([...targets('turn-metadata'), ...acknowledge('provider-state')]).output).toContain('does not match')
  })
})

describe.skipIf(process.platform !== 'linux')('legacy reset execution and preservation', () => {
  it('keeps historical artifacts in normal reset mode', () => {
    write(join(home, marker), markerContents)
    write(join(home, metadataDir, hash('thread') + '.jsonl'), metadataRow)
    json(join(home, stateFile), { [tip]: true, [telegram]: { botToken: 'old-token' } })
    write(join(home, preferences))
    const standard = run(['--all-profiles', '--shared', ...execute])
    expect(standard.code, standard.output).toBe(0)
    expect(existsSync(join(home, preferences))).toBe(false)
    for (const path of [marker, metadataDir]) expect(existsSync(join(home, path))).toBe(true)
    expect(JSON.parse(readFileSync(join(home, stateFile), 'utf8'))).toHaveProperty(tip, true)
  })

  it('selects safe artifacts across legacy versions and respects the selected scope', () => {
    write(join(home, marker), markerContents)
    write(join(home, 'codexui-password'), 'abc-123-def\n')
    write(join(home, metadataDir, hash('thread') + '.jsonl'), metadataRow)
    json(join(home, stateFile), { [tip]: false, [telegram]: { botToken: 'old-token' } })
    const profileOnly = run(['--all-legacy'])
    expect(profileOnly.code, profileOnly.output).toBe(0)
    expect(profileOnly.output).toContain(tip)
    expect(profileOnly.output).not.toContain(marker)
    const scoped = run(['--all-legacy', '--all-profiles', '--shared', ...execute])
    expect(scoped.code, scoped.output).toBe(0)
    expect(scoped.output).toContain('2 filesystem actions')
    expect(existsSync(join(home, marker))).toBe(false)
    expect(existsSync(join(home, 'codexui-password'))).toBe(true)
    expect(existsSync(join(home, metadataDir))).toBe(true)
    expect(JSON.parse(readFileSync(join(home, stateFile), 'utf8'))).toEqual({ [telegram]: { botToken: 'old-token' } })
  })

  it('plans selected shared files and two mixed keys with one rewrite and preserves active recovery', () => {
    const native = '"official": { "counter":90071992547409931234, "label":"keep" }'
    const state = `{${native},"electron-saved-workspace-roots":["/official"],"pinned-thread-ids":["old-pin"],"${migration}":{"connection":{"completed":false}},"${transfer}":{"x":{"stage":"prepared"}},"${tip}":true,"${telegram}":{"botToken":"old-token"},"thread-titles":{"titles":{},"order":[]}}`
    write(join(home, stateFile), state)
    write(join(home, marker), markerContents)
    write(join(home, 'codexui-password'), 'abc-123-def\n')
    const pending = { example: { pending: { token: 'pending', text: 'do not discard', previous: [] } } }
    json(join(home, index), pending)
    write(join(home, auth))
    write(join(home, preferences))
    mkdirSync(join(home, 'automations'))
    const selected = [...targets('cloudflared-prompt-marker', 'first-launch-plugin-tip', 'telegram-inline-settings'), '--shared']
    const dry = run([...selected, '--dry-run'])
    expect(dry.code, dry.output).toBe(0)
    expect(dry.output).toContain(`Would delete "${join(home, marker)}"`)
    expect(dry.output).toContain('Would modify')
    expect(dry.output).toContain(`remove "${tip}", "${telegram}"`)
    expect(dry.output).not.toContain('old-token')
    expect(readFileSync(join(home, stateFile), 'utf8')).toBe(state)
    expect(existsSync(join(home, marker))).toBe(true)

    const denied = run([...selected, ...execute])
    expect(denied.code, denied.output).toBe(1)
    expect(denied.output).toContain('--acknowledge-legacy-data-loss telegram-inline-settings')
    expect(existsSync(join(home, marker))).toBe(true)

    const clean = run([...selected, ...acknowledge('telegram-inline-settings'), ...execute])
    expect(clean.code, clean.output).toBe(0)
    expect(clean.output.match(/^Modified /gm)).toHaveLength(1)
    expect(existsSync(join(home, marker))).toBe(false)
    for (const path of ['codexui-password', auth, preferences, 'automations']) expect(existsSync(join(home, path))).toBe(true)
    const updated = readFileSync(join(home, stateFile), 'utf8')
    expect(updated).toContain(native)
    const parsed = JSON.parse(updated)
    expect(parsed).not.toHaveProperty(tip)
    expect(parsed).not.toHaveProperty(telegram)
    expect(parsed).toMatchObject({ [migration]: { connection: { completed: false } }, [transfer]: { x: { stage: 'prepared' } },
      'pinned-thread-ids': ['old-pin'], 'electron-saved-workspace-roots': ['/official'], 'thread-titles': { titles: {}, order: [] } })
    expect(JSON.parse(readFileSync(join(home, index), 'utf8'))).toEqual(pending)
    const again = run([...selected, ...acknowledge('telegram-inline-settings'), ...execute])
    expect(again.output).toContain('0 filesystem actions')
  })

  it('cleans only the selected profile sidecars and never deletes the profile directory', () => {
    const a = profile(home, 'work.a')
    const b = profile(home, 'work.b')
    const unscoped = join(home, metadataDir, hash('thread') + '.jsonl')
    const identity = hash(JSON.stringify(['ws://127.0.0.1:4500', '/codex']))
    const selected = join(a, metadataDir, identity, hash('thread') + '.jsonl')
    const other = join(b, metadataDir, identity, hash('thread') + '.jsonl')
    for (const path of [unscoped, selected, other]) write(path, metadataRow)
    const lock = selected + '.lock'
    mkdirSync(lock)
    utimesSync(lock, new Date(1), new Date(1))
    const args = [...targets('turn-metadata'), '--profile', 'work.a']
    const preview = run(args)
    expect(preview.code, preview.output).toBe(0)
    expect(preview.output).toContain(`Would delete "${selected}"`)
    expect(preview.output).not.toContain(other)
    expect(preview.output).not.toContain(unscoped)
    const result = run([...args, ...acknowledge('turn-metadata'), ...execute])
    expect(result.code, result.output).toBe(0)
    expect(existsSync(join(a, metadataDir))).toBe(false)
    expect(existsSync(a)).toBe(true)
    const all = run([...targets('turn-metadata'), '--all-profiles', ...acknowledge('turn-metadata'), ...execute])
    expect(all.code, all.output).toBe(0)
    expect(existsSync(unscoped)).toBe(false)
    expect(existsSync(other)).toBe(false)
  })

  it('refuses malformed sidecars and unverified mixed fields before applying any action', () => {
    const invalid = join(home, metadataDir, hash('might-be-other') + '.jsonl')
    write(invalid, '{"type":"native-rollout","payload":{}}\n')
    write(join(home, marker), markerContents)
    json(join(home, stateFile), { [telegram]: { botToken: 'token', unrelated: true } })
    const sidecars = run([...targets('cloudflared-prompt-marker', 'turn-metadata'), '--shared', ...acknowledge('turn-metadata'), ...execute])
    expect(sidecars.code, sidecars.output).toBe(1)
    expect(sidecars.output).toContain('Unverified legacy contents')
    const mixed = run([...targets('cloudflared-prompt-marker', 'telegram-inline-settings'), '--shared', ...acknowledge('telegram-inline-settings'), ...execute])
    expect(mixed.code, mixed.output).toBe(1)
    expect(mixed.output).toContain('Unverified legacy key')
    expect(existsSync(invalid)).toBe(true)
    expect(existsSync(join(home, marker))).toBe(true)
  })

  it('verifies historical provider files, generated passwords, Skills sync, Telegram settings and patches', () => {
    const provider = { enabled: true, apiKey: 'provider-key', model: 'openrouter/free', provider: 'openrouter' }
    json(join(home, 'webui-free-mode.json'), provider)
    json(join(home, 'webui-custom-providers.json'), { ...provider, providerKeys: { openrouter: 'provider-key' } })
    json(join(home, 'skills-sync.json'), { githubToken: 'github-token', repoName: 'skills', installedOwners: { sample: 'owner' } })
    json(join(home, 'telegram-bridge.json'), { botToken: 'bot-token' })
    json(join(home, 'telegram-bridge.json.tmp'), { botToken: 'bot-token', completionNotifications: { enabled: true, chatIds: [10], appUrl: '' } })
    write(join(home, 'codexui-password'), 'abc-123-def\n')
    const patch = join(root, oldPatchDir, '1774425600000-1a2b.patch')
    write(patch, 'diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-before\n+after\n')
    for (const path of ['skills/sample/SKILL.md', 'auth.json', 'accounts/saved/auth.json', 'config.toml']) write(join(home, path), path)
    const ids = ['provider-state', 'skills-sync-settings', 'telegram-settings', 'generated-webui-password', 'review-patches']
    const result = run([...targets(...ids), '--shared', ...acknowledge(...ids), ...execute])
    expect(result.code, result.output).toBe(0)
    for (const path of ['skills/sample/SKILL.md', 'auth.json', 'accounts/saved/auth.json', 'config.toml']) {
      expect(readFileSync(join(home, path), 'utf8')).toBe(path)
    }
    expect(existsSync(patch)).toBe(false)
    expect(result.output).toContain('8 filesystem actions')
    for (const secret of ['provider-key', 'github-token', 'bot-token', 'abc-123-def']) expect(result.output).not.toContain(secret)
  })

  it.each(['symlink', 'hardlink', 'ancestor'])('refuses %s substitution of verified files', (type) => {
    const isolated = join(root, 'outside', 'official.jsonl')
    write(isolated, metadataRow)
    const expected = join(home, metadataDir, hash('thread') + '.jsonl')
    mkdirSync(home)
    if (type === 'ancestor') symlinkSync(dirname(isolated), join(home, metadataDir))
    else {
      mkdirSync(dirname(expected))
      if (type === 'symlink') symlinkSync(isolated, expected)
      else linkSync(isolated, expected)
    }
    const result = run([...targets('turn-metadata'), ...acknowledge('turn-metadata'), ...execute])
    expect(result.code, result.output).toBe(1)
    expect(result.output).toMatch(/Refusing a (symbolic link|special or hard-linked file)/)
    expect(readFileSync(isolated, 'utf8')).toBe(metadataRow)
  })

  it('requires a separately confirmed remote run and an exact private upload batch', () => {
    const remoteHome = join(root, 'remote')
    const remoteTmp = join(root, 'remote-tmp')
    const local = join(root, oldUploadDir, 'f-lOcAl1', 'keep.txt')
    const remote = join(remoteTmp, oldUploadDir, 'f-ReMoTe', 'a file.txt')
    const other = join(remoteTmp, oldUploadDir, 'f-KeEpIt', 'other.pdf')
    const currentRemote = join(remoteHome, 'cache/model-history/v1', hash('current') + '.json')
    const rollout = join(remoteHome, 'archived_sessions/rollout-native.jsonl')
    json(currentRemote, { version: 1, sourcePath: rollout, modifiedAtMs: 123, turns: [] })
    for (const path of [local, remote, other, rollout]) write(path)
    chmodSync(dirname(remote), 0o700)
    chmodSync(dirname(other), 0o700)
    const args = [...targets('staged-uploads'), '--remote', '--remote-codex-home', remoteHome]
    const env = { TMPDIR: remoteTmp }
    const pick = ['--legacy-upload-file', 'f-ReMoTe/a file.txt']
    const dry = run([...args, ...pick], env)
    expect(dry.code, dry.output).toBe(0)
    expect(dry.output).toContain(`Would delete "${remote}"`)
    expect(existsSync(remote)).toBe(true)
    for (const bad of ['../passwd', 'f-ReMoTe/..', 'f-ReMoTe/../../passwd', 'f-ReMoTe/dir\\file']) {
      expect(run([...args, '--legacy-upload-file', bad], env).output).toContain('exact historical upload filename')
    }
    expect(run([...args, ...pick, ...acknowledge('staged-uploads'), ...execute, '--confirm-remote', 'wrong-host'], env).code).toBe(1)
    const result = run([...args, ...pick, ...acknowledge('staged-uploads'), ...execute, '--confirm-remote', hostname()], env)
    expect(result.code, result.output).toBe(0)
    expect(existsSync(dirname(remote))).toBe(false)
    for (const path of [local, other, currentRemote, rollout]) expect(existsSync(path), path).toBe(true)
  })
})
