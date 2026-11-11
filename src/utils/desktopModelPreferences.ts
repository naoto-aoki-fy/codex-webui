export function orderModelIdsByUsage(catalogIds: readonly string[], usageOrder: readonly string[]): string[] {
  const available = new Set(catalogIds)
  const recent = usageOrder.filter((id) => available.has(id))
  const used = new Set(recent)
  return [...recent, ...catalogIds.filter((id) => !used.has(id))]
}

export function buildModelCatalogIds(catalogIds: readonly string[], saved: string, configuredModel: string): string[] {
  const ids = [...catalogIds]
  if (!ids.length) { const fallback = saved || configuredModel.trim(); if (fallback) ids.push(fallback) }
  return ids
}

export function resolveModelPreference(ids: readonly string[], saved: string, configuredModel: string): string {
  return ids.includes(saved) ? saved : ids.includes(configuredModel.trim()) ? configuredModel.trim() : ids[0] ?? ''
}
