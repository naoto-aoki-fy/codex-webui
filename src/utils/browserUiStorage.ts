/** Best-effort UI preferences only. Never use these helpers for recovery markers. */
export function readUiPreference(key: string): string | null {
  try { return typeof window === 'undefined' ? null : window.localStorage.getItem(key) }
  catch { return null }
}
export function writeUiPreference(key: string, value: string): void {
  try { if (typeof window !== 'undefined') window.localStorage.setItem(key, value) }
  catch { /* The live UI still works with unavailable/quota-limited storage. */ }
}
