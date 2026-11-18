import { posix, win32 } from 'node:path'
import type { AppServerClient } from './appServerClient.js'
import type { FsReadDirectoryResponse } from './protocol/0.167.2/v2/FsReadDirectoryResponse.js'
import type { FsGetMetadataResponse } from './protocol/0.167.2/v2/FsGetMetadataResponse.js'
import type { FsReadFileResponse } from './protocol/0.167.2/v2/FsReadFileResponse.js'


// Choose lexical path rules from the remote path, never the Web host OS.
export function projectPath(path: string) {
  return /^[a-z]:[\\/]/iu.test(path) || path.startsWith('\\\\') || /^\/\/[^/]+\/[^/]+/u.test(path) ? win32 : posix
}

export const FILE_CACHE_MAX_BYTES = 16 * 1024 * 1024
export const FILE_CACHE_MAX_ENTRIES = 32
export const FILE_CACHE_TTL_MS = 2_000
const MAX_PENDING_READS = 64

type FileClient = Pick<AppServerClient, 'rpc'> & Partial<Pick<AppServerClient, 'getConnectionGeneration'>>
type CachedFile = { bytes: Buffer; stamp: string; expiresAt: number }

/** A bounded, short-lived read cache. The caller must supply freshly read
 * metadata to reuse bytes. No ranged upstream read exists in the pinned API. */
export class ProjectFileService {
  private readonly cache = new Map<string, CachedFile>()
  private readonly pending = new Map<string, Promise<Buffer>>()
  private cacheBytes = 0
  private generation: number | undefined

  constructor(private readonly client: FileClient) {}

  private syncGeneration(): number | undefined {
    const generation = this.client.getConnectionGeneration?.()
    if (generation !== this.generation) {
      this.cache.clear()
      this.pending.clear()
      this.cacheBytes = 0
      this.generation = generation
    }
    return generation
  }

  getCacheStats(): { entries: number; bytes: number; pending: number } {
    this.syncGeneration()
    return { entries: this.cache.size, bytes: this.cacheBytes, pending: this.pending.size }
  }

  private evict(path: string): void {
    const old = this.cache.get(path)
    if (old) this.cacheBytes -= old.bytes.length
    this.cache.delete(path)
  }

  async readFile(path: string, metadata?: FsGetMetadataResponse): Promise<Buffer> {
    const generation = this.syncGeneration()
    // Zero/unknown mtime cannot validate cached bytes.
    const stamp = metadata && metadata.modifiedAtMs > 0
      ? `${metadata.modifiedAtMs}:${metadata.createdAtMs}:${metadata.isFile}` : ''
    const cached = this.cache.get(path)
    if (cached && stamp && cached.stamp === stamp && cached.expiresAt > Date.now()) {
      this.cache.delete(path)
      this.cache.set(path, cached)
      return cached.bytes
    }
    this.evict(path)
    // Coalesce identical concurrent reads; a metadata change creates a separate epoch.
    const key = `${path}\0${stamp}`
    const existing = this.pending.get(key)
    if (existing) return existing
    if (this.pending.size >= MAX_PENDING_READS) throw new Error('Remote file reads are busy (64 concurrent reads). Retry shortly.')
    const promise = this.client.rpc('fs/readFile', { path }).then(result => {
      const response = result as FsReadFileResponse
      if (typeof response?.dataBase64 !== 'string') throw new Error('Invalid fs/readFile response')
      const bytes = Buffer.from(response.dataBase64, 'base64')
      if (generation !== this.syncGeneration()) throw new Error('Retired app-server file read')
      if (stamp && this.pending.get(key) === promise && bytes.length <= FILE_CACHE_MAX_BYTES) {
        this.evict(path)
        for (const [otherPath, entry] of this.cache) {
          if (entry.expiresAt <= Date.now()) this.evict(otherPath)
        }
        while (this.cache.size >= FILE_CACHE_MAX_ENTRIES || this.cacheBytes + bytes.length > FILE_CACHE_MAX_BYTES) {
          this.evict(this.cache.keys().next().value!)
        }
        this.cache.set(path, { bytes, stamp, expiresAt: Date.now() + FILE_CACHE_TTL_MS })
        this.cacheBytes += bytes.length
      }
      return bytes
    }).finally(() => {
      if (this.pending.get(key) === promise) this.pending.delete(key)
    })
    this.pending.set(key, promise)
    return promise
  }

  async getMetadata(path: string): Promise<FsGetMetadataResponse> {
    const generation = this.syncGeneration()
    const result = await this.client.rpc('fs/getMetadata', { path }) as FsGetMetadataResponse
    if (generation !== this.syncGeneration()) throw new Error('Retired app-server metadata read')
    if (typeof result?.isFile !== 'boolean' || typeof result?.isDirectory !== 'boolean') throw new Error('Invalid fs/getMetadata response')
    return result
  }

  async readDirectory(path: string): Promise<FsReadDirectoryResponse> {
    const generation = this.syncGeneration()
    const result = await this.client.rpc('fs/readDirectory', { path }) as FsReadDirectoryResponse
    if (generation !== this.syncGeneration()) throw new Error('Retired app-server directory read')
    if (!Array.isArray(result?.entries) || result.entries.some(entry => typeof entry.fileName !== 'string' || typeof entry.isDirectory !== 'boolean')) throw new Error('Invalid fs/readDirectory response')
    return result
  }
}
