"use client"

/**
 * JARVIS's private knowledge store — IndexedDB in YOUR browser.
 *
 * Documents never leave this device: retrieval happens client-side and only
 * the relevant excerpts are sent with each question. When cloud accounts
 * arrive (Phase 5), this becomes Supabase with row-level security.
 */

export interface DocRecord {
  id: string
  name: string
  kind: "document" | "note"
  chars: number
  text: string
  createdAt: number
}

const DB_NAME = "jarvis-kb"
const STORE = "docs"
const VERSION = 1

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = fn(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        t.oncomplete = () => db.close()
      })
  )
}

export async function putDoc(doc: DocRecord): Promise<void> {
  await tx("readwrite", (s) => s.put(doc))
}

export async function allDocs(): Promise<DocRecord[]> {
  const docs = await tx<DocRecord[]>("readonly", (s) => s.getAll())
  return (docs ?? []).sort((a, b) => b.createdAt - a.createdAt)
}

/** Metadata only — cheap for rendering the panel list. */
export async function docMeta(): Promise<Omit<DocRecord, "text">[]> {
  return (await allDocs()).map(({ text: _text, ...meta }) => meta)
}

export async function deleteDoc(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id))
}

export function uid(): string {
  return crypto.randomUUID()
}
