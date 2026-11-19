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

export async function readBrowserRecord<T>(name: string, initial: T): Promise<T> {
  const db = await database()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction('records', 'readonly')
    let result: T
    tx.oncomplete = () => { db.close(); resolve(result) }
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error || new Error('Browser recovery read failed')) }
    const read = tx.objectStore('records').get(name)
    read.onsuccess = () => { result = read.result === undefined ? initial : read.result }
  })
}

export async function updateBrowserRecord<T>(name: string, initial: T, change: (current: T) => T): Promise<T> {
  const db = await database()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite', { durability: 'strict' })
    let next: T
    tx.oncomplete = () => { db.close(); resolve(next) }
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error || new Error('Browser recovery write failed')) }
    const store = tx.objectStore('records'), read = store.get(name)
    read.onsuccess = () => {
      try { next = change(read.result === undefined ? initial : read.result); store.put(next, name) }
      catch (error) { tx.abort(); reject(error) }
    }
  })
}
