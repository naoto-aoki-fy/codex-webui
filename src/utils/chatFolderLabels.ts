import { getPathLeafName, isAbsoluteLikePath, normalizePathForUi } from '../pathUtils'
import type { UiThread } from '../types/codex'
import { UNASSIGNED_PROJECT } from './desktopProjectGroups'

export function getChatFolderName(cwd: string | undefined): string {
  const path = normalizePathForUi(cwd ?? '')
  if (!isAbsoluteLikePath(path)) return ''
  // Backslashes are literal filename characters in POSIX paths.
  if (path.startsWith('/')) return path.replace(/\/+$/u, '').split('/').at(-1) || '/'
  return getPathLeafName(path)
}

export function getThreadContextLabel(
  thread: Pick<UiThread, 'projectId' | 'cwd'> | null,
  projectDisplayNameById: Readonly<Record<string, string>>,
): string {
  if (!thread) return ''
  const projectId = thread.projectId?.trim()
  if (projectId && projectId !== UNASSIGNED_PROJECT) return projectDisplayNameById[projectId] ?? projectId
  return getChatFolderName(thread.cwd) || 'No working directory'
}

export function formatChatPageTitle(threadTitle: string | undefined, contextLabel: string): string {
  const title = threadTitle?.trim()
  if (!title) return 'Codex WebUI'
  return contextLabel ? `${contextLabel} - ${title}` : title
}
