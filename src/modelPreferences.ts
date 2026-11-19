/** Current composer preferences only. Never use these as historical execution evidence. */
export type ModelSettings = {
  providerId: string
  modelId: string
  reasoningEffort: string
  collaborationMode: 'default' | 'plan'
}

export type ModelPreferences = {
  schemaVersion: 1
  connectionProfile?: string
  revision: number
  preferred: ModelSettings | null
  lastUsed: ModelSettings | null
  reasoningByModel: Record<string, string>
  modelUsage: Record<string, { providerId: string; modelId: string; lastUsedAt: string; usageCount: number }>
}

// Tuple encoding avoids collisions even when IDs contain slashes.
export const preferenceModelKey = (providerId: string, modelId: string): string => JSON.stringify([providerId, modelId])

export function emptyModelPreferences(): ModelPreferences {
  return { schemaVersion: 1, revision: 0, preferred: null, lastUsed: null, reasoningByModel: {}, modelUsage: {} }
}

export type ModelPreferenceUpdate = {
  preferred?: ModelSettings
  reasoning?: { providerId: string; modelId: string; effort: string }
}
