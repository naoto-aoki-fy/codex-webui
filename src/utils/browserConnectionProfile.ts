let profile: string | undefined

export function setInitialConnectionProfile(id: string): void {
  profile = id
}

export function profileStorageKey(key: string): string {
  if (!profile) return `codex-unbound.${key}`
  const encoded = encodeURIComponent(profile).replace(/\./g, '%2E')
  return `codex-profile.${encoded}.${key}`
}

/** Drop document-scoped data and ask the backend for its current ID again. */
export function reloadForConnectionProfile(next: string): boolean {
  if (!profile || !next || next === profile || typeof window === 'undefined') return false
  window.location.reload()
  return true
}
