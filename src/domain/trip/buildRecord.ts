import type { FareEstimate, Supplements } from '../fare/types';
import type { TrackAnalysis } from './gpsTrack';
import type { TripRecord } from './types';

export function newTripId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function buildRecord(args: {
  mode: 'live' | 'manual';
  startMs: number;
  endMs: number;
  distanceM: number;
  estimate: FareEstimate;
  supplements: Supplements;
  track?: TrackAnalysis;
}): TripRecord {
  const { estimate: e, track } = args;
  const durationS = Math.max(0, (args.endMs - args.startMs) / 1000);
  return {
    id: newTripId(),
    mode: args.mode,
    startMs: args.startMs,
    endMs: args.endMs,
    durationS,
    startCoords: track?.firstFix ? { lat: track.firstFix.lat, lon: track.firstFix.lon } : null,
    endCoords: track?.lastFix ? { lat: track.lastFix.lat, lon: track.lastFix.lon } : null,
    distanceM: args.distanceM,
    movingTimeS: e.movingTimeS,
    slowTimeS: Math.max(0, durationS - e.movingTimeS),
    estimate: { best: e.best, low: e.low, high: e.high, breakdown: e.breakdown },
    meter: null,
    diff: null,
    diffPct: null,
    tariffId: e.tariffId,
    strategyId: e.strategyId,
    supplements: args.supplements,
    confidence: e.confidence,
    warnings: e.warnings,
  };
}
