import type { ThreadReadResponse } from '../appServerDtos'

// Response metadata differs from v2 message normalization: IDs/cwd are not
// trimmed, the model is read only at the top level, and lookup keys preserve
// raw turn IDs (v2 trims message turn IDs). Keep these contracts separate.
export type ThreadTurnIndexById = Record<string, number>

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function buildTurnIndexByTurnId(payload: ThreadReadResponse, baseTurnIndex = 0): ThreadTurnIndexById {
  const turns = Array.isArray(payload.thread.turns) ? payload.thread.turns : []
  const lookup: ThreadTurnIndexById = {}

  for (let turnOffset = 0; turnOffset < turns.length; turnOffset += 1) {
    const turnIndex = baseTurnIndex + turnOffset
    const turn = turns[turnOffset]
    if (typeof turn?.id !== 'string' || turn.id.length === 0) continue
    lookup[turn.id] = turnIndex
  }

  return lookup
}

export function readThreadTurnStartIndex(payload: ThreadReadResponse): number {
  const record = asRecord(payload)
  const raw = record?.threadTurnStartIndex
  return Math.max(0, Math.floor(typeof raw === 'number' ? raw : 0))
}

export function normalizeThreadIdFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>

  const thread = record.thread
  if (thread && typeof thread === 'object') {
    const threadId = (thread as Record<string, unknown>).id
    if (typeof threadId === 'string' && threadId.length > 0) {
      return threadId
    }
  }
  return ''
}

export function normalizeThreadCwdFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>

  const thread = record.thread
  if (thread && typeof thread === 'object') {
    const cwd = (thread as Record<string, unknown>).cwd
    if (typeof cwd === 'string' && cwd.length > 0) {
      return cwd
    }
  }
  return ''
}

export function normalizeThreadModelFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const model = (payload as Record<string, unknown>).model
  return typeof model === 'string' ? model.trim() : ''
}

export function normalizeThreadModelProviderFromPayload(payload: unknown): string {
  const record = asRecord(payload)
  if (!record) return ''
  const modelProvider = readString(record.modelProvider)?.trim() ?? ''
  if (modelProvider) return modelProvider
  const thread = asRecord(record.thread)
  return readString(thread?.modelProvider)?.trim()
    || readString(record.model_provider)?.trim()
    || readString(thread?.model_provider)?.trim()
    || ''
}

