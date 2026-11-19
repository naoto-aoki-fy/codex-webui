#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { homedir, hostname, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { acquireWebuiResetLease } from '../src/server/webuiMaintenance.mjs'
import { apply, assertUnmounted, fingerprint, inside, inspect, list, read } from './reset-webui-files.mjs'
import { readGlobalStateReset } from './reset-webui-global-state.mjs'
import { legacyFlags, legacyGlobalKeys, planLegacyCleanup } from './reset-webui-legacy.mjs'
import { legacyRemoteCache, uuid } from './reset-webui-legacy-registry.mjs'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const host = hostname()
const storeTemp = file => new RegExp(`^\\.${file.replaceAll('.', '\\.')}\\.${uuid}\\.tmp$`, 'u')
const resetTemp = new RegExp(`^\\.\\.codex-global-state\\.json\\.webui-reset-${uuid}\\.tmp$`, 'u')
const globalFile = '.codex-global-state.json'
const modelPreferences = 'codexapp-model-preferences.json'
const inventory = 'codexapp-upload-inventory.json'
const builds = ['dist', 'dist-cli', 'output/playwright', 'test-results']
const uploadName = new RegExp(`^${uuid}-[a-zA-Z0-9._-]{0,120}$`, 'u')
const inlineMediaName = /^(?:inline-image|inline-file|generated-image)-[a-zA-Z0-9_.-]+-[0-9a-f]{40}(?:\.(?:png|jpg|webp|gif|svg|pdf))?$/u
const hashName = /^[0-9a-f]{64}$/u
const freshLockNs = 30_000_000_000n

const help = `Usage:
  pnpm reset:webui [--profile ID | --all-profiles] [--shared] [--build] [legacy flags] [--dry-run]
  pnpm reset:webui [local scope flags] --execute --offline
  node scripts/reset-webui.mjs --remote --remote-codex-home /path [--remote-upload-root /path --remote-upload NAME ...] [legacy flags] [--dry-run]
  node scripts/reset-webui.mjs [remote scope flags] --execute --offline --confirm-remote HOST

Dry run is the default. Local mode uses CODEX_HOME and defaults to CODEXUI_CONNECTION_PROFILE or legacy.
--shared includes WebUI upload accounting, login sessions and local inline media.
--build adds generated artifacts in this checkout.
--include-legacy adds verified historical cleanup to every standard action in the selected scope.
--acknowledge-legacy-data-loss allows additional historical cleanup of potentially unique data.
--offline confirms that all writers for the selected paths are stopped. Execution requires Linux.
Run remote mode on the App Server host. It clears verified WebUI model-history caches and
only uploads explicitly named by --remote-upload. Review references before naming an upload.`

const quote = value => JSON.stringify(value)
const line = (verb, path, detail = '') => console.log(`${verb} ${quote(path)}${detail ? ` (${detail})` : ''}`)

function safeBase(raw, label, explicitAbsolute = false) {
  if (!raw || /[\x00-\x1f\x7f]/u.test(raw) || raw.split(/[\\/]/u).includes('..') || (explicitAbsolute && !isAbsolute(raw))) {
    throw new Error(`Unsafe ${label}: ${quote(raw)}`)
  }
  const path = resolve(raw)
  if (inside(path, homedir()) || inside(path, repo)) throw new Error(`Unsafe ${label}: ${quote(path)}`)
  const info = inspect(path)
  if (info && !info.isDirectory()) throw new Error(`Expected a directory for ${label}: ${quote(path)}`)
  return path
}

