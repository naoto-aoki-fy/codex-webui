import { normalizePathForUi } from '../../pathUtils.js'

export type WorkspaceRootsState = {
  projectMode?: 'native'
  projectError?: string
  nativeProjects?: import('../../server/protocol/0.167.2/v2/Project.js').Project[]
  order: string[]
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

  return {
    ...(record.projectMode === 'native' ? { projectMode: record.projectMode } : {}),
    ...(typeof record.projectError === 'string' ? { projectError: record.projectError } : {}),
    ...(Array.isArray(record.nativeProjects) ? { nativeProjects: record.nativeProjects as NonNullable<WorkspaceRootsState['nativeProjects']> } : {}),
    order: normalizeArray(record.order).map((value) => normalizePathForUi(value)),
  }
}

export function cloneWorkspaceRootsState(state: WorkspaceRootsState): WorkspaceRootsState {
  return {
    ...(state.projectMode ? { projectMode: state.projectMode } : {}),
    ...(state.projectError ? { projectError: state.projectError } : {}),
    nativeProjects: state.nativeProjects?.map(p => ({ ...p, roots: p.roots.map(r => ({ ...r })), metadata: { ...p.metadata } })),
    order: [...state.order],
  }
}

