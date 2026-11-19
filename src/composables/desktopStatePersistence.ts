import { readPreferenceRecords, savePreferenceRecords } from '../utils/browserPreferenceRecords'
import { profileStorageKey } from '../utils/browserConnectionProfile'
import type { CollaborationModeKind, UiThreadTokenUsage } from '../types/codex'

export const NEW_THREAD_COLLABORATION_MODE_CONTEXT = '__new-thread__'
export const NEW_THREAD_MODEL_CONTEXT = '__new-thread-provider__::codex'

function normalizeCollaborationMode(value: unknown): CollaborationModeKind {
  return value === 'plan' ? 'plan' : 'default'
}

export function normalizeStoredModelId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function createStringKeyedRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}

export function cloneStringKeyedRecord<T>(record: Record<string, T>): Record<string, T> {
  const next = createStringKeyedRecord<T>()
  for (const [key, value] of Object.entries(record)) {
    next[key] = value
  }
  return next
}

export function omitStringKeyedRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = createStringKeyedRecord<T>()
  for (const [entryKey, value] of Object.entries(record)) {
    if (entryKey !== key) {
      next[entryKey] = value
    }
  }
  return next
}

export function pruneThreadContextStateMap<T>(
  stateMap: Record<string, T>,
  threadIds: Set<string>,
): Record<string, T> {
  let changed = false
  const next = createStringKeyedRecord<T>()
  for (const [contextId, value] of Object.entries(stateMap)) {
    if (
      contextId === NEW_THREAD_COLLABORATION_MODE_CONTEXT
      || contextId.startsWith('__new-thread-provider__::') // Preserve new-thread preferences independently of thread pruning.
      || threadIds.has(contextId)
    ) {
      next[contextId] = value
      continue
    }
    changed = true
  }
  return changed ? next : stateMap
}

export function isNewThreadContextId(contextId: string): boolean {
  return contextId === NEW_THREAD_COLLABORATION_MODE_CONTEXT
}

export function toThreadContextId(threadId: string): string {
  const normalizedThreadId = threadId.trim()
  return normalizedThreadId || NEW_THREAD_COLLABORATION_MODE_CONTEXT
}

export function loadSelectedModelMap(): Record<string, string> {
  return readPreferenceRecords(profileStorageKey('codex-web-local.selected-model-by-context.v2'))
}

export function readSelectedModel(
  state: Record<string, string>,
  threadId: string,
): string {
  const contextId = toThreadContextId(threadId)
  const contextModelId = normalizeStoredModelId(state[contextId])
  if (contextModelId) return contextModelId
  return normalizeStoredModelId(state[NEW_THREAD_COLLABORATION_MODE_CONTEXT])
}

export function saveSelectedModelMap(state: Record<string, string>, previous: Record<string, string> = {}): void {
  savePreferenceRecords(profileStorageKey('codex-web-local.selected-model-by-context.v2'), state, previous)
}

export function loadSelectedCollaborationModeMap(): Record<string, CollaborationModeKind> {
  const values = readPreferenceRecords(profileStorageKey('codex-web-local.collaboration-mode-by-context.v2'))
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value === 'plan')) as Record<string, CollaborationModeKind>
}

export function readSelectedCollaborationMode(
  state: Record<string, CollaborationModeKind>,
  threadId: string,
): CollaborationModeKind {
  const contextId = toThreadContextId(threadId)
  return normalizeCollaborationMode(state[contextId])
}

export function writeSelectedCollaborationModeForContext(
  state: Record<string, CollaborationModeKind>,
  threadId: string,
  mode: CollaborationModeKind,
): Record<string, CollaborationModeKind> {
  const contextId = toThreadContextId(threadId)
  if (mode === 'plan') {
    const next = cloneStringKeyedRecord(state)
    next[contextId] = 'plan'
    return next
  }
  return omitStringKeyedRecordKey(state, contextId)
}

export function saveSelectedCollaborationModeMap(state: Record<string, CollaborationModeKind>, previous: Record<string, CollaborationModeKind> = {}): void {
  savePreferenceRecords(profileStorageKey('codex-web-local.collaboration-mode-by-context.v2'), state, previous)
}

export function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(Math.max(value, minValue), maxValue)
}

export function normalizeStoredTokenCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value))
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.trunc(parsed))
    }
  }

  return null
}

export function normalizeTokenUsageBreakdown(value: unknown): UiThreadTokenUsage['last'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  return {
    totalTokens: normalizeStoredTokenCount(record.totalTokens) ?? 0,
    inputTokens: normalizeStoredTokenCount(record.inputTokens) ?? 0,
    cachedInputTokens: normalizeStoredTokenCount(record.cachedInputTokens) ?? 0,
    outputTokens: normalizeStoredTokenCount(record.outputTokens) ?? 0,
    reasoningOutputTokens: normalizeStoredTokenCount(record.reasoningOutputTokens) ?? 0,
  }
}

export function normalizeThreadTokenUsage(value: unknown): UiThreadTokenUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  const total = normalizeTokenUsageBreakdown(record.total)
  const last = normalizeTokenUsageBreakdown(record.last)
  if (!total || !last) return null

  const modelContextWindow = normalizeStoredTokenCount(record.modelContextWindow)
  const currentContextTokens = last.totalTokens
  const remainingContextTokens = typeof modelContextWindow === 'number'
    ? Math.max(modelContextWindow - currentContextTokens, 0)
    : null
  const remainingContextPercent = typeof modelContextWindow === 'number' && modelContextWindow > 0
    ? clamp(Math.round((remainingContextTokens ?? 0) / modelContextWindow * 100), 0, 100)
    : null

  return {
    total,
    last,
    modelContextWindow,
    currentContextTokens,
    remainingContextTokens,
    remainingContextPercent,
  }
}