function options() {
  const { values: args } = parseArgs({ options: {
    help: { type: 'boolean', short: 'h' },
    'dry-run': { type: 'boolean' },
    execute: { type: 'boolean' },
    offline: { type: 'boolean' },
    profile: { type: 'string' },
    'all-profiles': { type: 'boolean' },
    shared: { type: 'boolean' },
    build: { type: 'boolean' },
    remote: { type: 'boolean' },
    'remote-codex-home': { type: 'string' },
    'remote-upload-root': { type: 'string' },
    'remote-upload': { type: 'string', multiple: true },
    'confirm-remote': { type: 'string' },
    ...legacyFlags,
  } })
  if (args.help) return args
  if (args.execute && args['dry-run']) throw new Error('Choose either --dry-run or --execute')
  if (args.execute && !args.offline) throw new Error('--execute requires --offline after all writers are stopped')
  if (args.execute && process.platform !== 'linux') throw new Error('Reset execution requires Linux')
  if (args['acknowledge-legacy-data-loss'] && !args['include-legacy']) {
    throw new Error('--acknowledge-legacy-data-loss requires --include-legacy')
  }
  if (args.profile !== undefined && args['all-profiles']) throw new Error('Choose either --profile or --all-profiles')
  if (args.remote) {
    if (args.profile !== undefined || args['all-profiles'] || args.shared || args.build) {
      throw new Error('Remote and backend reset scopes require separate commands')
    }
    if (args.execute && args['confirm-remote'] !== host) {
      throw new Error(`Remote execution requires --confirm-remote ${quote(host)} on the App Server host`)
    }
    args.home = safeBase(args['remote-codex-home'], 'remote Codex home', true)
    args.uploadRoot = args['remote-upload-root'] === undefined
      ? args.home : safeBase(args['remote-upload-root'], 'remote upload root', true)
    args.uploads = [...new Set(args['remote-upload'] ?? [])]
    for (const name of args.uploads) {
      if (!uploadName.test(name)) throw new Error(`Expected an exact WebUI upload filename: ${quote(name)}`)
    }
  } else {
    if (['remote-codex-home', 'remote-upload-root', 'remote-upload', 'confirm-remote'].some(key => args[key] !== undefined)) {
      throw new Error('Remote options require --remote')
    }
    args.home = safeBase(process.env.CODEX_HOME?.trim() || join(homedir(), '.codex'), 'backend Codex home')
    if (args.build && builds.some(name => inside(join(repo, name), args.home))) {
      throw new Error(`Codex home overlaps a build cleanup target: ${quote(args.home)}`)
    }
    args.profile ??= process.env.CODEXUI_CONNECTION_PROFILE?.trim() || 'legacy'
    if (!args['all-profiles'] && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/u.test(args.profile)) {
      throw new Error('Invalid connection profile ID')
    }
    if (args.shared) args.media = safeBase(tmpdir(), 'OS temporary directory', true)
  }
  return args
}

function createPlan() {
  const observations = new Map()
  const actions = new Map()
  const notices = []
  const removes = path => actions.has(path) && actions.get(path).kind !== 'rewrite'
  const notice = (what, path, detail) => { notices.push([what, path, detail]) }
  function requireOwner(path, info) {
    if (process.geteuid && info.uid !== BigInt(process.geteuid())) {
      throw new Error(`Cleanup target is owned by another user: ${quote(path)}`)
    }
  }
  function observe(path, anchor = false) {
    if (!anchor) assertUnmounted(path)
    const info = inspect(path)
    if (observations.has(path) && fingerprint(observations.get(path)) !== fingerprint(info)) {
      throw new Error(`Changed during reset: ${quote(path)}`)
    }
    observations.set(path, info)
    return info
  }
  function directory(path, anchor = false) {
    const info = observe(path, anchor)
    if (!info) return null
    if (!info.isDirectory()) throw new Error(`Expected a directory: ${quote(path)}`)
    return info
  }
  function file(path) {
    const info = observe(path)
    if (info && !info.isFile()) throw new Error(`Expected a file: ${quote(path)}`)
    return info
  }
  function removeFile(path, reason) {
    if (actions.has(path)) return
    const info = file(path)
    if (!info) return notice('Missing', path)
    requireOwner(path, info)
    actions.set(path, { kind: 'unlink', path, info, reason })
  }
  function removeDirectory(path, info, reason) {
    if (actions.has(path)) return
    requireOwner(path, info)
    actions.set(path, { kind: 'rmdir', path, info, reason })
  }
  function names(path, info) {
    return info ? list(path, info) : []
  }
  function removeLock(path) {
    if (actions.has(path)) return
    const info = directory(path)
    if (!info) return
    if (names(path, info).length > 0 || BigInt(Date.now()) * 1_000_000n - info.mtimeNs < freshLockNs) {
      throw new Error(`Persistence lock may be active or has unknown contents: ${quote(path)}`)
    }
    removeDirectory(path, info, 'abandoned WebUI persistence lock')
  }
  function verify() {
    for (const [path, info] of observations) {
      if (fingerprint(info) !== fingerprint(inspect(path))) throw new Error(`Changed during reset: ${quote(path)}`)
    }
  }
  return { actions, notices, notice, directory, file, observe, names, removeFile, removeDirectory, removeLock, requireOwner, removes, verify }
}

