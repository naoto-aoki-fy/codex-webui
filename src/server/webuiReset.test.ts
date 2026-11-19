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
      `import { holdWebuiWriterLease } from ${JSON.stringify(maintenance)}; holdWebuiWriterLease(); process.once('SIGTERM', () => process.exit(0)); console.log('ready'); setInterval(() => {}, 1000)`])
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
      'scripts/reset-webui-legacy.mjs', 'scripts/reset-webui-legacy-registry.mjs', 'src/server/webuiMaintenance.mjs']) {
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
    const result = run(['--build', '--include-legacy', ...execute], {}, script)
    expect(result.code, result.output).toBe(0)
    for (const path of generated) expect(existsSync(join(checkout, path))).toBe(false)
    for (const path of ['output/unrelated', 'src/source.txt']) expect(existsSync(join(checkout, path))).toBe(true)
  })
})

const include = '--include-legacy'
const acknowledge = '--acknowledge-legacy-data-loss'
const marker = '.cloudflared-install-prompted'
const retiredTip = 'first-launch-plugins-card-dismissed'
const sidecar = 'codexapp-turn-metadata/' + 'c'.repeat(64) + '.jsonl'
const row = JSON.stringify({ turnId: 'turn', metadata: { model: 'historic', modelSource: 'submitted' } }) + '\n'
const providerState = { enabled: true, apiKey: 'test-provider-key', model: 'historical' }

