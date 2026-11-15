import { sessionCodexHome } from './codexHomeResolver.js'
import { createHash } from 'node:crypto'
import { projectPath } from './appServerFileSystem.js'
import { readGenerationMetadata, type TurnGenerationMetadata } from '../turnGenerationMetadata.js'

const MAX_SOURCE_BYTES = 16 * 1024 * 1024
const MAX_CACHE_BYTES = 2 * 1024 * 1024
const MAX_TURNS = 10_000
const record = (v: any): Record<string, any> | undefined => v && typeof v === 'object' && !Array.isArray(v) ? v : undefined

/** Only complete turn_context rows and exact IDs count. Conflicting duplicate
 * values suppress that field for the entire turn; identical duplicates agree. */
export function parseRolloutMetadata(raw: string): Map<string, TurnGenerationMetadata> {
  const turns = new Map<string, TurnGenerationMetadata>()
  const conflicts = new Map<string, Set<string>>()
  for (const line of raw.slice(0, raw.lastIndexOf('\n') + 1).split('\n')) {
    try {
      const row = JSON.parse(line)
      const p = record(row?.payload)
      if (row?.type !== 'turn_context' || !p || typeof p.turn_id !== 'string' || !p.turn_id || p.turn_id.length > 256) continue
      if (!turns.has(p.turn_id) && turns.size >= MAX_TURNS) throw new RangeError('Too many rollout turns')
      const metadata = turns.get(p.turn_id) ?? {}
      const bad = conflicts.get(p.turn_id) ?? new Set<string>()
      const next = readGenerationMetadata({ model: p.model, effort: p.effort, modelSource: 'execution', effortSource: 'execution' })
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

export function rolloutCacheLocation(path: unknown, home?: string) {
  if (typeof path !== 'string' || path.length > 4096 || /[\x00-\x1f]/u.test(path)) return undefined
  const rules = projectPath(path)
  if (!rules.isAbsolute(path) || rules.normalize(path) !== path) return undefined
  const inferred = sessionCodexHome(path)
  if (!inferred) return undefined
  if (home && rules.relative(rules.normalize(home), inferred) !== '') return undefined
  return rules.join(inferred, 'cache', 'model-history', 'v1')
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
    const key = `${generation}:${threadId}:${force}`
    const old = this.pending.get(key)
    if (old) return old
    if (this.pending.size >= 16) return Promise.resolve(new Map())
    const promise = this.tail.then(() => this.read(threadId, generation, force)).catch(() => new Map<string, TurnGenerationMetadata>()).finally(() => {
      if (this.pending.get(key) === promise) this.pending.delete(key)
    })
    this.tail = promise
    this.pending.set(key, promise)
    return promise
  }

  private async read(threadId: string, generation: number, force: boolean) {
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
    const thread = await rpc('thread/read', { threadId, includeTurns: false })
    const path = thread?.thread?.path
    const home = await this.client.home()
    if (generation !== this.client.generation() || !home) return new Map<string, TurnGenerationMetadata>()
    const dir = rolloutCacheLocation(path, home)
    if (!dir) return new Map<string, TurnGenerationMetadata>()
    const cachePath = projectPath(path).join(dir, createHash('sha256').update(threadId).digest('hex') + '.json')
    const before = await rpc('fs/getMetadata', { path })
    if (!before?.isFile) return new Map<string, TurnGenerationMetadata>()
    const stamp = before.modifiedAtMs
    const reliable = typeof stamp === 'number' && Number.isFinite(stamp) && stamp > 0
    if (!force && reliable) {
      try {
        const cached = JSON.parse(await readFile(cachePath, MAX_CACHE_BYTES))
        if (cached.version === 1 && cached.sourcePath === path && cached.modifiedAtMs === stamp && Array.isArray(cached.turns) && cached.turns.length <= MAX_TURNS) {
          const data = new Map<string, TurnGenerationMetadata>()
          for (const row of cached.turns) {
            const metadata = readGenerationMetadata(row?.metadata)
            if (typeof row?.turnId !== 'string' || data.has(row.turnId) || !metadata ||
              (metadata.modelSource && metadata.modelSource !== 'execution') || (metadata.effortSource && metadata.effortSource !== 'execution')) throw new Error('Invalid rollout cache')
            data.set(row.turnId, metadata)
          }
          return data
        }
      } catch { /* Cache reads are optional. */ }
    }
    const data = parseRolloutMetadata(await readFile(path, MAX_SOURCE_BYTES))
    const after = await rpc('fs/getMetadata', { path })
    // Interrupted/changing sources are not published or cached. Unknown mtime
    // can provide evidence for this request, but can never validate a cache.
    if (!after?.isFile || (reliable && after.modifiedAtMs !== stamp)) return new Map<string, TurnGenerationMetadata>()
    if (reliable && after.modifiedAtMs === stamp) {
      const raw = JSON.stringify({ version: 1, sourcePath: path, modifiedAtMs: stamp, turns: [...data].map(([turnId, metadata]) => ({ turnId, metadata })) })
      if (Buffer.byteLength(raw) <= MAX_CACHE_BYTES) {
        try {
          await rpc('fs/createDirectory', { path: dir, recursive: true })
          await rpc('fs/writeFile', { path: cachePath, dataBase64: Buffer.from(raw).toString('base64') })
        } catch { /* Read-only hosts still supply execution evidence. */ }
      }
    }
    return data
  }
}
