/** Critical records live inside the transaction; locking a localStorage callback
 * alone is insufficient because another renderer may hold a stale snapshot. */
function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Atomic browser recovery storage unavailable; queue submission is disabled'))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('codex-web-local.persistence.v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('records')
    let blocked = false
    request.onblocked = () => { blocked = true; reject(new Error('Browser recovery storage is blocked')) }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result) }
  })
}

export async function readBrowserRecord<T>(name: string, legacy: () => T): Promise<T> {
  if (typeof window === 'undefined') return legacy()
  const db = await database()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction('records', 'readonly')
    let result: T
    tx.oncomplete = () => { db.close(); resolve(result) }
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error || new Error('Browser recovery read failed')) }
    const read = tx.objectStore('records').get(name)
    read.onsuccess = () => { try { result = read.result === undefined ? legacy() : read.result } catch (error) { tx.abort(); reject(error) } }
  })
}

export async function updateBrowserRecord<T>(name: string, legacy: () => T, change: (current: T) => T, notify = false): Promise<T> {
  if (typeof window === 'undefined') return change(legacy())
  const db = await database()
  const result = await new Promise<T>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite', { durability: 'strict' })
    let next: T
    tx.oncomplete = () => { db.close(); resolve(next) }
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error || new Error('Browser recovery write failed')) }
    const store = tx.objectStore('records'), read = store.get(name)
    read.onsuccess = () => {
      try { next = change(read.result === undefined ? legacy() : read.result); store.put(next, name) }
      catch (error) { tx.abort(); reject(error) }
    }
  })
  // Invalidation only, never a second copy of the user data. Failure does not
  // invalidate a successfully committed recovery record.
  if (notify) {
    try { window.localStorage.setItem(`${name}.revision`, `${Date.now()}-${Math.random()}`) } catch { /* Reopen reads IndexedDB directly. */ }
  }
  return result
}
