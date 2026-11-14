import { normalizePathForUi } from '../../pathUtils.js'

export type WorkspaceRootsState = {
  projectMode?: 'native' | 'legacy-readonly'
  projectError?: string
  nativeProjects?: import('../../server/protocol/0.167.2/v2/Project.js').Project[]
  order: string[]
  labels: Record<string, string>
  active: string[]
  projectOrder: string[]
  remoteProjects?: Array<{
    id: string
    hostId: string
    remotePath: string
    label: string
  }>
}

export function normalizeWorkspaceRootsState(payload: unknown): WorkspaceRootsState {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {}

  const normalizeArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []
    const next: string[] = []
    for (const item of value) {
      if (typeof item === 'string' && item.length > 0 && !next.includes(item)) {
        next.push(item)
      }
    }
    return next
  }

  const labelsRaw = record.labels
  const labels: Record<string, string> = {}
  if (labelsRaw && typeof labelsRaw === 'object' && !Array.isArray(labelsRaw)) {
    for (const [key, value] of Object.entries(labelsRaw as Record<string, unknown>)) {
      const normalizedKey = typeof key === 'string' ? normalizePathForUi(key) : ''
      if (normalizedKey.length > 0 && typeof value === 'string') {
        labels[normalizedKey] = value
      }
    }
  }

  return {
    ...(record.projectMode === 'native' || record.projectMode === 'legacy-readonly' ? { projectMode: record.projectMode } : {}),
    ...(typeof record.projectError === 'string' ? { projectError: record.projectError } : {}),
    ...(Array.isArray(record.nativeProjects) ? { nativeProjects: record.nativeProjects as NonNullable<WorkspaceRootsState['nativeProjects']> } : {}),
    order: normalizeArray(record.order).map((value) => normalizePathForUi(value)),
    labels,
    active: normalizeArray(record.active).map((value) => normalizePathForUi(value)),
    projectOrder: normalizeArray(record.projectOrder).map((value) => normalizePathForUi(value)),
    remoteProjects: Array.isArray(record.remoteProjects)
      ? record.remoteProjects.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return []
        const remote = item as Record<string, unknown>
        const id = typeof remote.id === 'string' ? remote.id.trim() : ''
        if (!id) return []
        return [{
          id,
          hostId: typeof remote.hostId === 'string' ? remote.hostId.trim() : '',
          remotePath: typeof remote.remotePath === 'string' ? normalizePathForUi(remote.remotePath) : '',
          label: typeof remote.label === 'string' ? remote.label.trim() : '',
        }]
      })
      : [],
  }
}

export function cloneWorkspaceRootsState(state: WorkspaceRootsState): WorkspaceRootsState {
  return {
    ...(state.projectMode ? { projectMode: state.projectMode } : {}),
    ...(state.projectError ? { projectError: state.projectError } : {}),
    nativeProjects: state.nativeProjects?.map(p => ({ ...p, roots: p.roots.map(r => ({ ...r })), metadata: { ...p.metadata } })),
    order: [...state.order],
    labels: { ...state.labels },
    active: [...state.active],
    projectOrder: [...state.projectOrder],
    remoteProjects: state.remoteProjects?.map((item) => ({ ...item })) ?? [],
  }
}

