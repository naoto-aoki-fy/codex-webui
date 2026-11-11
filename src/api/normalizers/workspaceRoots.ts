import { normalizePathForUi } from '../../pathUtils.js'

export type WorkspaceRootsState = {
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
    order: [...state.order],
    labels: { ...state.labels },
    active: [...state.active],
    projectOrder: [...state.projectOrder],
    remoteProjects: state.remoteProjects?.map((item) => ({ ...item })) ?? [],
  }
}

