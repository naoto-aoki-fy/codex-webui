const PROFILE_STORAGE_KEY = 'codex-web-local.connection-profile.v1'
const PROFILE_QUERY_KEY = 'connection-profile'

function initialProfile(): string {
  if (typeof window === 'undefined') return 'legacy'
  try {
    const query = new URL(window.location.href).searchParams.get(PROFILE_QUERY_KEY)
    if (query) return query
  } catch { /* Test environments may not expose location. */ }
  try { return window.localStorage.getItem(PROFILE_STORAGE_KEY) || 'legacy' }
  catch { return 'legacy' }
}
let profile: string | undefined
function currentProfile(): string { return profile ??= initialProfile() }

export function profileStorageKey(key: string): string {
  const active = currentProfile()
  return active === 'legacy' ? key : `codex-profile.${encodeURIComponent(active)}.${key}`
}

/** A full document boundary drops all remote caches, outstanding callbacks and
 * UI state together. Existing drafts remain in their previous profile namespace.
 * The URL hint prevents reload loops when browser storage is unavailable. */
export function reloadForConnectionProfile(next: string): boolean {
  if (!next || next === currentProfile() || typeof window === 'undefined') return false
  try { window.localStorage.setItem(PROFILE_STORAGE_KEY, next) } catch { /* URL fallback below. */ }
  const url = new URL(window.location.href)
  url.searchParams.set(PROFILE_QUERY_KEY, next)
  window.location.replace(url.toString())
  return true
}