describe.skipIf(process.platform !== 'linux')('historical WebUI reset', () => {
  it('retains old state by default and automatically selects every eligible era with one flag', () => {
    const markerPath = join(home, marker)
    const tipPath = join(home, stateFile)
    const providerPath = join(home, 'webui-free-mode.json')
    const metadata = join(home, sidecar)
    const schema = join(root, 'codex-web-local-schema-abcXYZ')
    write(markerPath, '1712345678901\n')
    json(tipPath, { [retiredTip]: true })
    json(providerPath, providerState)
    write(metadata, row)
    mkdirSync(schema, { mode: 0o700 })
    json(join(schema, 'ClientRequest.json'), {
      $schema: 'http://json-schema.org/draft-07/schema#', title: 'ClientRequest', oneOf: [],
    })
    const flags = ['--all-profiles', '--shared']
    const base = run([...flags, ...execute])
    expect(base.code, base.output).toBe(0)
    for (const target of [markerPath, tipPath, providerPath, metadata, schema]) expect(existsSync(target)).toBe(true)

    const preview = run([...flags, include, '--dry-run'])
    expect(preview.code, preview.output).toBe(0)
    expect(preview.output).toContain('Would modify ' + JSON.stringify(tipPath))
    expect(preview.output).toContain('Would delete ' + JSON.stringify(markerPath))
    expect(preview.output).toContain('requires ' + acknowledge)
    expect(preview.output).not.toContain(providerState.apiKey)
    expect(existsSync(markerPath)).toBe(true)
    expect(run([acknowledge]).output).toContain('requires ' + include)
    expect(run([...flags, include, '--execute']).output).toContain('requires --offline')

    const safe = run([...flags, include, ...execute])
    expect(safe.code, safe.output).toBe(0)
    expect(readFileSync(tipPath, 'utf8')).toBe('{}')
    for (const target of [markerPath, schema]) expect(existsSync(target)).toBe(false)
    for (const target of [providerPath, metadata]) expect(existsSync(target)).toBe(true)
    const full = run([...flags, include, acknowledge, ...execute])
    expect(full.code, full.output).toBe(0)
    for (const target of [providerPath, metadata]) expect(existsSync(target)).toBe(false)
    expect(run([...flags, include, acknowledge, ...execute]).output).toContain('0 filesystem actions')
  })

  it('protects separate profile, shared and pre-profile server identity scopes', () => {
    const a = profile(home, 'a')
    const b = profile(home, 'b')
    for (const path of [a, b]) json(join(path, preferences), {})
    const oldIdentity = join(home, 'codexapp-turn-metadata', 'a'.repeat(64), 'b'.repeat(64) + '.jsonl')
    write(oldIdentity, '\n' + row)
    write(join(home, sidecar), row)
    write(join(home, marker), '1712345678901\n')
    json(join(home, stateFile), { [retiredTip]: true })
    const named = run(['--profile', 'a', include, acknowledge, ...execute])
    expect(named.code, named.output).toBe(0)
    expect(existsSync(a)).toBe(false)
    for (const target of [b, oldIdentity, join(home, sidecar), join(home, stateFile), join(home, marker)]) {
      expect(existsSync(target), target).toBe(true)
    }
    const defaultProfile = run(['--profile', 'legacy', include, acknowledge, ...execute])
    expect(defaultProfile.code, defaultProfile.output).toBe(0)
    expect(existsSync(join(home, sidecar))).toBe(false)
    for (const target of [b, oldIdentity, join(home, marker)]) expect(existsSync(target), target).toBe(true)
    const all = run(['--all-profiles', '--shared', include, acknowledge, ...execute])
    expect(all.code, all.output).toBe(0)
    for (const target of [b, oldIdentity, join(home, marker)]) expect(existsSync(target), target).toBe(false)
  })

  it('rewrites only verified historical members and retains migration and recovery data', () => {
    const path = join(home, stateFile)
    const native = ' "native": {"precise": 123456789876543212345 } '
    const keys = {
      [migration]: { 'verified-migration': { completed: true } },
      [transfer]: { attempt: { stage: 'injecting' } },
      'thread-queue-state': { thread: [{ id, text: 'unsent' }] },
      'pinned-thread-ids': ['native'],
      'telegram-bridge': { botToken: 'secret', unknown: true },
    }
    const retained = JSON.stringify(keys)
    write(path, `{${native}, "${retiredTip}": true, "thread-pinned-ids": ["old"],${retained.slice(1)}`)
    const pending = { thread: { pending: { token: id, previous: [], text: 'payload' } } }
    json(join(home, index), pending)
    const scratch = join(home, `${index}.${id}.tmp`)
    json(scratch, pending)
    json(join(home, inventory), { records: [{ status: 'unknown' }] })
    write(join(home, journal), '{"path":"/remote/preserved"}\n')
    const outbox = join(home, 'telegram-notification-outbox.json')
    json(outbox, { pending: [{ text: 'awaiting delivery' }], settled: [], lastError: '' })
    const schedules = join(home, 'codexui-automations', 'store.json')
    json(schedules, { version: 1, automations: [], runs: [
      { id: 'run_mhd3_aabbcc', automationId: 'automation_mhd2_aabbcc', status: 'running' },
    ] })
    json(join(home, 'webui-custom-providers.json'), { ...providerState, unrelated: true })
    write(join(home, 'skills-sync.json'), '{"githubToken":{"unverified":true},"githubToken":"test"}')
    const malformed = join(home, 'codexapp-turn-metadata', 'e'.repeat(64) + '.jsonl')
    write(malformed, row + '{"truncated":')
    const result = run(['--shared', include, acknowledge, ...execute])
    expect(result.code, result.output).toBe(0)
    const after = readFileSync(path, 'utf8')
    expect(after).toContain(native)
    expect(JSON.parse(after)).toEqual({ native: { precise: 123456789876543212345 }, ...keys })
    for (const target of [index, basename(scratch), inventory, journal, basename(outbox), 'webui-custom-providers.json',
      'skills-sync.json']) expect(existsSync(join(home, target)), target).toBe(true)
    expect(existsSync(malformed)).toBe(true)
    expect(existsSync(schedules)).toBe(true)
  })

  it('cleans verified retired integrations, automation runs and search database layouts', () => {
    const integrations = new Map([
      ['telegram-bridge.json', { botToken: 'test', chatIds: [42], allowedUserIds: ['*'] }],
      ['telegram-notification-outbox.json', { pending: [], settled: ['delivery'], lastError: '' }],
      [`telegram-notification-outbox.json.${id}.tmp`, { pending: [], settled: [], lastError: '' }],
      ['skills-sync.json', { githubToken: 'test', installedOwners: { skill: 'owner' } }],
      ['pulse.json', { settings: { showInNewChats: true, referenceMemoryInSuggestions: false }, feedbackHistory: [] }],
    ])
    for (const [name, payload] of integrations) json(join(home, name), payload)
    write(join(home, 'codexui-password'), 'abc-12z-def\n')
    const automations = join(home, 'codexui-automations')
    const runId = 'run_mhd3_aabbcc'
    const automationId = 'automation_mhd2_aabbcc'
    json(join(automations, 'store.json'), { version: 1,
      automations: [{ id: automationId, title: 'Old schedule', prompt: 'unique schedule', projectPaths: [], enabled: true }],
      runs: [{ id: runId, automationId, status: 'completed' }],
    })
    write(join(automations, 'runs', runId, 'last-message.txt'))
    const native = join(home, 'automations', 'same', 'automation.toml')
    write(native, 'native scheduling')
    const search = join(root, 'codex-web-local-thread-search-Abc321')
    mkdirSync(search, { mode: 0o700 })
    write(join(search, 'manifest.0'), '\x0a\x0dthread_search\x0a\x0bcontent_vec')
    write(join(search, '0', '0.wal'))
    write(join(search, 'idmap.0', 'MANIFEST-000005'))
    const unknown = join(root, 'codex-web-local-thread-search-Def321')
    mkdirSync(unknown, { mode: 0o700 })
    write(join(unknown, 'manifest.0'), 'different collection')
    const patch = join(root, 'codexui-review-patches', '1712345678901-c0de.patch')
    write(patch, 'diff --git a/old b/old\n')
    const result = run(['--shared', include, acknowledge, ...execute])
    expect(result.code, result.output).toBe(0)
    for (const target of [...[...integrations.keys(), 'codexui-password'].map(name => join(home, name)),
      automations, search, patch]) expect(existsSync(target), target).toBe(false)
    for (const target of [native, unknown]) expect(existsSync(target)).toBe(true)
  })

  it('keeps ambiguous remote attachment references and verifies older cache records on the App Server host', () => {
    const remote = join(root, 'remote')
    const sourcePath = join(remote, 'sessions/2026/11/19/rollout-old.jsonl')
    const cache = join(remote, 'cache/model-history/v1', 'd'.repeat(64) + '.json')
    const stage = join(root, 'codex-web-uploads', 'f-Abc123', 'old.txt')
    const upload = join(remote, 'codexapp-uploads', id + '-old.txt')
    write(sourcePath)
    write(stage)
    write(upload)
    write(join(home, marker), '1712345678901\n')
    json(cache, { version: 1, sourcePath, modifiedAtMs: 1, turns: [
      { turnId: 'turn', metadata: { effort: null, effortSource: 'execution' } },
    ] })
    const args = ['--remote', '--remote-codex-home', remote, include, acknowledge]
    expect(run([...args, '--shared']).output).toContain('separate commands')
    const dry = run(args)
    expect(dry.code, dry.output).toBe(0)
    expect(dry.output).toContain('Would delete ' + JSON.stringify(cache))
    expect(dry.output).toContain('historical staged attachments')
    expect(existsSync(cache)).toBe(true)
    expect(run([...args, ...execute]).output).toContain('--confirm-remote')
    const result = run([...args, ...execute, '--confirm-remote', hostname()])
    expect(result.code, result.output).toBe(0)
    expect(existsSync(cache)).toBe(false)
    for (const path of [stage, upload, sourcePath, join(home, marker)]) expect(existsSync(path)).toBe(true)
  })

  it.each(['symbolic', 'hard', 'active lock'])('preflights %s legacy paths before making any changes', (kind) => {
    const original = join(root, 'original.json')
    json(original, providerState)
    write(join(home, marker), '1712345678901\n')
    if (kind === 'symbolic') symlinkSync(original, join(home, 'webui-free-mode.json'))
    else if (kind === 'hard') linkSync(original, join(home, 'webui-free-mode.json'))
    else mkdirSync(join(home, sidecar + '.lock'), { recursive: true })
    const result = run(['--all-profiles', '--shared', include, acknowledge, ...execute])
    expect(result.code, result.output).toBe(1)
    expect(result.output).not.toContain('Deleted ')
    expect(existsSync(join(home, marker))).toBe(true)
    expect(JSON.parse(readFileSync(original, 'utf8'))).toEqual(providerState)
  })

  it('refuses a mounted legacy directory before applying any deletion', (context) => {
    const patches = join(root, 'codexui-review-patches')
    mkdirSync(patches)
    write(join(home, marker), '1712345678901\n')
    const result = spawnSync('unshare', ['--user', '--map-root-user', '--mount', 'sh', '-c',
      'mount -t tmpfs tmpfs "$1" || exit 77; shift; "$@"',
      'sh', patches, process.execPath, backendScript, '--shared', include, acknowledge, ...execute], {
      encoding: 'utf8', env: { ...process.env, CODEX_HOME: home, TMPDIR: root, CODEXUI_CONNECTION_PROFILE: '' },
    })
    const missingUnshare = result.error && 'code' in result.error && result.error.code === 'ENOENT'
    if (missingUnshare || result.status === 77 || result.stderr?.includes('unshare failed')) context.skip()
    expect(result.status, result.stdout + result.stderr).toBe(1)
    expect(result.stderr).toContain('Refusing a mounted cleanup target')
    expect(existsSync(join(home, marker))).toBe(true)
  })
})
