import type { WorkspaceRootsState } from '../api/normalizers/workspaceRoots'
import type { UiProjectGroup } from '../types/codex'
export const UNASSIGNED_PROJECT = '__codexapp_unassigned__'
export function getWorkspaceProjectId(state: WorkspaceRootsState | null, id: string, _groups: UiProjectGroup[]): string {
  return state?.nativeProjects?.find(p => p.id === id)?.id || ''
}
/** Native membership is explicit even for identical roots, moved cwd and empty projects. */
export function filterGroupsByWorkspaceRoots(groups: UiProjectGroup[], state: WorkspaceRootsState | null): UiProjectGroup[] {
  const native = new Map((state?.nativeProjects ?? []).map(p => [p.id, { projectName: p.id, threads: [] } as UiProjectGroup]))
  for (const thread of groups.flatMap(g => g.threads)) {
    const id = thread.projectId || UNASSIGNED_PROJECT
    let group = native.get(id)
    if (!group) { group = { projectName: id, threads: [] }; native.set(id, group) }
    group.threads.push({ ...thread, projectName: id })
  }
  return [...native.values()]
}
