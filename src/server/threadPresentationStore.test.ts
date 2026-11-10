import { mkdtemp, readFile, rm, writeFile, mkdir, stat, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createThreadPresentationStore } from './threadPresentationStore'

// The bridge supplies this existing normalizer, shared with workspace persistence.
const normalizeStrings = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))]
  : []

let home: string
let store: ReturnType<typeof createThreadPresentationStore>
const entry = (id: string, title: string, date = '2026-01-01') => JSON.stringify({ id, thread_name: title, updated_at: date })
const statePath = () => join(home, '.codex-global-state.json')
const indexPath = () => join(home, 'session_index.jsonl')
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'thread-presentation-'))
  vi.stubEnv('CODEX_HOME', home)
  store = createThreadPresentationStore(indexPath, normalizeStrings)
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(home, { recursive: true, force: true })
})

describe('thread presentation persistence characterization', () => {
  it('keeps index precedence, persisted fallback and absent titles', async () => {
    await writeFile(statePath(), JSON.stringify({ 'thread-titles': { titles: { same: 'User', fallback: 'Generated' }, order: ['same', 'fallback'] } }))
    await writeFile(indexPath(), entry('same', 'Index'))
    expect(await store.readMergedThreadTitleCache()).toEqual({ titles: { same: 'Index', fallback: 'Generated' }, order: ['same', 'fallback'] })
    expect((await store.readMergedThreadTitleCache()).titles.missing).toBeUndefined()
  })

  it('skips malformed JSONL and invalid entries, picks latest dates and last tied entry', async () => {
    await writeFile(indexPath(), ['{bad', '', 'null', '{}', entry('x', 'Newest', '2026-02-01'), entry('x', 'Old'), entry('x', 'Tied', '2026-02-01'), entry(' y ', ' Trimmed ', 'invalid'), entry('', 'Ignored')].join('\n'))
    expect(await store.readThreadTitlesFromSessionIndex()).toEqual({ titles: { x: 'Tied', y: 'Trimmed' }, order: ['x', 'y'] })
  })

  it('handles missing files, creation, changed files and deletion', async () => {
    expect(await store.readMergedThreadTitleCache()).toEqual({ titles: {}, order: [] })
    await writeFile(indexPath(), entry('x', 'First'))
    const first = await store.readThreadTitlesFromSessionIndex()
    expect(await store.readThreadTitlesFromSessionIndex()).toBe(first)
    await writeFile(indexPath(), entry('x', 'Changed size'))
    expect((await store.readThreadTitlesFromSessionIndex()).titles.x).toBe('Changed size')
    await rm(indexPath())
    expect(await store.readThreadTitlesFromSessionIndex()).toEqual({ titles: {}, order: [] })
  })

  it('invalidates on mtime changes even when size is identical', async () => {
    await writeFile(indexPath(), entry('x', 'First'))
    const first = await store.readThreadTitlesFromSessionIndex()
    const previous = await stat(indexPath())
    await writeFile(indexPath(), entry('x', 'Other'))
    await utimes(indexPath(), previous.atime, new Date(previous.mtimeMs + 5000))
    expect(await store.readThreadTitlesFromSessionIndex()).not.toBe(first)
    expect((await store.readThreadTitlesFromSessionIndex()).titles.x).toBe('Other')
  })

  it('keeps caches isolated per bridge evaluation, not per caller', async () => {
    await writeFile(indexPath(), entry('x', 'Title'))
    const first = await store.readThreadTitlesFromSessionIndex()
    const another = createThreadPresentationStore(indexPath, normalizeStrings)
    expect(await another.readThreadTitlesFromSessionIndex()).toEqual(first)
    expect(await another.readThreadTitlesFromSessionIndex()).not.toBe(first)
  })

  it('preserves signature-only keys even when the resolved index path changes', async () => {
    const otherPath = join(home, 'other-index.jsonl')
    await writeFile(indexPath(), entry('x', 'First'))
    await writeFile(otherPath, entry('x', 'Other'))
    for (const path of [indexPath(), otherPath]) await utimes(path, 1700000000, 1700000000)
    let currentPath = indexPath()
    const dynamicStore = createThreadPresentationStore(() => currentPath, normalizeStrings)
    const first = await dynamicStore.readThreadTitlesFromSessionIndex()
    currentPath = otherPath
    expect(await dynamicStore.readThreadTitlesFromSessionIndex()).toBe(first)
    expect(first.titles.x).toBe('First')
  })

  it('caps index and merged caches at 500, ordered by most recent entry', async () => {
    await writeFile(indexPath(), Array.from({ length: 502 }, (_, i) => entry(String(i), `Title ${i}`, new Date(i * 1000).toISOString())).join('\n'))
    const cache = await store.readMergedThreadTitleCache()
    expect(cache.order).toHaveLength(500)
    expect(Object.keys(cache.titles)).toHaveLength(500)
    expect(cache.order[0]).toBe('501')
    expect(cache.order.at(-1)).toBe('2')
  })

  it('evicts oldest persisted title, moves updated title first and removes titles', async () => {
    let cache = { titles: {} as Record<string, string>, order: [] as string[] }
    for (let i = 0; i < 501; i++) cache = store.updateThreadTitleCache(cache, String(i), `Title ${i}`)
    expect(cache.order).toHaveLength(500)
    expect(cache.titles['0']).toBeUndefined()
    cache = store.updateThreadTitleCache(cache, '1', 'Updated')
    expect(cache.order[0]).toBe('1')
    cache = store.removeFromThreadTitleCache(cache, '1')
    expect(cache.titles['1']).toBeUndefined()
    expect(cache.order).not.toContain('1')
  })

  it('normalizes pins without trimming or sorting and preserves first occurrence', async () => {
    const ids = store.normalizePinnedThreadIds(['b', '', 1, 'a', 'b', ' ', 'a'])
    expect(ids).toEqual(['b', 'a', ' '])
    await store.writePinnedThreadIds(ids)
    expect(await store.readPinnedThreadIds()).toEqual(ids)
  })

  it('serializes concurrent title and pin updates and preserves unrelated fields', async () => {
    await writeFile(statePath(), JSON.stringify({ unrelated: { value: 42 }, 'pinned-thread-ids': ['old'] }))
    await Promise.all([
      store.mutateThreadTitleCache(cache => store.updateThreadTitleCache(cache, 'a', 'A')),
      store.writePinnedThreadIds(['b', 'b', 'a']),
      store.mutateThreadTitleCache(cache => store.updateThreadTitleCache(cache, 'b', 'B')),
    ])
    expect(JSON.parse(await readFile(statePath(), 'utf8'))).toEqual({ unrelated: { value: 42 }, 'pinned-thread-ids': ['b', 'a'], 'thread-titles': { titles: { a: 'A', b: 'B' }, order: ['b', 'a'] } })
  })

  it('propagates malformed global state without overwriting it', async () => {
    await writeFile(statePath(), '{broken')
    await expect(store.readMergedThreadTitleCache()).rejects.toBeInstanceOf(SyntaxError)
    await expect(store.writePinnedThreadIds(['x'])).rejects.toBeInstanceOf(SyntaxError)
    await expect(store.mutateThreadTitleCache(cache => cache)).rejects.toBeInstanceOf(SyntaxError)
    expect(await readFile(statePath(), 'utf8')).toBe('{broken')
  })

  it('propagates global-state filesystem failures but tolerates unreadable index', async () => {
    await mkdir(statePath())
    await expect(store.readPinnedThreadIds()).rejects.toThrow()
    await expect(store.writePinnedThreadIds(['x'])).rejects.toThrow()
    await mkdir(indexPath())
    expect(await store.readThreadTitlesFromSessionIndex()).toEqual({ titles: {}, order: [] })
  })
})
