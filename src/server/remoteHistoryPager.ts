/** Native pagination uses the actual Codex 0.167.2 experimental schema. The
 * small index scan preserves absolute turn positions used by fork controls;
 * conversation item payloads are fetched only for the requested page. */
export const HISTORY_MAX_THREADS = 16
export const HISTORY_MAX_INDEX_BYTES = 16 * 1024 * 1024
export const HISTORY_INDEX_TTL_MS = 2_000
export const HISTORY_MAX_INDEX_PAGES = 100

type RecordValue = Record<string, unknown>
function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null
}
type Client = {
  rpc(method: string, params: unknown): Promise<unknown>
  readThreadForTurnPage(threadId: string): Promise<unknown>
  getConnectionGeneration(): number
}
type Index = { metadata: RecordValue; ids: string[]; cursors: Map<string, string>; bytes: number; entry: Entry }
type Entry = { generation: number; expires: number; promise: Promise<Index>; pending: boolean; bytes: number }

export class RemoteHistoryPager {
  private readonly entries = new Map<string, Entry>()
  private readonly pendingPages = new Map<string, { threadId: string; promise: Promise<{ result: unknown; startTurnIndex: number; hasMoreOlder: boolean }> }>()
  private unsupportedGeneration: number | null = null
  constructor(private readonly client: Client) {}

  getCacheStats() {
    return { entries: this.entries.size, bytes: [...this.entries.values()].reduce((total, entry) => total + entry.bytes, 0), pending: [...this.entries.values()].filter(entry => entry.pending).length }
  }

  invalidate(threadId?: string): void {
    if (threadId) this.entries.delete(threadId)
    else this.entries.clear()
    for (const [key, page] of this.pendingPages) {
      if (!threadId || page.threadId === threadId) this.pendingPages.delete(key)
    }
  }

  private async list(threadId: string, params: RecordValue): Promise<{ data: unknown[]; nextCursor: string | null }> {
    const result = record(await this.client.rpc('thread/turns/list', { threadId, ...params }))
    if (!Array.isArray(result?.data) || (result.nextCursor != null && typeof result.nextCursor !== 'string') ||
      result.data.some(turn => typeof record(turn)?.id !== 'string' || !Array.isArray(record(turn)?.items))) {
      throw new Error('Incompatible thread/turns/list response: expected data turns and an opaque nextCursor')
    }
    return { data: result.data, nextCursor: typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : null }
  }

  private async index(threadId: string): Promise<Index> {
    const generation = this.client.getConnectionGeneration()
    const old = this.entries.get(threadId)
    if (old && old.generation === generation && (old.pending || old.expires > Date.now())) return old.promise
    this.entries.delete(threadId)
    while (this.entries.size >= HISTORY_MAX_THREADS) {
      const evictable = [...this.entries].find(([, entry]) => !entry.pending)
      if (!evictable) throw new Error('History recovery is busy (16 concurrent indexes). Retry shortly.')
      this.entries.delete(evictable[0])
    }
    const entry: Entry = { generation, expires: Date.now() + HISTORY_INDEX_TTL_MS, promise: null!, pending: true, bytes: 0 }
    this.entries.set(threadId, entry)
    entry.promise = (async () => {
      const metadata = record(await this.client.rpc('thread/read', { threadId, includeTurns: false }))
      if (!metadata || !record(metadata.thread)) throw new Error('Incompatible metadata-only thread/read response')
      const ids: string[] = []
      const seen = new Set<string>()
      const cursors = new Set<string>()
      let cursor: string | null = null
      let bytes = Buffer.byteLength(JSON.stringify(metadata))
      for (let page = 0; page < HISTORY_MAX_INDEX_PAGES; page++) {
        if (generation !== this.client.getConnectionGeneration() || this.entries.get(threadId) !== entry) throw new Error('History changed while loading. Refresh the thread.')
        const result = await this.list(threadId, { itemsView: 'notLoaded', sortDirection: 'asc', limit: 1000, ...(cursor ? { cursor } : {}) })
        if (generation !== this.client.getConnectionGeneration() || this.entries.get(threadId) !== entry) throw new Error('History changed while loading. Refresh the thread.')
        if (result.data.length > 1000) throw new Error('Incompatible history pagination: server exceeded the requested limit')
        for (const turn of result.data) {
          const id = record(turn)!.id as string
          if (!id || seen.has(id)) throw new Error('Incompatible history pagination: duplicate or empty turn ID')
          seen.add(id)
          ids.push(id)
          bytes += Buffer.byteLength(id) + 16
          if (ids.length > 100_000 || bytes > HISTORY_MAX_INDEX_BYTES) throw new Error('History index exceeds the 100,000-turn / 16 MiB safety budget. Use the upstream client for this thread.')
        }
        cursor = result.nextCursor
        if (!cursor) {
          if (generation !== this.client.getConnectionGeneration() || this.entries.get(threadId) !== entry) throw new Error('History changed while loading. Refresh the thread.')
          const index = { metadata, ids, cursors: new Map<string, string>(), bytes, entry }
          entry.bytes = bytes
          entry.pending = false
          let retained = [...this.entries.values()].reduce((total, value) => total + value.bytes, 0)
          for (const [key, other] of this.entries) {
            if (retained <= HISTORY_MAX_INDEX_BYTES) break
            if (other !== entry && !other.pending) { retained -= other.bytes; this.entries.delete(key) }
          }
          entry.expires = Date.now() + HISTORY_INDEX_TTL_MS
          return index
        }
        if (cursors.has(cursor)) throw new Error('Incompatible history pagination: repeated cursor')
        cursors.add(cursor)
      }
      throw new Error('History index exceeds the 100-page safety budget. Use the upstream client for this thread.')
    })().catch(error => {
      if (this.entries.get(threadId) === entry) this.entries.delete(threadId)
      throw error
    })
    return entry.promise
  }

