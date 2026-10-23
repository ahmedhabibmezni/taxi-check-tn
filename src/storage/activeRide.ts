import type { Supplements } from '../domain/fare/types';
import type { GpsSample } from '../domain/trip/gpsTrack';

/** In-progress ride, kept in localStorage so a reload or tab kill does not lose it. */
export interface ActiveRide {
  startMs: number;
  samples: GpsSample[];
  supplements: Supplements;
  gpsStatus: 'waiting' | 'ok' | 'denied' | 'unavailable';
}

const KEY = 'taxi-check.active-ride';

export function loadActiveRide(): ActiveRide | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ActiveRide) : null;
  } catch {
    return null;
  }
}

export function saveActiveRide(ride: ActiveRide): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ride));
  } catch {
    // Storage full or blocked: the ride continues in memory only.
  }
}

export function clearActiveRide(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
