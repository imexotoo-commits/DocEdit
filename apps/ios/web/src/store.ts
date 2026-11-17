/** Small persistent stores in the web view: settings and signatures in localStorage, recovery data in IndexedDB. */
export function lsGet<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
export function lsSet(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked: keep working without it */ }
}

const DB = 'oakqueill';
function open(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('recovery'); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error ?? new Error('IndexedDB unavailable'));
  });
}
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((ok, fail) => {
    const t = db.transaction('recovery', mode);
    const r = f(t.objectStore('recovery'));
    t.oncomplete = () => { db.close(); ok(r.result); };
    t.onerror = () => { db.close(); fail(t.error ?? new Error('IndexedDB error')); };
  });
}
export const idbGet = <T>(key: string) => tx<T | undefined>('readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
export const idbPut = (key: string, value: unknown) => tx('readwrite', (s) => s.put(value, key));
export const idbDelete = (key: string) => tx('readwrite', (s) => s.delete(key));
export const idbKeys = () => tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
