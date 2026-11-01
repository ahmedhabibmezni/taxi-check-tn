import type { TripRecord } from '../domain/trip/types';
import { readCompletedTrip, type SavedTripRead } from './completedTrip';

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
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      // Request success precedes commit; quota/disk failures can still abort it.
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = () => reject(tx.error ?? new Error('Local database transaction aborted'));
      tx.onerror = () => reject(tx.error ?? new Error('Local database transaction failed'));
      req.onerror = () => reject(req.error ?? new Error('Local database error'));
    });
  } finally {
    db.close();
  }
}

export const tripStore = {
  async list(): Promise<unknown[]> {
    return run<unknown[]>('readonly', (s) => s.getAll());
  },
  async get(id: string): Promise<SavedTripRead> {
    const value = await run<unknown>('readonly', (s) => s.get(id));
    if (value === undefined) return { status: 'missing' };
    const trip = readCompletedTrip(value);
    return trip ? { status: 'valid', trip } : { status: 'unreadable' };
  },
  save: async (trip: TripRecord): Promise<void> => {
    await run('readwrite', (s) => s.put(trip));
  },
  remove: async (id: string): Promise<void> => {
    await run('readwrite', (s) => s.delete(id));
  },
};
