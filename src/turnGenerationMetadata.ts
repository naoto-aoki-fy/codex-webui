import type { CollaborationModeKind } from './types/codex'

export type GenerationMetadataSource = 'execution' | 'submitted'

export type TurnGenerationMetadata = {
  model?: string | null
  // null means explicitly unspecified; absent means unknown. "none" is a value.
  effort?: string | null
  modelSource?: GenerationMetadataSource
  effortSource?: GenerationMetadataSource
  collaborationMode?: CollaborationModeKind | null
  collaborationModeSource?: GenerationMetadataSource
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

export function readCollaborationMode(value: unknown): CollaborationModeKind | undefined {
  return value === 'plan' || value === 'default' ? value : undefined
}

export function readGenerationMetadata(value: unknown): TurnGenerationMetadata | undefined {
  const row = record(value)
  if (!row) return undefined
  const model = typeof row.model === 'string' ? row.model.trim() : ''
  const effort = typeof row.effort === 'string' ? row.effort.trim() : row.effort
  const result: TurnGenerationMetadata = {}
  if ((model || row.model === null) && (row.modelSource === 'execution' || row.modelSource === 'submitted')) {
    result.model = row.model === null ? null : model
    result.modelSource = row.modelSource
  }
  if ((effort === null || (typeof effort === 'string' && effort))
    && (row.effortSource === 'execution' || row.effortSource === 'submitted')) {
    result.effort = effort
    result.effortSource = row.effortSource
  }
  const mode = readCollaborationMode(row.collaborationMode)
  if (mode && row.collaborationModeSource === 'submitted') {
    result.collaborationMode = mode
    result.collaborationModeSource = 'submitted'
  } else if ((mode || row.collaborationMode === null) && row.collaborationModeSource === 'execution') {
    result.collaborationMode = mode ?? null
    result.collaborationModeSource = 'execution'
  }
  return Object.keys(result).length ? result : undefined
}

export function generationMetadataLabel(metadata?: TurnGenerationMetadata): string {
  const model = metadata?.model === null ? 'Model unspecified' : metadata?.model ?? 'Model unknown'
  const effort = metadata?.effort === null ? 'unspecified' : metadata?.effort ?? 'unknown'
  return `${model}${metadata?.modelSource === 'submitted' ? ' (sent setting)' : ''} · reasoning: ${effort}${metadata?.effortSource === 'submitted' ? ' (sent setting)' : ''}`
}

// Merge each value with its provenance. Execution always outranks settings.
export function mergeGenerationMetadata(...values: Array<TurnGenerationMetadata | undefined>): TurnGenerationMetadata {
  const result: TurnGenerationMetadata = {}
  for (const value of values) {
    if (!value) continue
    if (value.model !== undefined && (result.modelSource !== 'execution' || value.modelSource === 'execution')) {
      result.model = value.model
      result.modelSource = value.modelSource
    }
    if (value.effort !== undefined && (result.effortSource !== 'execution' || value.effortSource === 'execution')) {
      result.effort = value.effort
      result.effortSource = value.effortSource
    }
    if (value.collaborationMode !== undefined &&
      (result.collaborationModeSource !== 'execution' || value.collaborationModeSource === 'execution')) {
      result.collaborationMode = value.collaborationMode
      result.collaborationModeSource = value.collaborationModeSource
    }
  }
  return result
}
