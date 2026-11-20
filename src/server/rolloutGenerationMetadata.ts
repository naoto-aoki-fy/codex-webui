import { sessionCodexHome } from './codexHomeResolver.js'
import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { getConnectionProfileId, profileStorageDirectory } from './connectionProfile.js'
import { storageNames } from './webuiStorage.mjs'
import { projectPath } from './appServerFileSystem.js'
import { updateCodexGlobalState, type CodexGlobalState } from './codexGlobalState.js'
import type { CollaborationModeKind } from '../types/codex.js'
import { readCollaborationMode, readGenerationMetadata, type TurnGenerationMetadata } from '../turnGenerationMetadata.js'

const MAX_SOURCE_BYTES = 16 * 1024 * 1024
const MAX_CACHE_BYTES = 2 * 1024 * 1024
const MAX_TURNS = 10_000
const record = (v: any): Record<string, any> | undefined => v && typeof v === 'object' && !Array.isArray(v) ? v : undefined

/** Use complete rollout records with exact IDs. A mode conflict must
 * explicitly clear submitted evidence already visible in a browser. */
export function parseRolloutMetadata(raw: string): Map<string, TurnGenerationMetadata> {
  const turns = new Map<string, TurnGenerationMetadata>()
  const conflicts = new Map<string, Set<string>>()
  for (const line of raw.slice(0, raw.lastIndexOf('\n') + 1).split('\n')) {
    try {
      const row = JSON.parse(line)
      const p = record(row?.payload)
      const isContext = row?.type === 'turn_context'
      const isStart = row?.type === 'event_msg' && p?.type === 'task_started'
      if ((!isContext && !isStart) || !p || typeof p.turn_id !== 'string' || !p.turn_id || p.turn_id.length > 256) continue
      if (!turns.has(p.turn_id) && turns.size >= MAX_TURNS) throw new RangeError('Too many rollout turns')
      const metadata = turns.get(p.turn_id) ?? {}
      const bad = conflicts.get(p.turn_id) ?? new Set<string>()
      const next = isContext ? readGenerationMetadata({ model: p.model, effort: p.effort, modelSource: 'execution', effortSource: 'execution' }) : undefined
      const mode = readCollaborationMode(isContext ? record(p.collaboration_mode)?.mode : p.collaboration_mode_kind)
      if (mode && metadata.collaborationMode !== null) {
        metadata.collaborationMode = metadata.collaborationMode && metadata.collaborationMode !== mode ? null : mode
        metadata.collaborationModeSource = 'execution'
      }
      for (const field of ['model', 'effort'] as const) {
        const source = field === 'model' ? 'modelSource' : 'effortSource'
        if (next?.[field] === undefined || bad.has(field)) continue
        if (typeof next[field] === 'string' && next[field]!.length > 512) continue
        if (metadata[field] !== undefined && metadata[field] !== next[field]) {
          bad.add(field); delete metadata[field]; delete metadata[source]
        } else { metadata[field] = next[field]; metadata[source] = 'execution' }
      }
      turns.set(p.turn_id, metadata); conflicts.set(p.turn_id, bad)
    } catch (error) { if (error instanceof RangeError) throw error }
  }
  return new Map([...turns].filter(([, value]) => Object.keys(value).length))
}

export function rolloutSourcePath(path: unknown, home: string): string | undefined {
  if (typeof path !== 'string' || path.length > 4096 || /[\x00-\x1f]/u.test(path)) return undefined
  const rules = projectPath(path)
  if (!rules.isAbsolute(path) || rules.normalize(path) !== path) return undefined
  const inferred = sessionCodexHome(path)
  if (!inferred) return undefined
  if (rules.relative(rules.normalize(home), inferred) !== '') return undefined
  return path
}

async function readCache(path: string): Promise<unknown> {
  const file = await open(path, 'r')
  try {
    if ((await file.stat()).size > MAX_CACHE_BYTES) throw new Error('Rollout cache exceeds budget')
    return JSON.parse(await file.readFile('utf8'))
  } finally {
    await file.close()
  }
}

