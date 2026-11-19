import type { Project } from '../server/protocol/0.167.2/v2/Project'
import type { UiProjectGroup } from '../types/codex'
export const UNASSIGNED_PROJECT = '__codexapp_unassigned__'
/** Native membership is explicit even for identical roots, moved cwd and empty projects. */
export function groupThreadsByProject(groups: UiProjectGroup[], projects: readonly Project[]): UiProjectGroup[] {
  const native = new Map(projects.map(p => [p.id, { projectName: p.id, threads: [] } as UiProjectGroup]))
  for (const thread of groups.flatMap(g => g.threads)) {
    const id = thread.projectId || UNASSIGNED_PROJECT
    let group = native.get(id)
    if (!group) { group = { projectName: id, threads: [] }; native.set(id, group) }
    group.threads.push({ ...thread, projectName: id })
  }
  return [...native.values()]
}