  async read(threadId: string, beforeTurnId = '', limit = 10): Promise<{ result: unknown; startTurnIndex: number; hasMoreOlder: boolean }> {
    const key = JSON.stringify([this.client.getConnectionGeneration(), threadId, beforeTurnId, limit])
    const existing = this.pendingPages.get(key)
    if (existing) return existing.promise
    if (this.pendingPages.size >= 16) throw new Error('History reads are busy (16 concurrent indexes/pages). Retry shortly.')
    const promise = this.readUncached(threadId, beforeTurnId, limit).finally(() => {
      if (this.pendingPages.get(key)?.promise === promise) this.pendingPages.delete(key)
    })
    this.pendingPages.set(key, { threadId, promise })
    return promise
  }

  private async readUncached(threadId: string, beforeTurnId: string, limit: number): Promise<{ result: unknown; startTurnIndex: number; hasMoreOlder: boolean }> {
    limit = Math.max(1, Math.min(50, Math.floor(limit) || 10))
    const generation = this.client.getConnectionGeneration()
    if (this.unsupportedGeneration !== generation) {
      try {
        const index = await this.index(threadId)
        const end = beforeTurnId ? index.ids.indexOf(beforeTurnId) : index.ids.length
        if (end < 0) throw new Error('The history boundary is no longer available. Refresh the thread.')
        let cursor = beforeTurnId ? index.cursors.get(beforeTurnId) : undefined
        // A caller can request an arbitrary boundary. Seek using metadata-only
        // pages rather than fetching and discarding full conversation items.
        if (beforeTurnId && !cursor && end < index.ids.length) {
          let skip = index.ids.length - end
          const seen = new Set<string>()
          let seekPages = 0
          while (skip > 0) {
            if (++seekPages > HISTORY_MAX_INDEX_PAGES) throw new Error('History boundary seek exceeds the 100-page safety budget. Refresh the thread or use the upstream client.')
            if (generation !== this.client.getConnectionGeneration() || this.entries.get(threadId) !== index.entry) throw new Error('History changed while loading. Refresh the thread.')
            const count = Math.min(skip, 1000)
            const page = await this.list(threadId, { itemsView: 'notLoaded', sortDirection: 'desc', limit: count, ...(cursor ? { cursor } : {}) })
            if (!page.data.length || !page.nextCursor || seen.has(page.nextCursor) || page.data.length > count) throw new Error('History changed or pagination cursor repeated. Refresh the thread.')
            seen.add(page.nextCursor)
            skip -= page.data.length
            cursor = page.nextCursor
          }
        }
        const page = await this.list(threadId, { itemsView: 'full', sortDirection: 'desc', limit, ...(cursor ? { cursor } : {}) })
        if (generation !== this.client.getConnectionGeneration() || this.entries.get(threadId) !== index.entry) throw new Error('History changed while loading. Refresh the thread.')
        const turns = [...page.data].reverse()
        const start = end - turns.length
        if (start < 0 || turns.length > limit || turns.some((turn, i) => record(turn)?.id !== index.ids[start + i])) {
          this.invalidate(threadId)
          throw new Error('History changed while loading. Refresh the thread.')
        }
        const firstId = record(turns[0])?.id
        if (typeof firstId === 'string' && page.nextCursor) index.cursors.set(firstId, page.nextCursor)
        return { result: { ...index.metadata, threadTurnStartIndex: start, thread: { ...record(index.metadata.thread), turns } }, startTurnIndex: start, hasMoreOlder: start > 0 }
      } catch (error) {
        // Only an explicit missing-method reply proves lack of support.
        if ((error as { code?: number }).code !== -32601) throw error
        this.unsupportedGeneration = generation
        this.entries.clear()
      }
    }
    const value = record(await this.client.readThreadForTurnPage(threadId))
    const thread = record(value?.thread)
    if (!value || !thread || !Array.isArray(thread.turns)) throw new Error('Incompatible thread/read history response')
    const end = beforeTurnId ? thread.turns.findIndex(turn => record(turn)?.id === beforeTurnId) : thread.turns.length
    if (end < 0) throw new Error('The history boundary is no longer available. Refresh the thread.')
    const start = Math.max(0, end - limit)
    return { result: { ...value, threadTurnStartIndex: start, thread: { ...thread, turns: thread.turns.slice(start, end) } }, startTurnIndex: start, hasMoreOlder: start > 0 }
  }
}
