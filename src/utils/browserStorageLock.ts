/** Execute synchronous localStorage work under an origin-wide lock. Never await
 * inside the IndexedDB callback: the readwrite transaction is the fallback lock.
 * If neither facility works, reject rather than perform an unsafe queue write.
 */
export async function withBrowserStorageLock<T>(name: string, action: () => T): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(name, action)
  }
  if (typeof indexedDB === 'undefined') throw new Error('Atomic browser recovery storage unavailable; queue submission is disabled')
  return new Promise<T>((resolve, reject) => {
    const request = indexedDB.open('codex-web-local.persistence-locks.v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('locks')
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Browser recovery storage is blocked'))
    request.onsuccess = () => {
      const db = request.result
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
