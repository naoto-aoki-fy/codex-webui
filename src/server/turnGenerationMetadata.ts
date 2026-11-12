import { createHash } from 'node:crypto'
import { mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'
import { lock } from 'proper-lockfile'
import { mergeGenerationMetadata, readGenerationMetadata, type TurnGenerationMetadata } from '../turnGenerationMetadata.js'

const MAX_BYTES = 4 * 1024 * 1024
const cache = new Map<string, { signature: string; data: Map<string, TurnGenerationMetadata> }>()
const writes = new Map<string, Promise<void>>()
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

/** Backend-local sidecars; remote paths are identity only, never local paths. */
export class TurnGenerationMetadataStore {
  constructor(private home: string, private identity: string, private legacy = false) {}
  private path(threadId: string, legacy = false) {
    return join(this.home, 'codexapp-turn-metadata', ...(legacy ? [] : [hash(this.identity)]), `${hash(threadId)}.jsonl`)
  }
  async saveMany(threadId: string, entries: Array<{ turnId: string; metadata: TurnGenerationMetadata }>) {
    if (!entries.length) return
    const path = this.path(threadId)
    const pending = (writes.get(path) ?? Promise.resolve()).catch(() => {}).then(() => this.append(path, entries))
    writes.set(path, pending)
    try { await pending }
    finally { if (writes.get(path) === pending) writes.delete(path) }
  }
  private async append(path: string, entries: Array<{ turnId: string; metadata: TurnGenerationMetadata }>) {
    await mkdir(join(path, '..'), { recursive: true })
    // Cross-process lock: concurrent clients cannot interleave append batches.
    const release = await lock(path, { realpath: false, retries: { retries: 20, minTimeout: 10, maxTimeout: 100 } })
    try {
      const data = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n'
      const file = await open(path, 'a', 0o600)
      try {
        if ((await file.stat()).size + Buffer.byteLength(data) + 1 > MAX_BYTES) throw new Error('Turn metadata sidecar size limit reached')
        // A newline isolates any partial row left by a crashed writer.
        await file.writeFile('\n' + data)
        await file.sync()
        cache.delete(path)
      } finally { await file.close() }
    } finally { await release() }
  }
  async read(threadId: string): Promise<Map<string, TurnGenerationMetadata>> {
    await writes.get(this.path(threadId))?.catch(() => {})
    const data = new Map<string, TurnGenerationMetadata>()
    for (const legacy of this.legacy ? [true, false] : [false]) {
      let file
      try {
        file = await open(this.path(threadId, legacy), 'r')
        const info = await file.stat()
        if (info.size > MAX_BYTES) continue
        const path = this.path(threadId, legacy)
        const signature = `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`
        const cached = cache.get(path)
        if (cached?.signature === signature) {
          for (const [id, metadata] of cached.data) data.set(id, mergeGenerationMetadata(data.get(id), metadata))
          continue
        }
        const bytes = Buffer.alloc(info.size)
        let offset = 0
        while (offset < bytes.length) {
          const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
          if (!bytesRead) break
          offset += bytesRead
        }
        const raw = bytes.subarray(0, offset).toString('utf8')
        const parsed = new Map<string, TurnGenerationMetadata>()
        // Only complete rows count as durable evidence.
        for (const line of raw.slice(0, raw.lastIndexOf('\n') + 1).split('\n')) {
          try {
            const row = JSON.parse(line)
            const metadata = readGenerationMetadata(row?.metadata)
            if (typeof row?.turnId === 'string' && metadata) parsed.set(row.turnId, mergeGenerationMetadata(parsed.get(row.turnId), metadata))
          } catch { /* Ignore malformed or incomplete records. */ }
        }
        cache.set(path, { signature, data: parsed })
        if (cache.size > 8) cache.delete(cache.keys().next().value!)
        for (const [id, metadata] of parsed) data.set(id, mergeGenerationMetadata(data.get(id), metadata))
      } catch { /* Missing or unreadable metadata leaves history unknown. */ }
      finally { await file?.close() }
    }
    return data
  }
  async enrich(threadId: string, turns: unknown[]): Promise<unknown[]> {
    if (!turns.length) return turns
    const saved = await this.read(threadId)
    return turns.map(turn => {
      if (!turn || typeof turn !== 'object') return turn
      const row = turn as Record<string, unknown>
      const metadata = mergeGenerationMetadata(saved.get(String(row.id)), readGenerationMetadata(row.generationMetadata))
      return Object.keys(metadata).length ? { ...row, generationMetadata: metadata } : turn
    })
  }
}
