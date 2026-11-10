import { realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { asRecord } from './bridgeHttpUtils.js'
import { readCodexGlobalState, updateCodexGlobalState } from './codexGlobalState.js'
import type { WorkspaceRootsOperation } from '../types/workspaceRoots.js'

export type WorkspaceRootsState = {
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
  if (!isAbsolute(value)) return value
  try {
    return await pathRealpath(value)
  } catch {
    return resolve(value)
  }
}

async function canonicalizeWorkspaceRootPathList(
  values: string[],
  pathRealpath: PathRealpathResolver,
): Promise<string[]> {
  const paths: string[] = []
  for (let offset = 0; offset < values.length; offset += 8) {
    paths.push(...await Promise.all(values.slice(offset, offset + 8).map((value) => canonicalizeWorkspaceRootPath(value, pathRealpath))))
  }
  return normalizeStringArray(paths)
}

export async function canonicalizeWorkspaceRootsState(
  state: WorkspaceRootsState,
  pathRealpath: PathRealpathResolver = realpath,
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
  pathRealpath: PathRealpathResolver = realpath,
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
  pathRealpath: PathRealpathResolver = realpath,
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

function workspaceRootsFromPayload(payload: Record<string, unknown>): WorkspaceRootsState {
  return {
    order: normalizeStringArray(payload['electron-saved-workspace-roots']),
    labels: normalizeStringRecord(payload['electron-workspace-root-labels']),
    active: normalizeStringArray(payload['active-workspace-roots']),
    projectOrder: normalizeStringArray(payload['project-order']),
    remoteProjects: normalizeRemoteProjects(payload['remote-projects']),
  }
}

export async function readWorkspaceRootsState(): Promise<WorkspaceRootsState> {
  return canonicalizeWorkspaceRootsState(workspaceRootsFromPayload(await readCodexGlobalState()))
}

export async function writeWorkspaceRootsState(nextState: WorkspaceRootsState): Promise<void> {
  await updateWorkspaceRootsState(() => nextState)
}

function prependUniqueString(value: string, items: string[]): string[] {
  return [value, ...items.filter((item) => item !== value)]
}

async function updateWorkspaceRootsState(
  updater: (existingState: WorkspaceRootsState) => WorkspaceRootsState | Promise<WorkspaceRootsState>,
): Promise<WorkspaceRootsState> {
  return updateCodexGlobalState(async (payload) => {
    const paths = new Map<string, Promise<string>>()
    const resolvePath = (path: string): Promise<string> => {
      let result = paths.get(path)
      if (!result) {
        result = canonicalizeWorkspaceRootPath(path, realpath).then((canonical) => {
          if (!paths.has(canonical)) paths.set(canonical, Promise.resolve(canonical))
          return canonical
        })
        paths.set(path, result)
      }
      return result
    }
    const current = await canonicalizeWorkspaceRootsState(workspaceRootsFromPayload(payload), resolvePath)
    const state = await canonicalizeWorkspaceRootsState(await updater(current), resolvePath)
    if (isDeepStrictEqual(current, state)) return state
    payload['electron-saved-workspace-roots'] = state.order
    payload['electron-workspace-root-labels'] = state.labels
    payload['active-workspace-roots'] = state.active
    payload['project-order'] = state.projectOrder
    // Preserve remote records, including fields unknown to this version.
    return state
  })
}

export async function applyWorkspaceRootsOperation(operation: WorkspaceRootsOperation): Promise<WorkspaceRootsState> {
  // Resolve only the requested identifiers here; read all saved values under the lock.
  const normalizedOperation: WorkspaceRootsOperation = operation.type === 'reorder'
    ? { type: 'reorder', order: await canonicalizeWorkspaceRootPathList(operation.order, realpath) }
    : { ...operation, path: await canonicalizeWorkspaceRootPath(operation.path, realpath) }
  return updateWorkspaceRootsState((state) => {
    if (normalizedOperation.type === 'rename') {
      if (!state.order.includes(normalizedOperation.path)) return state
      const labels = { ...state.labels }
      const label = normalizedOperation.label.trim()
      if (label) labels[normalizedOperation.path] = label
      else delete labels[normalizedOperation.path]
      return { ...state, labels }
    }
    if (normalizedOperation.type === 'delete') {
      const path = normalizedOperation.path
      const order = state.order.filter((item) => item !== path)
      const labels = { ...state.labels }
      delete labels[path]
      const active = state.active.filter((item) => item !== path)
      if (active.length === 0 && order.length > 0) active.push(order[0])
      return { ...state, order, labels, active, projectOrder: state.projectOrder.filter((item) => item !== path) }
    }
    const existing = new Set([...state.order, ...state.remoteProjects.map((project) => project.id)])
    const currentOrder = normalizeStringArray([...state.projectOrder, ...existing]).filter((item) => existing.has(item))
    const requested = new Set(normalizedOperation.order.filter((item) => existing.has(item)))
    const projectOrder = [...requested, ...currentOrder.filter((item) => !requested.has(item))]
    const localRoots = new Set(state.order)
    return { ...state, projectOrder, order: projectOrder.filter((item) => localRoots.has(item)) }
  })
}

export async function persistWorkspaceRoot(workspaceRoot: string, label = ''): Promise<void> {
  const trimmedRoot = workspaceRoot.trim()
  if (!trimmedRoot) return
  const normalizedRoot = await canonicalizeWorkspaceRootPath(trimmedRoot, realpath)

  await updateWorkspaceRootsState((existingState) => {
    const nextLabels = { ...existingState.labels }
    const trimmedLabel = label.trim()
    if (trimmedLabel.length > 0) {
      nextLabels[normalizedRoot] = trimmedLabel
    }
    return {
      order: prependUniqueString(normalizedRoot, existingState.order),
      labels: nextLabels,
      active: prependUniqueString(normalizedRoot, existingState.active),
      projectOrder: prependUniqueString(normalizedRoot, existingState.projectOrder),
      remoteProjects: existingState.remoteProjects,
    }
  })
}

