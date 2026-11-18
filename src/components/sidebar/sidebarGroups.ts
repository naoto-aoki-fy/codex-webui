import type { UiProjectGroup, UiThread } from '../../types/codex'
import { getPathLeafName, normalizePathForComparison, normalizePathForUi } from '../../pathUtils'

export type ThreadViewMode = 'project' | 'folder' | 'chronological'

export function parseThreadViewMode(value: string | null): ThreadViewMode {
  return value === 'folder' || value === 'chronological' ? value : 'project'
}

export type FolderGroup = {
  kind: 'folder'
  key: string
  cwd: string
  name: string
  threads: UiThread[]
}

export type SidebarGroup = FolderGroup | {
  kind: 'project'
  key: string
  projectId: string
  threads: UiThread[]
}

export const projectGroupKey = (projectId: string): string => `project:${projectId}`

export function toSidebarProjectGroups(groups: UiProjectGroup[]): SidebarGroup[] {
  return groups.map(({ projectName, threads }) => ({
    kind: 'project', key: projectGroupKey(projectName), projectId: projectName, threads,
  }))
}

function isWindowsCwd(cwd: string): boolean {
  return /^[a-z]:[\\/]/iu.test(cwd) || cwd.startsWith('\\\\')
}

export function folderGroupKey(value: string | undefined): string {
  const cwd = normalizePathForUi(value ?? '')
  const path = isWindowsCwd(cwd)
    ? (cwd.startsWith('\\\\') ? '/' : '') + normalizePathForComparison(cwd).toLowerCase()
    : cwd.replace(/\/{2,}/gu, '/')
  // Preserve roots, including the distinction between a drive root and a drive-relative path.
  const normalized = /^(?:\/|[a-z]:\/)$/iu.test(path) ? path : path.replace(/\/+$/u, '')
  return `folder:${normalized}`
}

export function groupThreadsByFolder(groups: UiProjectGroup[]): FolderGroup[] {
  const folders = new Map<string, FolderGroup>()
  for (const { threads } of groups) {
    for (const thread of threads) {
      const key = folderGroupKey(thread.cwd)
      let folder = folders.get(key)
      if (!folder) {
        const cwd = normalizePathForUi(thread.cwd ?? '')
        const name = isWindowsCwd(cwd) ? getPathLeafName(cwd) : cwd.replace(/\/+$/u, '').split('/').at(-1)
        folder = { kind: 'folder', key, cwd, name: name || cwd || 'No working directory', threads: [] }
        folders.set(key, folder)
      }
      folder.threads.push(thread)
    }
  }
  return [...folders.values()]
}
