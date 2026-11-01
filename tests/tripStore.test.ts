import { afterEach, expect, it, vi } from 'vitest';
import { tripStore } from '../src/storage/tripStore';
import type { TripRecord } from '../src/domain/trip/types';

afterEach(() => vi.unstubAllGlobals());

it('does not report a saved trip before the IndexedDB transaction commits', async () => {
  const request = { result: 'trip-id', onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
  const tx = { objectStore: () => ({ put: () => request }),
    oncomplete: null as (() => void) | null, onabort: null as (() => void) | null, onerror: null as (() => void) | null,
    error: new Error('Storage full') };
  const db = { transaction: () => tx, close: vi.fn() };
  const open = { result: db, onsuccess: null as (() => void) | null };
  vi.stubGlobal('indexedDB', { open: () => { queueMicrotask(() => open.onsuccess?.()); return open; } });
  let saved = false;
  const pending = tripStore.save({ id: 'trip-id' } as TripRecord).then(() => { saved = true; });
  // Attach the rejection assertion before delivering the abort event.
  const rejected = expect(pending).rejects.toThrow('Storage full');
  for (let i = 0; i < 4; i++) await Promise.resolve();
  request.onsuccess?.();
  for (let i = 0; i < 4; i++) await Promise.resolve();
  expect(saved).toBe(false);
  tx.onabort?.();
  await rejected;
  expect(db.close).toHaveBeenCalled();
});
