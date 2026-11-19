/** Independent keys keep simultaneous edits to different contexts separate. */
export function readPreferenceRecords(base: string): Record<string, string> {
  const result = Object.create(null) as Record<string, string>
  try {
    const storage = window.localStorage
    const prefix = `${base}.`
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (!key?.startsWith(prefix)) continue
      try {
        const id = decodeURIComponent(key.slice(prefix.length))
        const value: unknown = JSON.parse(storage.getItem(key) || 'null')
        if (typeof value === 'string' && value) result[id] = value
      } catch { /* A damaged entry does not hide other preferences. */ }
    }
  } catch { /* Preferences are optional when storage is unavailable. */ }
  return result
}

export function savePreferenceRecords(base: string, state: Record<string, string>, previous: Record<string, string>): void {
  if (typeof window === 'undefined') return
  for (const id of new Set([...Object.keys(previous), ...Object.keys(state)])) {
    const value = Object.prototype.hasOwnProperty.call(state, id) ? state[id] || '' : ''
    const old = Object.prototype.hasOwnProperty.call(previous, id) ? previous[id] || '' : ''
    if (value === old) continue
    try { window.localStorage.setItem(`${base}.${encodeURIComponent(id)}`, JSON.stringify(value)) }
    catch { /* Optional preferences must not prevent in-memory editing. */ }
  }
}

export function readPreferenceRecord(base: string, id: string): string | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(`${base}.${encodeURIComponent(id)}`) || 'null')
    return typeof value === 'string' ? value : null
  } catch { return null }
}
