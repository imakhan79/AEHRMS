// IndexedDB queue for punches captured without connectivity (ATT-08, 7.4).

export interface QueuedPunch {
  client_event_id: string;
  employee_id: string;
  punch_type: "in" | "out";
  punch_time: string; // device time at capture
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  selfie: Blob | null;
}

const DB_NAME = "ae-hrms";
const STORE = "punch-queue";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "client_event_id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const queue = {
  add: (p: QueuedPunch) => tx("readwrite", (s) => s.put(p)),
  all: () => tx<QueuedPunch[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedPunch[]>),
  remove: (id: string) => tx("readwrite", (s) => s.delete(id)),
};
