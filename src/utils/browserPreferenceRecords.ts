/** Independent keys avoid whole-map lost updates without async preference APIs.
 * Empty strings are tombstones overriding retained legacy migration inputs.
 */
export function readPreferenceRecords(base: string, legacy: Record<string, string>): Record<string, string> {
  const result = Object.assign(Object.create(null), legacy) as Record<string, string>
  try {
    const storage = window.localStorage
    const prefix = `${base}.`
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (!key?.startsWith(prefix)) continue
      try {
        const id = decodeURIComponent(key.slice(prefix.length))
        const value: unknown = JSON.parse(storage.getItem(key) || 'null')
        if (typeof value === 'string') {
          if (value) result[id] = value
          else delete result[id]
        }
      } catch { /* A damaged entry does not hide other preferences. */ }
    }
  } catch { /* Legacy fallback when storage is unavailable. */ }
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
