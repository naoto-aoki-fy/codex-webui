import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { read } from './reset-webui-files.mjs'
import { selectGlobalStateKeys } from './reset-webui-global-state.mjs'
import { fields, legacyRegistry } from './reset-webui-legacy-registry.mjs'

const quote = value => JSON.stringify(value)
const hash = /^[0-9a-f]{64}$/u
const sidecar = /^[0-9a-f]{64}\.jsonl$/u
const sidecarLock = /^[0-9a-f]{64}\.jsonl\.lock$/u
const source = value => value === 'execution' || value === 'submitted'
const generationValue = value => value === null || typeof value === 'string'
const readLimit = 4 * 1024 * 1024
const ackFlag = '--acknowledge-legacy-data-loss'

export const legacyFlags = {
  'list-legacy-targets': { type: 'boolean' },
  'include-legacy': { type: 'boolean' },
  'all-legacy': { type: 'boolean' },
  'legacy-target': { type: 'string', multiple: true },
  'acknowledge-legacy-data-loss': { type: 'string', multiple: true },
  'legacy-upload-file': { type: 'string', multiple: true },
}

export function selectLegacyTargets(args) {
  if (args['list-legacy-targets']) {
    if (Object.keys(args).length !== 1) throw new Error('--list-legacy-targets runs by itself')
    return []
  }
  const ids = new Set(args['legacy-target'] ?? [])
  const acknowledgements = new Set(args['acknowledge-legacy-data-loss'] ?? [])
  const uploadFiles = args['legacy-upload-file'] ?? []
  if (!args['include-legacy'] && !args['all-legacy']) {
    if (ids.size || acknowledgements.size || uploadFiles.length) throw new Error('Legacy selection requires --include-legacy')
    return []
  }
  if (args['all-legacy']) {
    if (ids.size) throw new Error('Choose either --all-legacy or individual --legacy-target IDs')
    const profile = args.profile ?? (process.env.CODEXUI_CONNECTION_PROFILE?.trim() || 'legacy')
    for (const [id, target] of legacyRegistry) {
      if (target.policy !== 'safe' || args.remote) continue
      if (target.scope === 'shared' && !args.shared) continue
      if (target.scope === 'legacy-profile' && !args['all-profiles'] && profile !== 'legacy') continue
      ids.add(id)
    }
    if (!ids.size) throw new Error('No verified safe legacy targets in this scope. Run --list-legacy-targets.')
  }
  if (!ids.size) throw new Error('--include-legacy requires at least one --legacy-target ID')
  if (args.build || args['remote-upload'] || args['remote-upload-root']) {
    throw new Error('Run current build and upload cleanup separately from legacy cleanup')
  }
  const targets = [...ids].map(id => {
    const target = legacyRegistry.get(id)
    if (!target) throw new Error(`Unknown legacy target ${quote(id)}. Run --list-legacy-targets.`)
    if (target.policy === 'blocked' || target.policy === 'manual') {
      throw new Error(`Legacy target ${quote(id)} is ${target.policy}: ${target.description}`)
    }
    if (args.remote && target.scope !== 'shared-or-remote') {
      throw new Error(`Legacy target ${quote(id)} belongs to the WebUI backend`)
    }
    if (!args.remote && ['shared', 'shared-or-remote'].includes(target.scope) && !args.shared) {
      throw new Error(`Legacy target ${quote(id)} requires --shared on the WebUI backend`)
    }
    if (args.execute && target.policy === 'acknowledge' && !acknowledgements.has(id)) {
      throw new Error(`Legacy target ${quote(id)} requires ${ackFlag} ${id}. ${target.description}`)
    }
    return { id, ...target }
  })
  for (const id of acknowledgements) {
    if (!ids.has(id) || legacyRegistry.get(id)?.policy !== 'acknowledge') {
      throw new Error(`Data-loss acknowledgement does not match a selected conditional target: ${quote(id)}`)
    }
  }
  if (ids.has('staged-uploads') && !uploadFiles.length) {
    throw new Error('staged-uploads requires at least one --legacy-upload-file BATCH/FILENAME')
  }
  if (uploadFiles.length && !ids.has('staged-uploads')) {
    throw new Error('--legacy-upload-file requires the staged-uploads target')
  }
  for (const path of uploadFiles) {
    const [batch, name, extra] = path.split('/')
    if (extra !== undefined || !/^f-[a-zA-Z0-9]{6}$/u.test(batch)
      || !name || name === '.' || name === '..' || /[\\\x00-\x1f\x7f]/u.test(name) || Buffer.byteLength(name) > 255) {
      throw new Error(`Expected an exact historical upload filename BATCH/FILENAME: ${quote(path)}`)
    }
  }
  return targets
}

