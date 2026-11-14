import { readCodexGlobalState } from './codexGlobalState.js'

// Codex 0.167.2 codex-rs/state/src/lib.rs: built-in Pinned section.
export const PINNED_THREAD_SECTION_ID = '01984de2-8f74-7c91-a3b2-5c5e937cf318'

type Rpc = (method: string, params: unknown) => Promise<unknown>

export function createThreadPresentationStore() {
  async function readPinnedThreadIds(rpc: Rpc): Promise<string[]> {
    const state = await readCodexGlobalState()
    const legacyPins = state['pinned-thread-ids']
    if (Array.isArray(legacyPins) && legacyPins.some(id => typeof id === 'string' && id.trim())) {
      throw new Error('Legacy pin migration is incomplete. Complete pin migration using WebUI commit 3f659043adef2fb075919dec669e88e843fe4889 with the same connection profile and CODEX_HOME before upgrading; see docs/native-project-migration.md. Stored data is unchanged.')
    }
    const ids: string[] = []
    let cursor: string | null = null
    const seen = new Set<string>()
    do {
      let result: unknown
      try { result = await rpc('thread/list', {
        sectionId: PINNED_THREAD_SECTION_ID, sortKey: 'section_position', limit: 100, cursor,
      }) } catch (error) {
        if ((error as { code?: number }).code === -32601) throw new Error('Native thread sections are required for pinning. Upgrade Codex.')
        throw error
      }
      const page = result as { data: { id: string }[]; nextCursor?: string | null }
      if (!Array.isArray(page?.data) || page.data.some(t => typeof t?.id !== 'string') || (page.nextCursor != null && typeof page.nextCursor !== 'string')) throw new Error('Malformed native pin listing response')
      ids.push(...page.data.map(thread => thread.id))
      cursor = page.nextCursor ?? null
      if (cursor && seen.has(cursor)) throw new Error('Repeated native pin listing cursor')
      if (cursor) seen.add(cursor)
    } while (cursor)
    return ids
  }
  return { readPinnedThreadIds }
}
