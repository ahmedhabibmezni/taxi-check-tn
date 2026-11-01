import type { TripRecord } from '../domain/trip/types';

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0;
const money = (value: unknown): value is number => nonnegative(value) && Number.isSafeInteger(value);
const date = (value: unknown) => finite(value) && Number.isFinite(new Date(value).getTime());
const coordinate = (value: unknown) => value == null || (object(value) && finite(value.lat) && finite(value.lon));

/** Detached compatible view only. Never repairs or persists the source record. */
export function readCompletedTrip(value: unknown): TripRecord | null {
  if (!object(value) || typeof value.id !== 'string' || !value.id.length
    || (value.mode !== 'manual' && value.mode !== 'live') || !date(value.startMs) || !date(value.endMs)
    || !['durationS', 'distanceM', 'movingTimeS', 'slowTimeS'].every(key => nonnegative(value[key]))
    || !finite(value.confidence) || typeof value.tariffId !== 'string' || typeof value.strategyId !== 'string'
    || !Array.isArray(value.warnings) || !value.warnings.every(warning => typeof warning === 'string')
    || !object(value.supplements) || typeof value.supplements.airportDeparture !== 'boolean'
    || !money(value.supplements.luggageItems) || !coordinate(value.startCoords) || !coordinate(value.endCoords)
    || !object(value.estimate)) return null;
  const estimate = value.estimate;
  if (!['best', 'low', 'high'].every(key => money(estimate[key])) || !object(estimate.breakdown)) return null;
  const breakdown = estimate.breakdown;
  if (!['initialFare', 'distanceCharge', 'waitingCharge', 'nightSurcharge', 'airportSupplement',
    'luggageSupplement', 'total'].every(key => money(breakdown[key]))) return null;
  if (value.meter != null && !money(value.meter)) return null;
  if (value.diff != null && !(finite(value.diff) && Number.isSafeInteger(value.diff))) return null;
  if (value.diffPct != null && !finite(value.diffPct)) return null;
  return { ...value, startCoords: value.startCoords ?? null, endCoords: value.endCoords ?? null,
    meter: value.meter ?? null, diff: value.diff ?? null, diffPct: value.diffPct ?? null } as unknown as TripRecord;
}

export function readCompletedHistory(values: unknown[]): { trips: TripRecord[]; unreadable: number } {
  const trips: TripRecord[] = [];
  let unreadable = 0;
  for (const value of values) {
    const trip = readCompletedTrip(value);
    if (trip) trips.push(trip); else unreadable++;
  }
  trips.sort((a, b) => b.startMs - a.startMs);
  return { trips, unreadable };
}

export type SavedTripRead = { status: 'missing' } | { status: 'unreadable' } | { status: 'valid'; trip: TripRecord };
