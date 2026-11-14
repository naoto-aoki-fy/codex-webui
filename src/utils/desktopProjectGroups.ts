import type { WorkspaceRootsState } from '../api/normalizers/workspaceRoots'
import type { UiProjectGroup } from '../types/codex'
import * as legacy from './legacyDesktopProjectGroups'
export { toProjectNameFromWorkspaceRoot, getRemoteProjectDisplayName } from './legacyDesktopProjectGroups'

export const UNASSIGNED_PROJECT = '__codexapp_unassigned__'
export function getWorkspaceProjectOrderPaths(state: WorkspaceRootsState | null): string[] {
  return state?.nativeProjects ? state.nativeProjects.map(p => p.id) : legacy.getWorkspaceProjectOrderPaths(state)
}
export function getWorkspaceProjectOrderNames(state: WorkspaceRootsState | null, duplicates: Set<string>): string[] {
  return state?.nativeProjects ? state.nativeProjects.map(p => p.id) : legacy.getWorkspaceProjectOrderNames(state, duplicates)
}
export function getWorkspaceProjectId(state: WorkspaceRootsState | null, name: string, groups: UiProjectGroup[]): string {
  return state?.nativeProjects ? state.nativeProjects.find(p => p.id === name)?.id || '' : legacy.getWorkspaceProjectId(state, name, groups)
}
export function collectDuplicateProjectLeafNames(groups: UiProjectGroup[], state: WorkspaceRootsState | null): Set<string> {
  return state?.nativeProjects ? new Set() : legacy.collectDuplicateProjectLeafNames(groups, state)
}
export function collectWorkspaceRootPathsForProjectRemoval(state: WorkspaceRootsState, name: string): Set<string> {
  return state.nativeProjects ? new Set() : legacy.collectWorkspaceRootPathsForProjectRemoval(state, name)
}
/** Native membership is explicit even for identical roots, moved cwd and empty projects. */
export function filterGroupsByWorkspaceRoots(groups: UiProjectGroup[], state: WorkspaceRootsState | null): UiProjectGroup[] {
  if (!state?.nativeProjects) return legacy.filterGroupsByWorkspaceRoots(groups, state)
  const native = new Map(state.nativeProjects.map(p => [p.id, { projectName: p.id, threads: [] } as UiProjectGroup]))
  for (const thread of groups.flatMap(g => g.threads)) {
    const id = thread.projectId || UNASSIGNED_PROJECT
    let group = native.get(id)
    if (!group) { group = { projectName: id, threads: [] }; native.set(id, group) }
    group.threads.push({ ...thread, projectName: id })
  }
  return [...native.values()]
}
