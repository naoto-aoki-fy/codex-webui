#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { homedir, hostname } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { acquireWebuiResetLease } from '../src/server/webuiMaintenance.mjs'
import {
  profileDirectoryName, profileDirectoryPattern, remoteUploadsDirectory,
  requireConnectionProfile, resolveWebuiStorage, storageNames,
} from '../src/server/webuiStorage.mjs'
import { apply, assertUnmounted, fingerprint, inside, inspect, list } from './reset-webui-files.mjs'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const host = hostname()
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const storeTemp = file => new RegExp(`^\\.${file.replaceAll('.', '\\.')}\\.${uuid}\\.tmp$`, 'u')
const rolloutCacheFile = new RegExp(`^[0-9a-f]{64}\\.json(?:\\.${uuid}\\.tmp)?$`, 'u')
const builds = ['dist', 'dist-cli', 'output/playwright', 'test-results']
const uploadName = new RegExp(`^${uuid}-[a-zA-Z0-9._-]{0,120}$`, 'u')
const inlineMediaName = /^(?:inline-image|inline-file|generated-image)-[a-zA-Z0-9_.-]+-[0-9a-f]{40}(?:\.(?:png|jpg|webp|gif|svg|pdf))?$/u
const freshLockNs = 30_000_000_000n

const help = `Usage:
  pnpm reset:webui [--profile ID | --all-profiles] [--shared] [--build] [--dry-run]
  pnpm reset:webui [local scope flags] --execute --offline
  node scripts/reset-webui.mjs --remote --profile ID --remote-upload-root PATH --remote-upload NAME ...
  node scripts/reset-webui.mjs [remote scope flags] --execute --offline --confirm-remote HOST

Dry run is the default. A profile must be supplied with --profile or CODEXUI_CONNECTION_PROFILE unless using --all-profiles.
--shared includes backend-wide login sessions. --build adds generated artifacts in this checkout.
Local reset preserves upload ledgers. Run remote mode on the App Server host to remove explicitly named uploads.
--offline confirms that all writers for the selected paths are stopped. Execution requires Linux.`

const quote = value => JSON.stringify(value)
const line = (verb, path, detail = '') => console.log(`${verb} ${quote(path)}${detail ? ` (${detail})` : ''}`)

function safeBase(raw, label) {
  if (!raw || /[\x00-\x1f\x7f]/u.test(raw) || raw.split(/[\\/]/u).includes('..') || !isAbsolute(raw)) {
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
    'remote-upload-root': { type: 'string' },
    'remote-upload': { type: 'string', multiple: true },
    'confirm-remote': { type: 'string' },
  } })
  if (args.help) return args
  if (args.execute && args['dry-run']) throw new Error('Choose either --dry-run or --execute')
  if (args.execute && !args.offline) throw new Error('--execute requires --offline after all writers are stopped')
  if (args.execute && process.platform !== 'linux') throw new Error('Reset execution requires Linux')
  if (args.profile !== undefined && args['all-profiles']) throw new Error('Choose either --profile or --all-profiles')
  if (!args['all-profiles']) args.profile = requireConnectionProfile(args.profile)
  if (args.remote) {
    if (args['all-profiles'] || args.shared || args.build) throw new Error('Remote and backend reset scopes require separate commands')
    if (args.execute && args['confirm-remote'] !== host) {
      throw new Error(`Remote execution requires --confirm-remote ${quote(host)} on the App Server host`)
    }
    const root = args['remote-upload-root'] ?? process.env.CODEXUI_REMOTE_UPLOAD_DIR?.trim()
    args.uploadDirectory = safeBase(remoteUploadsDirectory(root ?? '', args.profile), 'remote upload directory')
    args.uploads = [...new Set(args['remote-upload'] ?? [])]
    if (!args.uploads.length || args.uploads.some(name => !uploadName.test(name))) {
      throw new Error('Provide one or more exact WebUI upload filenames with --remote-upload')
    }
  } else {
    if (['remote-upload-root', 'remote-upload', 'confirm-remote'].some(key => args[key] !== undefined)) {
      throw new Error('Remote options require --remote')
    }
    args.storage = resolveWebuiStorage()
    if (args.build && Object.values(args.storage).some(root => builds.some(name => inside(join(repo, name), root)))) {
      throw new Error('WebUI storage overlaps a build cleanup target')
    }
    args.data = safeBase(args.storage.data, 'WebUI data directory')
    args.cache = safeBase(args.storage.cache, 'WebUI cache directory')
  }
  return args
}

