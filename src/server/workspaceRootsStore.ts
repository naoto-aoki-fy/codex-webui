// Legacy workspace fields are read-only migration input. Native Projects belong to the App Server.
const preserveRemotePath = async (path: string) => path
import { projectPath } from './appServerFileSystem.js'
import { asRecord } from './bridgeHttpUtils.js'
import { readCodexGlobalState } from './codexGlobalState.js'

export type WorkspaceRootsState = {
  projectMode?: 'native' | 'legacy-readonly'
  projectError?: string
  nativeProjects?: import('../server/protocol/0.167.2/v2/Project.js').Project[]
  order: string[]
  labels: Record<string, string>
  active: string[]
  projectOrder: string[]
  remoteProjects: Array<{
    id: string
    hostId: string
    remotePath: string
    label: string
  }>
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const normalized: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.length > 0 && !normalized.includes(item)) {
      normalized.push(item)
    }
  }
  return normalized
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const next: Record<string, string> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key === 'string' && key.length > 0 && typeof item === 'string') {
      next[key] = item
    }
  }
  return next
}

function normalizeRemoteProjects(value: unknown): WorkspaceRootsState['remoteProjects'] {
  if (!Array.isArray(value)) return []
  const next: WorkspaceRootsState['remoteProjects'] = []
  const seen = new Set<string>()
  for (const item of value) {
    const record = asRecord(item)
    if (!record) continue
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    next.push({
      id,
      hostId: typeof record.hostId === 'string' ? record.hostId.trim() : '',
      remotePath: typeof record.remotePath === 'string' ? record.remotePath.trim() : '',
      label: typeof record.label === 'string' ? record.label.trim() : '',
    })
  }
  return next
}

type PathRealpathResolver = (path: string) => Promise<string>

async function canonicalizeWorkspaceRootPath(
  value: string,
  pathRealpath: PathRealpathResolver,
): Promise<string> {
  if (!projectPath(value).isAbsolute(value)) return value
  try {
    return await pathRealpath(value)
  } catch {
    return value
  }
}

export async function canonicalizeWorkspaceRootsState(
  state: WorkspaceRootsState,
  pathRealpath: PathRealpathResolver = preserveRemotePath,
): Promise<WorkspaceRootsState> {
  const paths = [...new Set([...state.order, ...state.active, ...state.projectOrder, ...Object.keys(state.labels)])]
  const canonicalPaths = new Map<string, string>()
  let nextPathIndex = 0
  await Promise.all(Array.from({ length: Math.min(8, paths.length) }, async () => {
    while (nextPathIndex < paths.length) {
      const path = paths[nextPathIndex++]
      canonicalPaths.set(path, await canonicalizeWorkspaceRootPath(path, pathRealpath))
    }
  }))
  const canonicalPath = (path: string): string => canonicalPaths.get(path) ?? path
  const order = normalizeStringArray(state.order.map(canonicalPath))
  const active = normalizeStringArray(state.active.map(canonicalPath))
  const projectOrder = normalizeStringArray(state.projectOrder.map(canonicalPath))
  const labelEntries = Object.entries(state.labels)
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, label]) => ({ canonicalKey: canonicalPath(key), label, isCanonicalSource: canonicalPath(key) === key }))
  const labels: Record<string, string> = {}
  const labelSourceByCanonicalKey = new Map<string, { isCanonicalSource: boolean }>()
  for (const entry of labelEntries) {
    const existing = labelSourceByCanonicalKey.get(entry.canonicalKey)
    if (existing?.isCanonicalSource === true && !entry.isCanonicalSource) continue
    if (existing && existing.isCanonicalSource === entry.isCanonicalSource) continue
    labels[entry.canonicalKey] = entry.label
    labelSourceByCanonicalKey.set(entry.canonicalKey, {
      isCanonicalSource: entry.isCanonicalSource,
    })
  }

  return {
    order,
    labels,
    active,
    projectOrder,
    remoteProjects: state.remoteProjects.map((project) => ({ ...project })),
  }
}

export async function canonicalizeWorkspaceRootsStateForRead(
  state: WorkspaceRootsState,
  pathRealpath: PathRealpathResolver = preserveRemotePath,
): Promise<WorkspaceRootsState> {
  return await canonicalizeWorkspaceRootsState(state, pathRealpath)
}

async function canonicalizeThreadCwdRecord(
  value: unknown,
  canonicalizeCwd: (cwd: string) => Promise<string>,
): Promise<unknown> {
  const record = asRecord(value)
  const cwd = typeof record?.cwd === 'string' ? record.cwd : ''
  if (!record || !cwd) return value
  const canonicalCwd = await canonicalizeCwd(cwd)
  return canonicalCwd === cwd ? value : { ...record, cwd: canonicalCwd }
}

export async function canonicalizeThreadListResponseForRead(
  payload: unknown,
  pathRealpath: PathRealpathResolver = preserveRemotePath,
): Promise<unknown> {
  const record = asRecord(payload)
  if (!record || !Array.isArray(record.data)) return payload
  const cwdCanonicalizationByValue = new Map<string, Promise<string>>()
  const canonicalizeCwd = (cwd: string): Promise<string> => {
    let canonicalized = cwdCanonicalizationByValue.get(cwd)
    if (!canonicalized) {
      canonicalized = canonicalizeWorkspaceRootPath(cwd, pathRealpath)
      cwdCanonicalizationByValue.set(cwd, canonicalized)
    }
    return canonicalized
  }
  return {
    ...record,
    data: await Promise.all(record.data.map((item) => canonicalizeThreadCwdRecord(item, canonicalizeCwd))),
  }
}

export function workspaceRootsFromPayload(payload: Record<string, unknown>): WorkspaceRootsState {
  return {
    order: normalizeStringArray(payload['electron-saved-workspace-roots']),
    labels: normalizeStringRecord(payload['electron-workspace-root-labels']),
    active: normalizeStringArray(payload['active-workspace-roots']),
    projectOrder: normalizeStringArray(payload['project-order']),
    remoteProjects: normalizeRemoteProjects(payload['remote-projects']),
  }
}

export async function readWorkspaceRootsState(): Promise<WorkspaceRootsState> {
  return workspaceRootsFromPayload(await readCodexGlobalState())
}

