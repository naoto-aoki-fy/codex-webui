import { readCodexGlobalState, updateCodexGlobalState } from './codexGlobalState.js'

// Codex 0.167.2 codex-rs/state/src/lib.rs: built-in Pinned section.
export const PINNED_THREAD_SECTION_ID = '01984de2-8f74-7c91-a3b2-5c5e937cf318'

type Rpc = (method: string, params: unknown) => Promise<unknown>

export function createThreadPresentationStore() {
  let migration: Promise<void> | undefined
  async function migrate(rpc: Rpc): Promise<void> {
    if (migration) return migration
    migration = (async () => {
      const state = await readCodexGlobalState()
      const ids = state['pinned-thread-ids']
      if (!Array.isArray(ids)) return
      // Verify native support before changing legacy state. An interrupted migration
      // can safely repeat moves; no conversations or unrelated fields are removed.
      await rpc('threadSection/list', { limit: 1 })
      for (const threadId of [...new Set(ids)]) {
        if (typeof threadId !== 'string' || !threadId) continue
        await rpc('thread/section/move', { threadId, sectionId: PINNED_THREAD_SECTION_ID })
      }
      await updateCodexGlobalState(payload => { delete payload['pinned-thread-ids'] })
    })().finally(() => { migration = undefined })
    return migration
  }
  async function readPinnedThreadIds(rpc: Rpc): Promise<string[]> {
    await migrate(rpc)
    const ids: string[] = []
    let cursor: string | null = null
    do {
      const page = await rpc('thread/list', {
        sectionId: PINNED_THREAD_SECTION_ID, sortKey: 'section_position', limit: 100, cursor,
      }) as { data: { id: string }[]; nextCursor?: string | null }
      ids.push(...page.data.map(thread => thread.id))
      cursor = page.nextCursor ?? null
    } while (cursor)
    return ids
  }
  return { readPinnedThreadIds }
}
