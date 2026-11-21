import type { UiProjectGroup, UiThread } from '../../types/codex'
import type { SidebarGroup } from './sidebarGroups'

export function filterSidebarGroups(
  groups: SidebarGroup[],
  matches: (thread: UiThread) => boolean,
): SidebarGroup[] {
  return groups.flatMap((group) => {
    const threads = group.threads.filter(matches)
    if (threads.length > 0 || group.threads.length === 0) return [{ ...group, threads }]
    return []
  })
}

export function collectChronologicalThreads(
  groups: UiProjectGroup[],
  matches: (thread: UiThread) => boolean,
  pinnedIds: Set<string>,
): UiThread[] {
  return groups.flatMap((group) => group.threads.filter((thread) => !pinnedIds.has(thread.id) && matches(thread)))
}
