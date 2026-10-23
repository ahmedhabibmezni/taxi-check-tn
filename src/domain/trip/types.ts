import type { FareBreakdown, Supplements } from '../fare/types';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface TripRecord {
  id: string;
  mode: 'live' | 'manual';
  startMs: number;
  endMs: number;
  durationS: number;
  startCoords: LatLon | null;
  endCoords: LatLon | null;
  distanceM: number;
  movingTimeS: number;
  slowTimeS: number;
  estimate: { best: number; low: number; high: number; breakdown: FareBreakdown };
  meter: number | null;
  diff: number | null;
  diffPct: number | null;
  tariffId: string;
  strategyId: string;
  supplements: Supplements;
  confidence: number;
  warnings: string[];
}