function createPlan() {
  const observations = new Map()
  const actions = new Map()
  const notices = []
  const removes = path => actions.has(path)
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

function removeEmpty(plan, directory, info, entries) {
  if (entries.every(name => plan.removes(join(directory, name)))) {
    plan.removeDirectory(directory, info, 'empty WebUI storage directory')
  }
}

function planKnownFiles(plan, directory, matches, reason) {
  const info = plan.directory(directory)
  if (!info) return plan.notice('Missing', directory)
  const entries = plan.names(directory, info)
  for (const name of entries) {
    const path = join(directory, name)
    if (matches.test(name)) plan.removeFile(path, reason)
    else plan.notice('Preserve', path, 'unrecognized content')
  }
  removeEmpty(plan, directory, info, entries)
}

function planData(plan, directory, info) {
  const entries = plan.names(directory, info)
  const files = [storageNames.state, storageNames.modelPreferences]
  for (const name of files) {
    plan.removeLock(join(directory, name + '.lock'))
    plan.removeFile(join(directory, name), 'App Server state')
  }
  for (const name of entries) {
    const path = join(directory, name)
    if (files.some(file => storeTemp(file).test(name))) plan.removeFile(path, 'WebUI persistence temporary file')
    else if (name === storageNames.uploads) plan.notice('Preserve', path, 'upload accounting and recovery journal')
    else if (!plan.removes(path)) plan.notice('Preserve', path, 'unrecognized content')
  }
  removeEmpty(plan, directory, info, entries)
}

function planCache(plan, directory, info) {
  const entries = plan.names(directory, info)
  planKnownFiles(plan, join(directory, storageNames.inlineMedia), inlineMediaName, 'inline media cache')
  const history = join(directory, storageNames.rolloutCache)
  const historyInfo = plan.directory(history)
  if (historyInfo) {
    planKnownFiles(plan, join(history, 'v1'), rolloutCacheFile, 'rollout metadata cache')
    removeEmpty(plan, history, historyInfo, plan.names(history, historyInfo))
  }
  removeEmpty(plan, directory, info, entries)
}

function planProfiles(plan, base, args, select) {
  plan.directory(base, true)
  const root = join(base, storageNames.profiles)
  const info = plan.directory(root)
  if (!info) return plan.notice('Missing', root)
  const entries = args['all-profiles'] ? plan.names(root, info) : [profileDirectoryName(args.profile)]
  for (const name of entries) {
    const path = join(root, name)
    if (!profileDirectoryPattern.test(name)) { plan.notice('Preserve', path, 'unrecognized App Server directory'); continue }
    const directory = plan.directory(path)
    if (directory) select(plan, path, directory)
    else plan.notice('Missing', path)
  }
  if (args['all-profiles']) removeEmpty(plan, root, info, entries)
}

function planShared(plan, data) {
  const directory = join(data, storageNames.global)
  const info = plan.directory(directory)
  if (!info) return plan.notice('Missing', directory)
  const file = storageNames.authSessions
  const temp = storeTemp(file)
  for (const name of plan.names(directory, info)) {
    if (name === file || temp.test(name)) plan.removeFile(join(directory, name), 'global WebUI login sessions')
    else if (name === file + '.lock') plan.removeLock(join(directory, name))
    else plan.notice('Preserve', join(directory, name), 'unrecognized content')
  }
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

function buildPlan(args) {
  const plan = createPlan()
  if (args.remote) {
    plan.directory(args.uploadDirectory)
    for (const name of args.uploads) plan.removeFile(join(args.uploadDirectory, name), 'operator-selected upload')
  } else {
    planProfiles(plan, args.data, args, planData)
    planProfiles(plan, args.cache, args, planCache)
    if (args.shared) planShared(plan, args.data)
    if (args.build) planBuild(plan)
  }
  return plan
}

function main() {
  const args = options()
  if (args.help) return console.log(help)
  console.log(`${args.execute ? 'Execution' : 'Dry run'} on host ${quote(host)} (${args.remote ? 'App Server filesystem' : 'WebUI backend filesystem'})`)
  if (args.remote) line('Upload directory', args.uploadDirectory)
  else {
    line('WebUI data', args.data)
    line('WebUI cache', args.cache)
    console.log(`App Server IDs: ${args['all-profiles'] ? 'all' : quote(args.profile)}. Shared: ${Boolean(args.shared)}. Build: ${Boolean(args.build)}.`)
  }
  const release = args.execute ? acquireWebuiResetLease() : undefined
  try {
    const plan = buildPlan(args)
    for (const notice of plan.notices) line(...notice)
    for (const item of plan.actions.values()) line('Would delete', item.path, item.reason)
    if (!args.execute) return console.log('Dry run complete. No files changed.')
    plan.verify()
    for (const item of plan.actions.values()) {
      apply(item)
      line('Deleted', item.path, item.reason)
    }
    console.log(`Reset complete. ${plan.actions.size} filesystem actions applied.`)
  } finally { release?.() }
}

try { main() } catch (error) {
  console.error(`Reset stopped. No further changes were made. ${error.message}`)
  process.exitCode = 1
}