export function printLegacyTargets() {
  for (const [id, { scope, policy, description, provenance, files, path, key }] of legacyRegistry) {
    const eligibility = policy === 'acknowledge' ? `conditional, ${ackFlag} ${id}` : policy
    const location = files ? Object.keys(files).join(', ') : path ?? (key ? `.codex-global-state.json key ${key}` : '')
    console.log(`${id} [${scope}; ${eligibility}] ${description} (${provenance})${location ? ` — ${location}` : ''}`)
  }
}

function verifyContent(plan, path, info, validate) {
  if (!validate(read(path, info, readLimit))) throw new Error(`Unverified legacy contents at ${quote(path)}. Preserving the file.`)
  plan.requireOwner(path, info)
}

function planFiles(plan, home, target) {
  for (const [name, validate] of Object.entries(target.files)) {
    const path = join(home, name)
    const info = plan.file(path)
    if (info) verifyContent(plan, path, info, validate)
    plan.removeFile(path, target.id)
  }
}

function planMixedKeys(plan, path, targets) {
  const info = plan.file(path)
  if (!info) return plan.notice('Missing', path)
  const result = selectGlobalStateKeys(read(path, info), path, state => {
    const keys = new Set()
    for (const { key, validate } of targets) {
      if (!Object.hasOwn(state, key)) {
        plan.notice('Missing key in', path, quote(key))
      } else if (!validate(state[key])) {
        throw new Error(`Unverified legacy key ${quote(key)} in ${quote(path)}. Preserving the file.`)
      } else keys.add(key)
    }
    return keys
  })
  if (result.preserved.length) plan.notice('Preserve keys in', path, result.preserved.map(quote).join(', '))
  if (result.keys.length) plan.rewriteGlobal(path, info, result, true)
}

function legacySidecar(raw) {
  const lines = raw.split('\n').filter(line => line.trim())
  if (!lines.length || !raw.endsWith('\n')) return false
  return lines.every(line => {
    let row
    try { row = JSON.parse(line) } catch { return false }
    return fields(row, {
      turnId: value => typeof value === 'string' && value.trim().length > 0,
      metadata: value => fields(value, {
        model: generationValue, effort: generationValue, modelSource: source, effortSource: source,
      }) && (Object.hasOwn(value, 'model') || Object.hasOwn(value, 'effort'))
        && (Object.hasOwn(value, 'model') === Object.hasOwn(value, 'modelSource'))
        && (Object.hasOwn(value, 'effort') === Object.hasOwn(value, 'effortSource')),
    }, ['turnId', 'metadata'])
  })
}

function planSidecars(plan, folder, target, topLevel = true) {
  const info = plan.directory(folder)
  if (!info) return plan.notice('Missing', folder)
  plan.requireOwner(folder, info)
  const entries = plan.names(folder, info)
  for (const name of entries) {
    const path = join(folder, name)
    if (sidecar.test(name)) {
      const file = plan.file(path)
      if (!file) throw new Error(`Legacy target changed during inspection: ${quote(path)}`)
      verifyContent(plan, path, file, legacySidecar)
      plan.removeFile(path, target.id)
    } else if (sidecarLock.test(name)) {
      plan.removeLock(path)
    } else if (topLevel && hash.test(name)) {
      planSidecars(plan, path, target, false)
    } else plan.notice('Preserve', path, 'unrecognized legacy metadata artifact')
  }
  if (entries.every(name => plan.removals.has(join(folder, name)))) plan.removeDirectory(folder, info, target.id)
}

