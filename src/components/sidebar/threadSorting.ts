import type { UiThread } from '../../types/codex'
import type { SidebarGroup } from './sidebarGroups'

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
export function sortThreadGroups(
  groups: SidebarGroup[], mode: ThreadSortMode, nativeProjectIds: readonly string[] = [],
): SidebarGroup[] {
  const compare = compareThreads(mode)
  const position = new Map(nativeProjectIds.map((id, index) => [id, index]))
  return groups.map(group => ({ ...group, threads: [...group.threads].sort(compare) }))
    .sort((a, b) => {
      const aName = a.kind === 'project' ? a.projectId : a.key
      const bName = b.kind === 'project' ? b.projectId : b.key
      const aPosition = a.kind === 'project' ? position.get(a.projectId) : undefined
      const bPosition = b.kind === 'project' ? position.get(b.projectId) : undefined
      if (aPosition !== undefined || bPosition !== undefined) {
        return (aPosition ?? position.size) - (bPosition ?? position.size)
      }
      if (!a.threads.length || !b.threads.length) {
        return Number(!a.threads.length) - Number(!b.threads.length) || aName.localeCompare(bName)
      }
      const first = timestamp(a.threads[0]!, mode)
      const second = timestamp(b.threads[0]!, mode)
      return (first === second ? 0 : first > second ? -1 : 1) || aName.localeCompare(bName)
    })
}
