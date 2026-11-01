import type { Supplements } from '../domain/fare/types';
import type { GpsSample } from '../domain/trip/gpsTrack';

/** In-progress ride, kept in localStorage so a reload or tab kill does not lose it. */
export interface ActiveRide {
  tariffId?: string;
  startMs: number;
  samples: GpsSample[];
  supplements: Supplements;
  gpsStatus: 'waiting' | 'ok' | 'denied' | 'unavailable';
}

const KEY = 'taxi-check.active-ride';

export type StoredActiveRide = Omit<ActiveRide, 'tariffId'> & { tariffId?: unknown };

export type ActiveRideRead =
  | { status: 'absent' }
  | { status: 'valid'; ride: StoredActiveRide }
  | { status: 'invalid' }
  | { status: 'unavailable' };

export type ActiveRideRecovery =
  | { kind: 'tariff'; ride: StoredActiveRide }
  | { kind: 'storage'; reason: 'invalid' | 'unavailable' | 'present' | 'cleanup' };

export function loadActiveRide(): ActiveRideRead {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch { return { status: 'unavailable' }; }
  if (raw === null) return { status: 'absent' };
  try {
    const ride = JSON.parse(raw) as StoredActiveRide;
    if (!ride || typeof ride !== 'object' || Array.isArray(ride) ||
        !Number.isFinite(ride.startMs) || ride.startMs > Date.now() ||
        !Array.isArray(ride.samples) || !ride.samples.every((s) => s && typeof s === 'object') || !ride.supplements ||
        typeof ride.supplements.airportDeparture !== 'boolean' ||
        !Number.isInteger(ride.supplements.luggageItems) || ride.supplements.luggageItems < 0 ||
        (ride.gpsStatus !== undefined && !['waiting', 'ok', 'denied', 'unavailable'].includes(ride.gpsStatus))) {
      return { status: 'invalid' };
    }
    return { status: 'valid', ride: { ...ride, gpsStatus: ride.gpsStatus ?? 'waiting' } };
  } catch {
    return { status: 'invalid' };
  }
}

export function saveActiveRide(ride: ActiveRide): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(ride));
    return true;
  } catch {
    // Storage full or blocked: the ride continues in memory only.
    return false;
  }
}

export function clearActiveRide(): boolean {
  return clearActiveRideStatus() === 'absent';
}

export type ActiveCleanupStatus = 'absent' | 'retained' | 'uncertain';

export function clearActiveRideStatus(): ActiveCleanupStatus {
  try { localStorage.removeItem(KEY); } catch { /* Verify the actual state independently. */ }
  try {
    return localStorage.getItem(KEY) === null ? 'absent' : 'retained';
  } catch {
    return 'uncertain';
  }
}
