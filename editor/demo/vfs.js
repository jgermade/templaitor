// Persistence of the demo's virtual file system (shims/fs.js) in IndexedDB: loaded once at start, then every
// change is written back in small batches. Without IndexedDB (private mode…) the demo still works in memory.
import { vfs } from './shims/fs.js'

const DB = 'templaitor-demo'
const STORE = 'files'
const DIR = { dir: true }
let db = null

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error) })

/** Loads the saved files into the virtual fs → true when there was something saved */
export async function loadVfs() {
  try { db = await openDb() } catch (e) { console.warn('templaitor demo: IndexedDB unavailable, changes stay in memory', e); return false }
  const entries = await new Promise((resolve, reject) => {
    const out = []
    const req = db.transaction(STORE).objectStore(STORE).openCursor()
    req.onsuccess = () => { const c = req.result; if (!c) return resolve(out); out.push([c.key, c.value]); c.continue() }
    req.onerror = () => reject(req.error)
  })
  for (const [key, value] of entries) {
    if (value?.dir) vfs.dirs.add(key)
    else vfs.files.set(key, value?.data)
  }

  // write-behind: changed paths are flushed together
  const pending = new Set()
  let timer = null
  const flush = async () => {
    timer = null
    if (!pending.size) return
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const p of pending) {
      if (vfs.files.has(p)) store.put({ data: vfs.files.get(p) }, p)
      else if (vfs.dirs.has(p)) store.put(DIR, p)
      else store.delete(p)
    }
    pending.clear()
    await done(tx).catch(e => console.warn('templaitor demo: could not save', e))
  }
  vfs.onChange = (p) => { pending.add(p); timer ??= setTimeout(flush, 150) }
  addEventListener('pagehide', flush)
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
  return entries.length > 0
}

/** Deletes everything the demo saved in this browser */
export async function resetVfs() {
  vfs.clear()
  if (!db) return
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).clear()
  await done(tx)
}