function cachePath(threadId: string, profileId: string): string {
  // Keep the original directory and filename so v1 caches upgrade in place.
  return join(profileStorageDirectory('cache', profileId), storageNames.rolloutCache, 'v1',
    createHash('sha256').update(threadId).digest('hex') + '.json')
}

function cachedEvidence(cache: ReturnType<typeof record>): Map<string, TurnGenerationMetadata> | undefined {
  if (!Array.isArray(cache?.turns) || cache.turns.length > MAX_TURNS) return
  const evidence = new Map<string, TurnGenerationMetadata>()
  for (const row of cache.turns) {
    const metadata = readGenerationMetadata(row?.metadata)
    if (typeof row?.turnId !== 'string' || evidence.has(row.turnId) || !metadata ||
      metadata.modelSource === 'submitted' || metadata.effortSource === 'submitted' ||
      metadata.collaborationModeSource === 'submitted') return
    evidence.set(row.turnId, metadata)
  }
  return evidence
}

function submittedModes(cache: ReturnType<typeof record>): Map<string, CollaborationModeKind> {
  const modes = new Map<string, CollaborationModeKind>()
  if (cache?.version !== 2) return modes
  for (const [turnId, raw] of Object.entries(record(cache.submittedModes) ?? {})) {
    const mode = readCollaborationMode(raw)
    if (turnId && turnId.length <= 256 && mode) modes.set(turnId, mode)
    if (modes.size >= MAX_TURNS) break
  }
  return modes
}

function discardContradictions(submitted: Map<string, CollaborationModeKind>, rollout: Map<string, TurnGenerationMetadata>): void {
  for (const [id, mode] of submitted) {
    const observed = rollout.get(id)?.collaborationMode
    if (observed !== undefined && observed !== mode) submitted.delete(id)
  }
}

function combineEvidence(rollout: Map<string, TurnGenerationMetadata>, submitted: Map<string, CollaborationModeKind>) {
  const result = new Map(rollout)
  for (const [id, mode] of submitted) {
    const known = result.get(id)
    if (known?.collaborationMode === undefined) result.set(id, { ...known, collaborationMode: mode, collaborationModeSource: 'submitted' })
  }
  return result
}

function storeCache(state: CodexGlobalState, next: CodexGlobalState): void {
  if (Buffer.byteLength(JSON.stringify(next)) > MAX_CACHE_BYTES) return
  for (const key of Object.keys(state)) delete state[key]
  Object.assign(state, next)
}

type Client = {
  rpc(method: string, params: unknown): Promise<unknown>
  generation(): number
  home(): string | undefined | Promise<string>
}

/** One full-file transfer at a time, at most 16 queued/coalesced threads.
 * No session contents are retained. Cache validation always stats the source. */
