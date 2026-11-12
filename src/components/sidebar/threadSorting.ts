import type { UiProjectGroup, UiThread } from '../../types/codex'

export type ThreadSortMode = 'created' | 'updated'

function timestamp(thread: UiThread, mode: ThreadSortMode): number {
  const value = Date.parse(mode === 'created' ? thread.createdAtIso : thread.updatedAtIso)
  return Number.isFinite(value) ? value : -Infinity
}

export function compareThreads(mode: ThreadSortMode): (a: UiThread, b: UiThread) => number {
  return (a, b) => {
    const first = timestamp(a, mode)
    const second = timestamp(b, mode)
    return (first === second ? 0 : first > second ? -1 : 1) || a.id.localeCompare(b.id)
  }
}

// Sort copies: source groups are shared with selection, search, and pinned threads.
export function sortThreadGroups(groups: UiProjectGroup[], mode: ThreadSortMode): UiProjectGroup[] {
  const compare = compareThreads(mode)
  return groups.map(group => ({ ...group, threads: [...group.threads].sort(compare) }))
    .sort((a, b) => {
      if (!a.threads.length || !b.threads.length) {
        return Number(!a.threads.length) - Number(!b.threads.length) || a.projectName.localeCompare(b.projectName)
      }
      const first = timestamp(a.threads[0]!, mode)
      const second = timestamp(b.threads[0]!, mode)
      return (first === second ? 0 : first > second ? -1 : 1) || a.projectName.localeCompare(b.projectName)
    })
}
