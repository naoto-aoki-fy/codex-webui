export type GenerationMetadataSource = 'execution' | 'submitted'

export type TurnGenerationMetadata = {
  model?: string | null
  // null means explicitly unspecified; absent means unknown. "none" is a value.
  effort?: string | null
  modelSource?: GenerationMetadataSource
  effortSource?: GenerationMetadataSource
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
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
  for (const value of values) for (const field of ['model', 'effort'] as const) {
    const source = field === 'model' ? 'modelSource' : 'effortSource'
    if (value?.[field] === undefined || (result[source] === 'execution' && value[source] !== 'execution')) continue
    result[field] = value[field]
    result[source] = value[source]
  }
  return result
}
