/** Serialize synchronous localStorage mutations with one IndexedDB readwrite
 * transaction per critical section. Using the same primitive in every tab avoids
 * splitting ownership when Web Locks is exposed in only some contexts.
 * No localStorage rollback is implied; failed reservations stay conservative.
 */
export async function withBrowserStorageLock<T>(name: string, action: () => T): Promise<T> {
  if (typeof indexedDB === 'undefined') throw new Error('Atomic browser recovery storage unavailable; queue submission is disabled')
  return new Promise<T>((resolve, reject) => {
    const request = indexedDB.open('codex-web-local.persistence-locks.v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('locks')
    request.onerror = () => reject(request.error)
    let blocked = false
    request.onblocked = () => { blocked = true; reject(new Error('Browser recovery storage is blocked')) }
    request.onsuccess = () => {
      const db = request.result
      if (blocked) { db.close(); return }
      let result: T
      try {
        const tx = db.transaction('locks', 'readwrite')
        tx.oncomplete = () => { db.close(); resolve(result) }
        tx.onabort = tx.onerror = () => { db.close(); reject(tx.error || new Error('Browser recovery transaction failed')) }
        const read = tx.objectStore('locks').get(name)
        read.onsuccess = () => {
          try { result = action() }
          catch (error) { tx.abort(); reject(error) }
        }
      } catch (error) { db.close(); reject(error) }
    }
  })
}
