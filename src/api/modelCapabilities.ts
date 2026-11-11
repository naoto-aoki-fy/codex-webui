import type { ReasoningEffort } from './appServerDtos'

export type ReasoningModel = {
  id?: string
  model?: string
  supportedReasoningEfforts?: Array<string | { reasoningEffort: string; description?: string }>
  defaultReasoningEffort?: string
}

export function normalizeReasoningEffort(value: unknown): ReasoningEffort | '' {
  return typeof value === 'string' ? value.trim() as ReasoningEffort | '' : ''
}

export function reasoningOptions(model: ReasoningModel | null): Array<{ value: ReasoningEffort; label: string; description: string }> {
  const options: Array<{ value: ReasoningEffort; label: string; description: string }> = []
  if (!Array.isArray(model?.supportedReasoningEfforts)) return options
  for (const entry of model.supportedReasoningEfforts) {
    const value = normalizeReasoningEffort(typeof entry === 'string' ? entry : entry?.reasoningEffort)
    if (!value || options.some((option) => option.value === value)) continue
    options.push({ value, label: value === 'xhigh' ? 'Extra high' : value.charAt(0).toUpperCase() + value.slice(1),
      description: typeof entry === 'object' && typeof entry?.description === 'string' ? entry.description : '' })
  }
  return options
}

export function resolveReasoningEffort(model: ReasoningModel | null, requested?: string): ReasoningEffort | '' {
  const options = reasoningOptions(model)
  const selected = options.find((option) => option.value === requested)
  if (selected) return selected.value
  return options.find((option) => option.value === model?.defaultReasoningEffort)?.value ?? options[0]?.value ?? ''
}

export function findReasoningModel(catalog: ReasoningModel[], model: string): ReasoningModel | null {
  return catalog.find((entry) => entry.id === model || entry.model === model) ?? null
}