export class RolloutGenerationMetadata {
  private readonly pending = new Map<string, Promise<Map<string, TurnGenerationMetadata>>>()
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly client: Client) {}

  recover(threadId: string, force = false): Promise<Map<string, TurnGenerationMetadata>> {
    const generation = this.client.generation()
    const profileId = getConnectionProfileId()
    const key = `${generation}:${profileId}:${threadId}:${force}`
    const old = this.pending.get(key)
    if (old) return old
    if (this.pending.size >= 16) return Promise.resolve(new Map())
    const promise = this.tail.then(() => this.read(threadId, profileId, generation, force)).catch(() => new Map<string, TurnGenerationMetadata>()).finally(() => {
      if (this.pending.get(key) === promise) this.pending.delete(key)
    })
    this.tail = promise
    this.pending.set(key, promise)
    return promise
  }

  async rememberSubmittedMode(threadId: string, turnId: string, mode: CollaborationModeKind, profileId: string): Promise<TurnGenerationMetadata | undefined> {
    if (turnId.length > 256) return
    return updateCodexGlobalState(state => {
      const submitted = submittedModes(state)
      const evidence = state.version === 2 && state.rolloutModeScanned === true && Array.isArray(state.turns)
        ? readGenerationMetadata(state.turns.find(row => row?.turnId === turnId)?.metadata) : undefined
      if (evidence?.collaborationModeSource === 'execution' && evidence.collaborationMode !== mode) submitted.delete(turnId)
      else {
        if (!submitted.has(turnId) && submitted.size >= MAX_TURNS) submitted.delete(submitted.keys().next().value!)
        submitted.set(turnId, mode)
      }
      const existing = state.version === 1 || state.version === 2 ? state : {}
      storeCache(state, { ...existing, version: 2, submittedModes: Object.fromEntries(submitted) })
      return evidence?.collaborationModeSource === 'execution'
        ? { collaborationMode: evidence.collaborationMode, collaborationModeSource: 'execution' }
        : { collaborationMode: mode, collaborationModeSource: 'submitted' }
    }, cachePath(threadId, profileId), true, MAX_CACHE_BYTES)
  }

  private async read(threadId: string, profileId: string, generation: number, force: boolean) {
    const destination = cachePath(threadId, profileId)
    const cached = record(await readCache(destination).catch(() => undefined))
    let submitted = submittedModes(cached)
    const fallback = () => generation === this.client.generation() ? combineEvidence(new Map(), submitted) : new Map<string, TurnGenerationMetadata>()
    const rpc = async (method: string, params: unknown) => {
      if (generation !== this.client.generation()) throw new Error('Retired rollout recovery')
      const result = await this.client.rpc(method, params)
      if (generation !== this.client.generation()) throw new Error('Retired rollout recovery')
      return record(result)!
    }
    const readFile = async (path: string, max: number) => {
      const response = await rpc('fs/readFile', { path })
      if (typeof response?.dataBase64 !== 'string' || response.dataBase64.length > Math.ceil(max / 3) * 4) throw new Error('Rollout read exceeds budget')
      return Buffer.from(response.dataBase64, 'base64').toString('utf8')
    }
    try {
      const thread = await rpc('thread/read', { threadId, includeTurns: false })
      const home = await this.client.home()
      if (generation !== this.client.generation() || !home) return fallback()
      const path = rolloutSourcePath(thread?.thread?.path, home)
      if (!path) return fallback()
      const before = await rpc('fs/getMetadata', { path })
      if (!before?.isFile) return fallback()
      const stamp = before.modifiedAtMs
      const reliable = typeof stamp === 'number' && Number.isFinite(stamp) && stamp > 0
      if (!force && reliable && cached?.version === 2 && cached.rolloutModeScanned === true &&
        cached.sourcePath === path && cached.modifiedAtMs === stamp) {
        const evidence = cachedEvidence(cached)
        if (evidence) return combineEvidence(evidence, submitted)
      }
      const rollout = parseRolloutMetadata(await readFile(path, MAX_SOURCE_BYTES))
      const after = await rpc('fs/getMetadata', { path })
      if (!after?.isFile || (reliable && after.modifiedAtMs !== stamp)) return fallback()

      const submittedCount = submitted.size
      discardContradictions(submitted, rollout)
      if (reliable || submitted.size !== submittedCount) {
        try {
          await updateCodexGlobalState(state => {
            if (generation !== this.client.generation()) return
            submitted = submittedModes(state)
            discardContradictions(submitted, rollout)
            const submittedModesByTurn = Object.fromEntries(submitted)
            if (!reliable) {
              storeCache(state, { ...state, version: 2, submittedModes: submittedModesByTurn })
              return
            }
            const snapshot = {
              version: 2, sourcePath: path, modifiedAtMs: stamp, rolloutModeScanned: true,
              turns: [...rollout].map(([turnId, metadata]) => ({ turnId, metadata })),
              submittedModes: submittedModesByTurn,
            }
            // Keep the submitted map if the new rollout scan exceeds the cache budget.
            if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_CACHE_BYTES) {
              storeCache(state, { version: 2, submittedModes: submittedModesByTurn })
            } else storeCache(state, snapshot)
          }, destination, true, MAX_CACHE_BYTES)
        } catch { /* Local cache failure does not change validated execution evidence. */ }
      }
      return generation === this.client.generation() ? combineEvidence(rollout, submitted) : new Map<string, TurnGenerationMetadata>()
    } catch {
      return fallback()
    }
  }
}