function planProfileState(plan, statePath, named) {
  const { notice, file, actions, removeFile } = plan
  const state = file(statePath)
  if (!state) return notice('Missing', statePath)
  const reset = readGlobalStateReset(read(statePath, state), statePath)
  let result = reset.select()
  function schedule() {
    if (named && result.preserved.length === 0) {
      removeFile(statePath, result.keys.length ? 'WebUI-only keys ' + result.keys.map(quote).join(', ') : 'empty WebUI profile state')
    } else if (result.keys.length) {
      if (!actions.has(statePath)) {
        if (!named && plan.observe(statePath + '.lock')) {
          throw new Error(`Shared Codex global state is locked: ${quote(statePath + '.lock')}`)
        }
        plan.requireOwner(statePath, state)
      }
      // Update the original rewrite with the union of eligible keys.
      actions.set(statePath, { kind: 'rewrite', path: statePath, info: state, replacement: result.replacement, reason: 'remove ' + result.keys.map(quote).join(', ') })
    }
  }
  function report() {
    if (result.preserved.length) notice('Preserve keys in', statePath, result.preserved.map(quote).join(', '))
    if (!actions.has(statePath)) notice('Preserve', statePath, 'no removable WebUI keys')
  }
  schedule()
  if (named) return report()
  return args => {
    if (args['include-legacy']) {
      const keys = legacyGlobalKeys(plan, args, statePath, reset.historicalState)
      if (keys.length) {
        result = reset.select(keys)
        schedule()
      }
    }
    report()
  }
}

function planProfile(plan, directory, named, group) {
  const { notice, names, removeFile, removeLock, removeDirectory } = plan
  if (!group) return notice('Missing', directory)
  const entries = names(directory, group)
  const statePath = join(directory, globalFile)
  const finishState = planProfileState(plan, statePath, named)
  removeFile(join(directory, modelPreferences), 'profile state')
  removeLock(join(directory, modelPreferences + '.lock'))
  if (named) removeLock(statePath + '.lock')
  for (const name of entries) {
    const path = join(directory, name)
    if (storeTemp(modelPreferences).test(name) || resetTemp.test(name) ||
      (named && storeTemp(globalFile).test(name))) {
      removeFile(path, 'WebUI persistence temporary file')
    } else if (named && ![globalFile, globalFile + '.lock',
      modelPreferences, modelPreferences + '.lock'].includes(name)) {
      notice('Preserve', path, 'unrecognized profile content')
    } else if (!named && (name === globalFile + '.lock' || storeTemp(globalFile).test(name))) {
      notice('Preserve', path, 'shared global-state scratch file')
    }
  }
  // A profile directory is removed only if each child is a planned deletion.
  if (named && entries.every(name => plan.removes(join(directory, name)))) {
    removeDirectory(directory, group, 'empty WebUI profile directory')
  }
  return finishState
}

function planShared(plan, args, homeNames) {
  const { notice, names, directory, removeFile, removeLock, removeDirectory } = plan
  for (const fileName of [inventory, 'codexapp-uploads.jsonl', 'webui-auth-sessions.json', 'webui-auth-sessions.json.tmp']) {
    removeFile(join(args.home, fileName), 'shared WebUI state')
  }
  removeLock(join(args.home, inventory + '.lock'))
  for (const name of homeNames) {
    if (storeTemp(inventory).test(name)) removeFile(join(args.home, name), 'upload inventory temporary file')
  }
  const media = join(args.media, 'codex-web-inline-media')
  const mediaInfo = directory(media)
  if (!mediaInfo) return notice('Missing', media)
  const entries = names(media, mediaInfo)
  for (const name of entries) {
    const path = join(media, name)
    if (inlineMediaName.test(name)) removeFile(path, 'WebUI inline media')
    else notice('Preserve', path, 'unrecognized inline media content')
  }
  if (entries.every(name => inlineMediaName.test(name))) removeDirectory(media, mediaInfo, 'empty inline media directory')
}

function planBuild(plan) {
  // Git is required here to ensure an unusual checkout has no tracked data in
  // the usual generated directories. Abort rather than guessing on failure.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  const git = (...args) => execFileSync('git', args, { cwd: repo, env })
  if (git('rev-parse', '--show-toplevel').toString().trimEnd() !== repo) {
    throw new Error('Build cleanup requires the script to be in its Git checkout')
  }
  const tracked = git('ls-files', '-z', '--', ...builds, ':(top,glob)*.tsbuildinfo')
  if (tracked.length) throw new Error('A build cleanup target contains tracked files')
  function walk(path) {
    const info = plan.directory(path)
    if (!info) return plan.notice('Missing', path)
    for (const name of plan.names(path, info)) {
      const child = join(path, name)
      if (name === '.git') throw new Error(`Found a Git checkout under a build cleanup target: ${quote(child)}`)
      const entry = plan.observe(child)
      if (!entry) throw new Error(`Changed during reset: ${quote(child)}`)
      if (entry.isDirectory()) walk(child)
      else plan.removeFile(child, 'generated artifact')
    }
    plan.removeDirectory(path, info, 'generated artifact directory')
  }
  for (const name of builds) walk(join(repo, name))
  const root = plan.directory(repo, true)
  for (const name of plan.names(repo, root)) {
    if (/^[^/]+\.tsbuildinfo$/u.test(name)) plan.removeFile(join(repo, name), 'TypeScript build info')
  }
}

