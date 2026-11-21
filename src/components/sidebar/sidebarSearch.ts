import type { Project } from '../../server/protocol/0.167.2/v2/Project'
import type { UiThread } from '../../types/codex'
import type { NewThreadTarget } from '../../router/sidebarRoutes'
import { normalizePathForUi } from '../../pathUtils'
import { folderGroupKey, getFolderName } from './sidebarGroups'
import { compareThreads } from './threadSorting'

export type SidebarSearchScope = 'content' | 'thread-title' | 'project' | 'folder'

export type SidebarSearch = {
  scope: SidebarSearchScope
  query: string
  threads?: readonly UiThread[]
  pending?: string
  error?: string
  canRetry?: boolean
}

type LocationResult = {
  key: string
  name: string
  target: NewThreadTarget
  pathLabel?: string
  idLabel?: string
}

function rankMatches<T>(
  items: Iterable<T>, query: string, name: (item: T) => string, compare: (a: T, b: T) => number,
): T[] {
  const term = query.toLowerCase()
  const matches = []
  for (const item of items) {
    const label = name(item).toLowerCase()
    const index = label.indexOf(term)
    if (index >= 0) matches.push({ item, rank: label === term ? 0 : index === 0 ? 1 : 2 })
  }
  return matches.sort((a, b) => a.rank - b.rank || compare(a.item, b.item)).map(match => match.item)
}

export function findThreadTitles(threads: Iterable<UiThread>, query: string): UiThread[] {
  return rankMatches(threads, query, thread => thread.title, compareThreads('updated'))
}

function rankLocations(rows: Iterable<LocationResult>, query: string): LocationResult[] {
  return rankMatches(rows, query, row => row.name, (a, b) =>
    a.name.localeCompare(b.name) || a.target.cwd.localeCompare(b.target.cwd) || a.key.localeCompare(b.key))
}

export function findProjectNames(
  projects: readonly Project[], query: string, resolveCwd: (projectId: string) => string,
): LocationResult[] {
  const rows = new Map<string, LocationResult>()
  for (const { id, name } of projects) {
    if (rows.has(id)) continue
    const cwd = resolveCwd(id)
    rows.set(id, { key: id, name, target: { projectId: id, cwd }, pathLabel: normalizePathForUi(cwd) })
  }
  const matches = rankLocations(rows.values(), query)
  const labelKey = (row: LocationResult) => JSON.stringify([row.name, row.pathLabel])
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const row of matches) {
    const key = labelKey(row)
    if (seen.has(key)) duplicates.add(key)
    seen.add(key)
  }
  return matches.map(row => ({
    ...row,
    idLabel: duplicates.has(labelKey(row)) ? row.key : undefined,
  }))
}

export function findFolderNames(
  projects: readonly Project[], threads: Iterable<UiThread>, query: string,
): LocationResult[] {
  const rows = new Map<string, LocationResult>()
  function addPath(path: string): void {
    const cwd = normalizePathForUi(path)
    const key = folderGroupKey(cwd)
    if (rows.has(key)) return
    const name = getFolderName(cwd)
    if (name) rows.set(key, { key, name, target: { cwd } })
  }
  for (const project of projects) {
    for (const root of project.roots) addPath(root.path)
  }
  for (const thread of threads) addPath(thread.cwd)

  const matches = rankLocations(rows.values(), query)
  const counts = new Map<string, number>()
  for (const { name } of matches) {
    const label = name.toLowerCase()
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return matches.map(row => ({
    ...row,
    pathLabel: (counts.get(row.name.toLowerCase()) ?? 0) > 1 ? row.target.cwd : undefined,
  }))
}
