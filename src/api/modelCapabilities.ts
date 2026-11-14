import type { ReasoningEffort } from './appServerDtos'

export type ReasoningModel = {
  modelProvider?: string
  providerDefaultModel?: string
  isDefault?: boolean
  providerDisplayName?: string
  description?: string
  visibility?: string
  hidden?: boolean
  priority?: number
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
  const matchesId = (entry: ReasoningModel) => entry.id?.trim() === selection.model || entry.model?.trim() === selection.model
  const exact = catalog.find(entry => (entry.modelProvider?.trim() || '') === selection.provider && matchesId(entry))
  if (exact) return exact
  // Legacy single-provider catalogs have no qualified capability keys. This
  // fallback resolves capabilities only; it does not authorize provider changes.
  if (catalog.some(entry => entry.modelProvider?.trim())) return null
  let legacy: ReasoningModel | null = null
  for (const entry of catalog) {
    if (!matchesId(entry)) continue
    if (legacy) return null
    legacy = entry
  }
  return legacy
}

// Versioned, unambiguous identity; legacy bare IDs continue to mean the legacy catalog.
export function modelSelectionKey(provider: string, model: string): string {
  provider = provider.trim()
  model = model.trim()
  return provider ? `provider-model:${JSON.stringify([provider, model])}` : model
}

export function parseModelSelection(value: string): { provider: string; model: string } {
  if (value.startsWith('provider-model:')) {
    try {
      const pair: unknown = JSON.parse(value.slice('provider-model:'.length))
      if (Array.isArray(pair) && pair.length === 2 && pair.every((part) => typeof part === 'string')) {
        return { provider: pair[0].trim(), model: pair[1].trim() }
      }
    } catch { /* Interpret malformed legacy values as bare model IDs. */ }
  }
  return { provider: '', model: value.trim() }
}

// Provider defaults must never come from a source thread or model usage order.
export function defaultModelForProvider(catalog: ReasoningModel[], provider: string): string {
  const entries = catalog.filter(entry => entry.modelProvider === provider)
  const configured = entries.find(entry => entry.providerDefaultModel?.trim())?.providerDefaultModel?.trim()
  if (configured) return configured
  const visible = entries.filter(entry => !entry.hidden)
  const declared = visible.find(entry => entry.isDefault)
  const preferred = declared || [...visible].sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER))[0]
  return preferred?.id?.trim() || preferred?.model?.trim() || ''
}

export function providerModelOptions(ids: string[], provider: string, catalog: ReasoningModel[]): Array<{ value: string; label: string }> {
  const legacy = !catalog.some(entry => entry.modelProvider)
  return ids.filter(id => {
    const selection = parseModelSelection(id)
    return selection.provider === provider || (legacy && !selection.provider)
  }).map(id => {
    const entry = findReasoningModel(catalog, id)
    let label = entry?.displayName || parseModelSelection(id).model
    if (entry?.displayName) for (const name of [entry.providerDisplayName, entry.modelProvider]) {
      if (!name) continue
      for (const separator of [' / ', ' — ', ': ']) if (label.startsWith(name + separator)) label = label.slice(name.length + separator.length)
    }
    return { value: id, label }
  })
}
