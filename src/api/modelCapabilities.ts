import type { ReasoningEffort } from './appServerDtos'

export type ReasoningModel = {
  modelProvider?: string
  providerDisplayName?: string
  displayName?: string
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
  const selection = parseModelSelection(model)
  return catalog.find((entry) => (entry.modelProvider || '') === selection.provider && (entry.id?.trim() === selection.model || entry.model?.trim() === selection.model)) ?? null
}

// Versioned, unambiguous identity; legacy bare IDs continue to mean the legacy catalog.
export function modelSelectionKey(provider: string, model: string): string {
  return provider ? `provider-model:${JSON.stringify([provider, model])}` : model
}

export function parseModelSelection(value: string): { provider: string; model: string } {
  if (value.startsWith('provider-model:')) {
    try {
      const pair: unknown = JSON.parse(value.slice('provider-model:'.length))
      if (Array.isArray(pair) && pair.length === 2 && pair.every((part) => typeof part === 'string')) {
        return { provider: pair[0], model: pair[1] }
      }
    } catch { /* Interpret malformed legacy values as bare model IDs. */ }
  }
  return { provider: '', model: value }
}
