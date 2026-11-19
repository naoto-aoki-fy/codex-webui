import { storageNames } from './webuiStorage.mjs'
import { join } from 'node:path'
import { profileStorageDirectory } from './connectionProfile.js'
import { readCodexGlobalState, updateCodexGlobalState } from './codexGlobalState.js'
import { emptyModelPreferences, preferenceModelKey, type ModelPreferences, type ModelSettings } from '../modelPreferences.js'

export function modelPreferencesPath(): string {
  return join(profileStorageDirectory('data'), storageNames.modelPreferences)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function id(value: unknown): value is string { return typeof value === 'string' && !!value.trim() && value.length <= 1024 }
const efforts = new Set(['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
function settings(value: unknown): ModelSettings {
  const v = record(value)
  if (!id(v.providerId) || !id(v.modelId) || !efforts.has(v.reasoningEffort as string)
    || !['default', 'plan'].includes(v.collaborationMode as string)) throw new Error('Invalid model preference settings')
  return { providerId: v.providerId.trim(), modelId: v.modelId.trim(), reasoningEffort: v.reasoningEffort as string, collaborationMode: v.collaborationMode as ModelSettings['collaborationMode'] }
}

function decode(raw: Record<string, unknown>): ModelPreferences {
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) throw new Error('Unsupported model preferences schema; stored data was preserved')
  const state = emptyModelPreferences()
  if (raw.schemaVersion !== 1) return state
  state.revision = Number.isSafeInteger(raw.revision) && Number(raw.revision) >= 0 ? Number(raw.revision) : 0
  for (const key of ['preferred', 'lastUsed'] as const) {
    try { if (raw[key]) state[key] = settings(raw[key]) } catch { /* Ignore malformed fields. */ }
  }
  for (const [key, effort] of Object.entries(record(raw.reasoningByModel))) {
    try {
      const pair: unknown = JSON.parse(key)
      if (Array.isArray(pair) && pair.length === 2 && pair.every(id) && efforts.has(effort as string)) state.reasoningByModel[key] = effort as string
    } catch { /* Ignore malformed keys. */ }
  }
  for (const value of Object.values(record(raw.modelUsage))) {
    const v = record(value)
    if (id(v.providerId) && id(v.modelId) && typeof v.lastUsedAt === 'string' && Number.isFinite(Date.parse(v.lastUsedAt))
      && Number.isSafeInteger(v.usageCount) && Number(v.usageCount) >= 0) {
      state.modelUsage[preferenceModelKey(v.providerId, v.modelId)] = {
        providerId: v.providerId, modelId: v.modelId, lastUsedAt: new Date(v.lastUsedAt).toISOString(), usageCount: Number(v.usageCount),
      }
    }
  }
  return state
}

export class ModelPreferencesStore {
  constructor(private readonly path: () => string = modelPreferencesPath) {}

  async read(): Promise<ModelPreferences> { return decode(await readCodexGlobalState(this.path(), true)) }

  private async mutate(change: (state: ModelPreferences, raw: Record<string, unknown>) => boolean): Promise<ModelPreferences> {
    return updateCodexGlobalState(raw => {
      const state = decode(raw)
      if (!change(state, raw)) return state
      state.revision++
      Object.assign(raw, state)
      return state
    }, this.path(), true)
  }

  async update(payload: unknown): Promise<ModelPreferences> {
    const p = record(payload)
    // Patch individual fields under the lock, never replace a client's stale snapshot.
    const preferred = p.preferred === undefined ? undefined : settings(p.preferred)
    const reasoning = p.reasoning === undefined ? undefined : record(p.reasoning)
    if (reasoning && (!id(reasoning.providerId) || !id(reasoning.modelId) || !efforts.has(reasoning.effort as string))) throw new Error('Invalid reasoning preference')
    return this.mutate(state => {
      if (preferred) state.preferred = preferred
      if (reasoning) state.reasoningByModel[preferenceModelKey(reasoning.providerId as string, reasoning.modelId as string)] = reasoning.effort as string
      return true
    })
  }

  async recordUsage(value: ModelSettings, threadId: string, turnId: string): Promise<ModelPreferences> {
    const used = settings(value)
    if (!id(threadId) || !id(turnId)) throw new Error('Accepted turn identity is required')
    return this.mutate((state, raw) => {
      const accepted = Array.isArray(raw.recentAcceptedTurns) ? raw.recentAcceptedTurns.filter(id).slice(-255) : []
      const turnKey = JSON.stringify([threadId, turnId])
      if (accepted.includes(turnKey)) return false
      raw.recentAcceptedTurns = [...accepted, turnKey]
      const key = preferenceModelKey(used.providerId, used.modelId)
      const previous = state.modelUsage[key]
      state.modelUsage[key] = { providerId: used.providerId, modelId: used.modelId, lastUsedAt: new Date().toISOString(), usageCount: (previous?.usageCount ?? 0) + 1 }
      state.lastUsed = used
      state.preferred = used
      state.reasoningByModel[key] = used.reasoningEffort
      return true
    })
  }
}