function planReviewPatches(plan, folder, target) {
  const info = plan.directory(folder)
  if (!info) return plan.notice('Missing', folder)
  plan.requireOwner(folder, info)
  const entries = plan.names(folder, info)
  for (const name of entries) {
    const path = join(folder, name)
    if (!target.match.test(name)) {
      plan.notice('Preserve', path, 'unrecognized legacy review scratch')
      continue
    }
    const file = plan.file(path)
    if (!file) throw new Error(`Legacy target changed during inspection: ${quote(path)}`)
    verifyContent(plan, path, file, target.validate)
    plan.removeFile(path, target.id)
  }
  if (entries.every(name => plan.removals.has(join(folder, name)))) plan.removeDirectory(folder, info, target.id)
}

function planStagedUploads(plan, folder, target, selected) {
  const root = plan.directory(folder)
  if (root) plan.requireOwner(folder, root)
  const batches = new Map()
  for (const path of new Set(selected)) {
    const [batch, name] = path.split('/')
    const names = batches.get(batch) ?? new Set()
    names.add(name)
    batches.set(batch, names)
  }
  for (const [batch, selectedNames] of batches) {
    const directory = join(folder, batch)
    const info = plan.directory(directory)
    const entries = plan.names(directory, info)
    if (info) {
      plan.requireOwner(directory, info)
      // The original writer made a private mkdtemp directory for each single upload.
      if ((info.mode & 0o077n) !== 0n || entries.length > 1) {
        throw new Error(`Unverified historical upload batch: ${quote(directory)}`)
      }
    }
    for (const name of selectedNames) plan.removeFile(join(directory, name), target.id + ' (operator-reviewed attachment)')
    if (info && entries.length && entries.every(name => plan.removals.has(join(directory, name)))) {
      plan.removeDirectory(directory, info, 'empty reviewed upload batch')
    }
  }
  plan.notice('Preserve', folder, 'staging root and uploads outside the explicit selection')
}

function planProfileMetadata(plan, args, target) {
  if (args['all-profiles'] || args.profile === 'legacy') planSidecars(plan, join(args.home, target.path), target)
  if (!args['all-profiles'] && args.profile === 'legacy') return
  const root = join(args.home, 'codexapp-profiles')
  const info = plan.directory(root)
  const profiles = args['all-profiles'] ? plan.names(root, info)
    : [createHash('sha256').update(args.profile).digest('hex')]
  if (!info) plan.notice('Missing', root)
  for (const name of profiles) {
    const path = join(root, name)
    if (!hash.test(name)) {
      plan.notice('Preserve', path, 'unrecognized profile directory name')
      continue
    }
    plan.directory(path)
    planSidecars(plan, join(path, target.path), target)
  }
}

export function planLegacyCleanup(plan, args) {
  const globalKeys = []
  for (const target of args.legacyTargets) {
    if (target.scope === 'legacy-profile' && !args['all-profiles'] && args.profile !== 'legacy') {
      throw new Error(`Legacy target ${quote(target.id)} predates named profiles. Select --profile legacy or --all-profiles.`)
    }
    plan.notice('Legacy target', target.id, target.description)
    switch (target.kind) {
      case 'files': planFiles(plan, args.home, target); break
      case 'global-key': globalKeys.push(target); break
      case 'turn-metadata': planProfileMetadata(plan, args, target); break
      case 'review-patches': planReviewPatches(plan, join(args.media, target.path), target); break
      case 'staged-uploads': planStagedUploads(plan, join(args.media, target.path), target, args['legacy-upload-file']); break
      default: throw new Error(`Unsupported legacy target kind: ${quote(target.kind)}`)
    }
  }
  if (globalKeys.length) planMixedKeys(plan, join(args.home, '.codex-global-state.json'), globalKeys)
}
