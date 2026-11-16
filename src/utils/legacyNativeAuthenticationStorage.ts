import { profileStorageKey } from './browserConnectionProfile'
const LEGACY_KEY = 'codex-web-local.native-authentication-pending.v1'
/** Delete only obsolete authentication latches; never read them as state. */
export function removeLegacyNativeAuthenticationPending() {
  if (typeof window === 'undefined') return
  try {
    const storage = window.localStorage
    const keys = [LEGACY_KEY, profileStorageKey(LEGACY_KEY)]
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key?.startsWith('codex-profile.') && key.endsWith(`.${LEGACY_KEY}`)) keys.push(key)
    }
    for (const key of keys) storage.removeItem(key)
  } catch { /* Storage restrictions cannot affect backend authentication. */ }
}
