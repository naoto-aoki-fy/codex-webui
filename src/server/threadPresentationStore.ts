import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { asRecord } from './bridgeHttpUtils.js'
import { readCodexGlobalState, updateCodexGlobalState } from './codexGlobalState.js'

// Instantiate once per bridge module evaluation, rather than owning a shared module cache.
// Resolve the path on every read, preserving dynamic CODEX_HOME and signature-only keys.
export function createThreadPresentationStore(
  getCodexSessionIndexPath: () => string | null,
  normalizeStringArray: (value: unknown) => string[],
) {
  type ThreadTitleCache = { titles: Record<string, string>; order: string[] }
  const MAX_THREAD_TITLES = 500
  const EMPTY_THREAD_TITLE_CACHE: ThreadTitleCache = { titles: {}, order: [] }
  const PINNED_THREAD_IDS_KEY = 'pinned-thread-ids'

  type SessionIndexThreadTitleCacheState = {
    fileSignature: string | null
    cache: ThreadTitleCache
  }

  let sessionIndexThreadTitleCacheState: SessionIndexThreadTitleCacheState = {
    fileSignature: null,
    cache: EMPTY_THREAD_TITLE_CACHE,
  }

  function normalizeThreadTitleCache(value: unknown): ThreadTitleCache {
    const record = asRecord(value)
    if (!record) return EMPTY_THREAD_TITLE_CACHE
    const rawTitles = asRecord(record.titles)
    const titles: Record<string, string> = {}
    if (rawTitles) {
      for (const [k, v] of Object.entries(rawTitles)) {
        if (typeof v === 'string' && v.length > 0) titles[k] = v
      }
    }
    const order = normalizeStringArray(record.order)
    return { titles, order }
  }

  function normalizePinnedThreadIds(value: unknown): string[] {
    return normalizeStringArray(value)
  }

  function updateThreadTitleCache(cache: ThreadTitleCache, id: string, title: string): ThreadTitleCache {
    const titles = { ...cache.titles, [id]: title }
    const order = [id, ...cache.order.filter((o) => o !== id)]
    while (order.length > MAX_THREAD_TITLES) {
      const removed = order.pop()
      if (removed) delete titles[removed]
    }
    return { titles, order }
  }

  function removeFromThreadTitleCache(cache: ThreadTitleCache, id: string): ThreadTitleCache {
    const { [id]: _, ...titles } = cache.titles
    return { titles, order: cache.order.filter((o) => o !== id) }
  }

  type SessionIndexThreadTitle = {
    id: string
    title: string
    updatedAtMs: number
  }

  function normalizeSessionIndexThreadTitle(value: unknown): SessionIndexThreadTitle | null {
    const record = asRecord(value)
    if (!record) return null

    const id = typeof record.id === 'string' ? record.id.trim() : ''
    const title = typeof record.thread_name === 'string' ? record.thread_name.trim() : ''
    const updatedAtIso = typeof record.updated_at === 'string' ? record.updated_at.trim() : ''
    const updatedAtMs = updatedAtIso ? Date.parse(updatedAtIso) : Number.NaN

    if (!id || !title) return null
    return {
      id,
      title,
      updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0,
    }
  }

  function trimThreadTitleCache(cache: ThreadTitleCache): ThreadTitleCache {
    const titles = { ...cache.titles }
    const order = cache.order.filter((id) => {
      if (!titles[id]) return false
      return true
    }).slice(0, MAX_THREAD_TITLES)

    for (const id of Object.keys(titles)) {
      if (!order.includes(id)) {
        delete titles[id]
      }
    }

    return { titles, order }
  }

  function mergeThreadTitleCaches(base: ThreadTitleCache, overlay: ThreadTitleCache): ThreadTitleCache {
    const titles = { ...base.titles, ...overlay.titles }
    const order: string[] = []

    for (const id of [...overlay.order, ...base.order]) {
      if (!titles[id] || order.includes(id)) continue
      order.push(id)
    }

    for (const id of Object.keys(titles)) {
      if (!order.includes(id)) {
        order.push(id)
      }
    }

    return trimThreadTitleCache({ titles, order })
  }

  async function readThreadTitleCache(): Promise<ThreadTitleCache> {
    const payload = await readCodexGlobalState()
    return normalizeThreadTitleCache(payload['thread-titles'])
  }

  async function mutateThreadTitleCache(update: (cache: ThreadTitleCache) => ThreadTitleCache): Promise<void> {
    await updateCodexGlobalState((payload) => {
      payload['thread-titles'] = update(normalizeThreadTitleCache(payload['thread-titles']))
    })
  }

  async function readPinnedThreadIds(): Promise<string[]> {
    const payload = await readCodexGlobalState()
    return normalizePinnedThreadIds(payload[PINNED_THREAD_IDS_KEY])
  }

  async function writePinnedThreadIds(threadIds: string[]): Promise<void> {
    await updateCodexGlobalState((payload) => {
      payload[PINNED_THREAD_IDS_KEY] = normalizePinnedThreadIds(threadIds)
    })
  }


  function getSessionIndexFileSignature(stats: { mtimeMs: number; size: number }): string {
    return `${String(stats.mtimeMs)}:${String(stats.size)}`
  }

  async function parseThreadTitlesFromSessionIndex(sessionIndexPath: string): Promise<ThreadTitleCache> {
    const latestById = new Map<string, SessionIndexThreadTitle>()
    const input = createReadStream(sessionIndexPath, { encoding: 'utf8' })
    const lines = createInterface({
      input,
      crlfDelay: Infinity,
    })

    try {
      for await (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        try {
          const entry = normalizeSessionIndexThreadTitle(JSON.parse(trimmed) as unknown)
          if (!entry) continue

          const previous = latestById.get(entry.id)
          if (!previous || entry.updatedAtMs >= previous.updatedAtMs) {
            latestById.set(entry.id, entry)
          }
        } catch {
          // Skip malformed lines and keep scanning the rest of the index.
        }
      }
    } finally {
      lines.close()
      input.close()
    }

    const entries = Array.from(latestById.values()).sort((first, second) => second.updatedAtMs - first.updatedAtMs)
    const titles: Record<string, string> = {}
    const order: string[] = []
    for (const entry of entries) {
      titles[entry.id] = entry.title
      order.push(entry.id)
    }

    return trimThreadTitleCache({ titles, order })
  }

  async function readThreadTitlesFromSessionIndex(): Promise<ThreadTitleCache> {
    const sessionIndexPath = getCodexSessionIndexPath()
    if (!sessionIndexPath) return EMPTY_THREAD_TITLE_CACHE

    try {
      const stats = await stat(sessionIndexPath)
      const fileSignature = getSessionIndexFileSignature(stats)
      if (sessionIndexThreadTitleCacheState.fileSignature === fileSignature) {
        return sessionIndexThreadTitleCacheState.cache
      }

      const cache = await parseThreadTitlesFromSessionIndex(sessionIndexPath)
      sessionIndexThreadTitleCacheState = { fileSignature, cache }
      return cache
    } catch {
      sessionIndexThreadTitleCacheState = {
        fileSignature: 'missing',
        cache: EMPTY_THREAD_TITLE_CACHE,
      }
      return sessionIndexThreadTitleCacheState.cache
    }
  }

  async function readMergedThreadTitleCache(): Promise<ThreadTitleCache> {
    const [sessionIndexCache, persistedCache] = await Promise.all([
      readThreadTitlesFromSessionIndex(),
      readThreadTitleCache(),
    ])
    return mergeThreadTitleCaches(persistedCache, sessionIndexCache)
  }

  return {
    normalizePinnedThreadIds,
    updateThreadTitleCache,
    removeFromThreadTitleCache,
    mutateThreadTitleCache,
    readPinnedThreadIds,
    writePinnedThreadIds,
    readMergedThreadTitleCache,
    readThreadTitlesFromSessionIndex,
  }
}