function isRolloutPath(home, path) {
  return typeof path === 'string' && inside(home, path) && resolve(path) === path
    && /^(?:sessions\/\d{4}\/\d{2}\/\d{2}|archived_sessions)\/rollout-[^/]+\.jsonl$/u.test(path.slice(home.length + 1))
}

function cacheRecord(raw, acceptsSource) {
  try {
    const cache = JSON.parse(raw)
    if (!cache || cache.version !== 1 || !acceptsSource(cache.sourcePath) ||
      !Number.isFinite(cache.modifiedAtMs) || cache.modifiedAtMs <= 0 ||
      !Array.isArray(cache.turns) || cache.turns.length > 10_000) return false
    return cache.turns.every(row => typeof row?.turnId === 'string' && row.metadata &&
      (typeof row.metadata.model === 'string' && row.metadata.modelSource === 'execution' ||
       typeof row.metadata.effort === 'string' && row.metadata.effortSource === 'execution'))
  } catch { return false }
}

function planRemoteCache(plan, { cache, info, entries, acceptsSource }, validate) {
  if (!info || plan.removes(cache)) return
  for (const name of entries) {
    const path = join(cache, name)
    if (plan.actions.has(path) || !legacyRemoteCache.match.test(name)) continue
    const entry = plan.file(path)
    if (entry && entry.size <= BigInt(legacyRemoteCache.limit)
      && validate(read(path, entry, legacyRemoteCache.limit), acceptsSource)) {
      plan.removeFile(path, 'verified WebUI rollout metadata cache')
    }
  }
  if (entries.every(name => plan.removes(join(cache, name)))) {
    plan.removeDirectory(cache, info, 'empty WebUI cache version directory')
  }
}

function planRemote(plan, args) {
  const cache = join(args.home, ...legacyRemoteCache.path)
  // The cache parent is a native namespace. Neither it nor its siblings are removed.
  assertUnmounted(join(args.home, 'cache'))
  assertUnmounted(dirname(cache))
  const info = plan.directory(cache)
  if (!info) plan.notice('Missing', cache)
  const remoteCache = { cache, info, entries: plan.names(cache, info), acceptsSource: path => isRolloutPath(args.home, path) }
  planRemoteCache(plan, remoteCache, cacheRecord)
  const uploads = join(args.uploadRoot, 'codexapp-uploads')
  if (args.uploads.length) {
    plan.directory(uploads)
    for (const name of args.uploads) plan.removeFile(join(uploads, name), 'operator-selected upload')
  }
  plan.notice('Preserve', uploads, 'directory and all attachments outside the explicit selection')
  return remoteCache
}

function buildPlan(args) {
  const plan = createPlan()
  if (args.remote) {
    const remoteCache = planRemote(plan, args)
    if (args['include-legacy']) {
      planRemoteCache(plan, remoteCache, legacyRemoteCache.validate)
      planLegacyCleanup(plan, args)
    }
    for (const name of remoteCache.entries) {
      const path = join(remoteCache.cache, name)
      if (!plan.removes(path)) plan.notice('Preserve', path, 'unverified cache ownership')
    }
    return plan
  }
  const home = plan.directory(args.home, true)
  const profiles = join(args.home, 'codexapp-profiles')
  const finishState = args['all-profiles'] || args.profile === 'legacy'
    ? planProfile(plan, args.home, false, home) : undefined
  if (args['all-profiles'] || args.profile !== 'legacy') {
    const root = plan.directory(profiles)
    if (!root) plan.notice('Missing', profiles)
    const selected = args['all-profiles'] ? plan.names(profiles, root)
      : [createHash('sha256').update(args.profile).digest('hex')]
    for (const name of selected) {
      const path = join(profiles, name)
      if (hashName.test(name)) planProfile(plan, path, true, plan.directory(path))
      else plan.notice('Preserve', path, 'unrecognized profile directory name')
    }
    if (root && args['all-profiles'] && selected.every(name => plan.removes(join(profiles, name)))) {
      plan.removeDirectory(profiles, root, 'empty WebUI profiles directory')
    }
  }
  const homeNames = args.shared ? plan.names(args.home, home) : []
  if (args.shared) planShared(plan, args, homeNames)
  else plan.notice('Skip', args.home, 'shared WebUI state and inline media require --shared')
  if (args.build) planBuild(plan)
  else plan.notice('Skip', repo, 'build artifacts require --build')
  finishState?.(args)
  if (args['include-legacy']) planLegacyCleanup(plan, args, homeNames)
  else plan.notice('Exclude', join(args.home, 'codexapp-turn-metadata'), 'retired sidecars may contain historical evidence')
  return plan
}

