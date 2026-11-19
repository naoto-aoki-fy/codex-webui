import { basename, join } from 'node:path'
import { read, readBytes } from './reset-webui-files.mjs'
import {
  automationRunId, hash, legacyFiles, legacyKeys, legacyTrees, parseJson, protectedLegacy, resolvedThreadIndex, telegramOutbox,
} from './reset-webui-legacy-registry.mjs'

const ackFlag = '--acknowledge-legacy-data-loss'
const inspectionLimit = 4 * 1024 * 1024
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const directoryHash = new RegExp(`^${hash}$`, 'u')
export const legacyFlags = {
  'include-legacy': { type: 'boolean' },
  'acknowledge-legacy-data-loss': { type: 'boolean' },
}

function allowed(plan, args, target, path) {
  if (target.policy === 'safe' || args['acknowledge-legacy-data-loss']) return true
  plan.notice('Preserve', path, `${target.purpose}, requires ${ackFlag}`)
  return false
}

function verifiedText(path, info, limit = inspectionLimit) {
  if (info.size > BigInt(limit)) return undefined
  try { return read(path, info, limit) } catch (error) {
    // Invalid UTF-8 fails ownership checks. Filesystem and change errors abort.
    if (error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') return undefined
    throw error
  }
}

function planFile(plan, args, path, target) {
  const info = plan.file(path)
  if (!info) return plan.notice('Missing', path)
  const raw = verifiedText(path, info, target.limit)
  if (raw === undefined || !target.validate(raw)) {
    return plan.notice('Preserve', path, 'unverified legacy contents or unresolved recovery state')
  }
  if (allowed(plan, args, target, path)) plan.removeFile(path, target.purpose)
}

export function legacyGlobalKeys(plan, args, path, state) {
  const keys = []
  for (const target of legacyKeys) {
    if (!Object.hasOwn(state, target.key)) continue
    const label = `${path} key ${JSON.stringify(target.key)}`
    if (!target.validate(state[target.key])) plan.notice('Preserve', label, 'unverified legacy value')
    else if (allowed(plan, args, target, label)) keys.push(target.key)
  }
  return keys
}

export function hasThreadIndexRecovery(path, info) {
  const raw = verifiedText(path, info)
  return raw === undefined || !resolvedThreadIndex(raw)
}

function removeIfEmpty(plan, path, info, entries, reason) {
  if (entries.every(name => plan.removals.has(join(path, name)))) plan.removeDirectory(path, info, reason)
}

function planSidecars(plan, args, path, target, includeIdentities, topLevel = true) {
  const info = plan.directory(path)
  if (!info) return plan.notice('Missing', path)
  plan.requireOwner(path, info)
  const entries = plan.names(path, info)
  for (const name of entries) {
    const child = join(path, name)
    if (target.match.test(name)) planFile(plan, args, child, target)
    else if (name.endsWith('.lock') && target.match.test(name.slice(0, -5))) {
      if (allowed(plan, args, target, child)) plan.removeLock(child)
    } else if (topLevel && directoryHash.test(name)) {
      if (includeIdentities) planSidecars(plan, args, child, target, false, false)
      else plan.notice('Preserve', child, 'historical server identity requires --all-profiles')
    } else plan.notice('Preserve', child, 'unrecognized legacy metadata entry')
  }
  if (args['acknowledge-legacy-data-loss']) removeIfEmpty(plan, path, info, entries, target.purpose)
}

function planPatches(plan, args) {
  const target = legacyTrees.patches
  const path = join(args.media, target.path)
  const info = plan.directory(path)
  if (!info) return plan.notice('Missing', path)
  const entries = plan.names(path, info)
  for (const name of entries) {
    const child = join(path, name)
    if (target.match.test(name)) planFile(plan, args, child, target)
    else plan.notice('Preserve', child, 'unrecognized review scratch')
  }
  if (args['acknowledge-legacy-data-loss']) removeIfEmpty(plan, path, info, entries, target.purpose)
}

// Inspect only trees whose writer and layout are known. Collect their children
// first so a foreign entry leaves the entire artifact intact.
function planTree(plan, path, target, classify) {
  const entries = []
  function inspectTree(folder, info, parents) {
    plan.requireOwner(folder, info)
    for (const name of plan.names(folder, info)) {
      const child = join(folder, name)
      const rule = classify(name, parents)
      if (rule === 'directory') {
        const directory = plan.directory(child)
        if (!directory || !inspectTree(child, directory, [...parents, name])) return false
      } else if (rule) {
        const file = plan.file(child)
        if (!file || (rule !== 'file' && !rule(child, file))) return false
        plan.requireOwner(child, file)
        entries.push({ path: child })
      } else return false
    }
    entries.push({ path: folder, info })
    return true
  }
  const info = plan.directory(path)
  if (!info) return plan.notice('Missing', path)
  if (!inspectTree(path, info, [])) return plan.notice('Preserve', path, 'unexpected contents in legacy directory')
  for (const entry of entries) {
    if (entry.info) plan.removeDirectory(entry.path, entry.info, target.purpose)
    else plan.removeFile(entry.path, target.purpose)
  }
}

function schemaFile(path, info) {
  const raw = verifiedText(path, info)
  const schema = raw === undefined ? undefined : parseJson(raw)
  const name = basename(path, '.json')
  const title = {
    'codex_app_server_protocol.schemas': 'CodexAppServerProtocol',
    'codex_app_server_protocol.v2.schemas': 'CodexAppServerProtocolV2',
  }[name] ?? name
  return record(schema) && schema.$schema === 'http://json-schema.org/draft-07/schema#'
    && typeof schema.title === 'string' && schema.title.replaceAll('_', '') === title
}

function schemaLayout(name, parents) {
  if (!parents.length && ['v1', 'v2'].includes(name)) return 'directory'
  if (/^(?:[A-Z][a-zA-Z0-9_]*|codex_app_server_protocol(?:\.v2)?\.schemas)\.json$/u.test(name)) return schemaFile
}

function zvecLayout(name, parents) {
  if (!parents.length) {
    if (/^(?:\d+|idmap\.\d+)$/u.test(name)) return 'directory'
    if (/^(?:LOCK|del\.\d+|manifest\.\d+)$/u.test(name)) return 'file'
  } else if (parents[0].startsWith('idmap.')) {
    if (/^(?:LOG(?:\.old\.\d+)?|LOCK|IDENTITY|CURRENT|(?:MANIFEST|OPTIONS)-\d+|\d+\.(?:log|sst))$/u.test(name)) return 'file'
  } else if (/^(?:\d+\.wal|scalar\.\d+\.ipc|content_vec\.index\.\d+\.proxima)$/u.test(name)) return 'file'
}

function planTemporary(plan, args) {
  planPatches(plan, args)
  const root = plan.directory(args.media, true)
  for (const name of plan.names(args.media, root)) {
    const schema = legacyTrees.schemas.match.test(name)
    const target = schema ? legacyTrees.schemas : legacyTrees.search
    if (!target.match.test(name)) continue
    const path = join(args.media, name)
    const info = plan.directory(path)
    if (!info) throw new Error(`Changed during reset: ${JSON.stringify(path)}`)
    plan.requireOwner(path, info)
    if ((info.mode & 0o077n) !== 0n) {
      plan.notice('Preserve', path, 'legacy scratch must match the private temporary directory layout')
      continue
    }
    const entries = plan.names(path, info)
    if (entries.length && !schema) {
      const manifests = entries.filter(entry => /^manifest\.\d+$/u.test(entry))
      const verified = manifests.some(entry => {
        const file = join(path, entry)
        const stat = plan.file(file)
        if (!stat || stat.size > 64n * 1024n) return false
        const bytes = readBytes(file, stat, 64 * 1024)
        return bytes.includes('\x0a\x0dthread_search') && bytes.includes('\x0a\x0bcontent_vec')
      })
      if (!verified) {
        plan.notice('Preserve', path, 'unverified zvec collection manifest')
        continue
      }
    }
    planTree(plan, path, target, schema ? schemaLayout : zvecLayout)
  }
}

function planOutbox(plan, args, names) {
  const target = telegramOutbox
  const files = [target.path, ...names.filter(name => target.scratch.test(name))].map(name => join(args.home, name))
  const locks = target.locks.map(name => join(args.home, name))
  const verified = []
  for (const path of files) {
    const info = plan.file(path)
    if (!info) {
      plan.notice('Missing', path)
      continue
    }
    const raw = verifiedText(path, info)
    if (raw === undefined || !target.validate(raw)) {
      for (const path of [...files, ...locks]) {
        plan.notice('Preserve', path, 'unresolved or unverified Telegram delivery state')
      }
      return
    }
    verified.push(path)
  }
  for (const path of verified) {
    if (allowed(plan, args, target, path)) plan.removeFile(path, target.purpose)
  }
  if (args['acknowledge-legacy-data-loss']) {
    for (const path of locks) plan.removeLock(path)
  }
}

function planAutomations(plan, args) {
  const target = legacyTrees.automations
  const path = join(args.home, target.path)
  if (!plan.directory(path)) return plan.notice('Missing', path)
  const storePath = join(path, 'store.json')
  const stat = plan.file(storePath)
  const raw = stat && verifiedText(storePath, stat)
  if (!raw || !target.validate(raw)) {
    return plan.notice('Preserve', path, 'unverified automation store or unresolved runs')
  }
  if (!allowed(plan, args, target, path)) return
  planTree(plan, path, target, (name, parents) => {
    if (!parents.length && name === 'store.json') return 'file'
    if ((!parents.length && name === 'runs') || (parents.length === 1 && automationRunId.test(name))) return 'directory'
    if (parents.length === 2 && ['events.jsonl', 'last-message.txt', 'output-schema.json'].includes(name)) return 'file'
  })
}

export function planLegacyCleanup(plan, args, homeNames) {
  for (const entry of protectedLegacy) {
    if (entry.scope === 'browser' || (!args.remote && entry.scope === 'profile')
      || (args.shared && entry.scope.startsWith('shared'))
      || (args.remote && entry.scope.endsWith('remote temporary'))) {
      plan.notice('Exclude', entry.path, entry.purpose)
    }
  }
  if (args.remote) return
  const target = legacyTrees.sidecars
  if (args['all-profiles'] || args.profile === 'legacy') {
    planSidecars(plan, args, join(args.home, target.path), target, args['all-profiles'])
  } else plan.notice('Skip', join(args.home, target.path), 'historical metadata requires --profile legacy or --all-profiles')
  if (!args.shared) return
  for (const file of legacyFiles) planFile(plan, args, join(args.home, file.path), file)
  planOutbox(plan, args, homeNames)
  planAutomations(plan, args)
  planTemporary(plan, args)
}
