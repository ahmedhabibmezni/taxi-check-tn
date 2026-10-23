import type { TripRecord } from '../domain/trip/types';

const DB_NAME = 'taxi-check';
const STORE = 'trips';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open local database'));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Local database error'));
    });
  } finally {
    db.close();
  }
}

export const tripStore = {
  async list(): Promise<TripRecord[]> {
    const all = await run<TripRecord[]>('readonly', (s) => s.getAll());
    return all.sort((a, b) => b.startMs - a.startMs);
  },
  get: (id: string) => run<TripRecord | undefined>('readonly', (s) => s.get(id)),
  save: async (trip: TripRecord): Promise<void> => {
    await run('readwrite', (s) => s.put(trip));
  },
  remove: async (id: string): Promise<void> => {
    await run('readwrite', (s) => s.delete(id));
  },
};