function checkRunning(args) {
  // Catch recognizable releases predating the lease. Unmanaged writers,
  // containers and clients on other hosts also require operator coordination.
  for (const pid of readdirSync('/proc').filter(value => /^\d+$/u.test(value))) {
    if (Number(pid) === process.pid) continue
    let argv
    try { argv = readFileSync(join('/proc', pid, 'cmdline'), 'utf8').split('\0').filter(Boolean) }
    catch (error) {
      if (['ENOENT', 'ESRCH'].includes(error.code)) continue
      if (error.code === 'EACCES' || error.code === 'EPERM') continue
      throw error
    }
    const executable = basename(argv[0] ?? '')
    const entry = argv.slice(1, 4).filter(arg => !arg.startsWith('-'))
    const webui = /^(?:codexui|codexapp|vite)$/u.test(executable) ||
      (['node', 'nodejs'].includes(executable) && entry.some(path => /(?:^|\/)(?:dist-cli\/index\.js|scripts\/dev\.cjs|vite\/bin\/vite\.js|\.bin\/(?:vite|codexui|codexapp))$/u.test(path)))
    const native = /^(?:codex|codex-app-server|Codex)$/u.test(executable)
    if (webui) throw new Error(`A Codex WebUI or Vite process may be running (PID ${pid})`)
    if ((args.remote || args['all-profiles'] || args.profile === 'legacy') && native) {
      try {
        const env = readFileSync(join('/proc', pid, 'environ'), 'utf8').split('\0')
        const home = env.find(value => value.startsWith('CODEX_HOME='))?.slice(11).trim() ||
          join(env.find(value => value.startsWith('HOME='))?.slice(5) || homedir(), '.codex')
        if (!isAbsolute(home) || resolve(home) === args.home) throw new Error(`A Codex process may be writing the selected home (PID ${pid})`)
      } catch (error) {
        if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error
      }
    }
  }
}

function main() {
  const args = options()
  if (args.help) return console.log(help)
  console.log(`${args.execute ? 'Execution' : 'Dry run'} on host ${quote(host)} (${args.remote ? 'App Server filesystem' : 'WebUI backend filesystem'})`)
  line('Codex home', args.home)
  if (args.remote) line('Upload directory', join(args.uploadRoot, 'codexapp-uploads'))
  else {
    console.log(`Profiles: ${args['all-profiles'] ? 'all, including legacy' : quote(args.profile)}. Shared: ${Boolean(args.shared)}. Build: ${Boolean(args.build)}.`)
    if (args.shared) line('Inline media', join(args.media, 'codex-web-inline-media'))
  }
  const release = args.execute ? acquireWebuiResetLease() : undefined
  try {
    if (args.execute) checkRunning(args)
    const plan = buildPlan(args)
    for (const notice of plan.notices) line(...notice)
    for (const item of plan.actions.values()) line(item.kind === 'rewrite' ? 'Would modify' : 'Would delete', item.path, item.reason)
    console.log('Official Codex files and project workspaces outside the listed plan are preserved.')
    if (!args.remote) console.log('Browser storage and App Server data require separate steps. See docs/webui-reset.md.')
    if (!args.execute) return console.log('Dry run complete. No files changed.')
    checkRunning(args)
    plan.verify()
    for (const item of plan.actions.values()) {
      apply(item)
      line(item.kind === 'rewrite' ? 'Modified' : 'Deleted', item.path, item.reason)
    }
    console.log(`Reset complete. ${plan.actions.size} filesystem actions applied.`)
  } finally { release?.() }
}

try { main() } catch (error) {
  console.error(`Reset stopped. No further changes were made. ${error.message}`)
  process.exitCode = 1
}
