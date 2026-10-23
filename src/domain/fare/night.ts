import type { TaxiTariff } from './tariff';
import { parseHHMM } from './tariff';
import type { Interval } from './types';

const DAY_MS = 86_400_000;

function localMsOfDay(utcMs: number, t: TaxiTariff): number {
  const local = utcMs + t.utcOffsetMinutes * 60_000;
  return ((local % DAY_MS) + DAY_MS) % DAY_MS;
}

export function isNight(utcMs: number, t: TaxiTariff): boolean {
  const start = parseHHMM(t.nightStart) * 60_000;
  const end = parseHHMM(t.nightEnd) * 60_000;
  if (start === end) return false;
  const m = localMsOfDay(utcMs, t);
  return start > end ? m >= start || m < end : m >= start && m < end;
}

function nextBoundary(utcMs: number, t: TaxiTariff): number {
  const m = localMsOfDay(utcMs, t);
  const deltas = [parseHHMM(t.nightStart), parseHHMM(t.nightEnd)].map((b) => {
    const d = (((b * 60_000 - m) % DAY_MS) + DAY_MS) % DAY_MS;
    return d === 0 ? DAY_MS : d;
  });
  return utcMs + Math.min(...deltas);
}

/**
 * Cuts an interval at 21:00 / 05:00 so each piece is wholly day or night.
 * Distance is split in proportion to time (constant speed inside an interval).
 */
export function splitByNight(iv: Interval, t: TaxiTariff): { interval: Interval; night: boolean }[] {
  const pieces: { interval: Interval; night: boolean }[] = [];
  const endMs = iv.startMs + iv.durationS * 1000;
  if (iv.durationS <= 0) return [{ interval: iv, night: isNight(iv.startMs, t) }];
  let cursor = iv.startMs;
  while (cursor < endMs) {
    const pieceEnd = Math.min(endMs, nextBoundary(cursor, t));
    const f = (pieceEnd - cursor) / (endMs - iv.startMs);
    pieces.push({
      night: isNight(cursor, t),
      interval: {
        ...iv,
        startMs: cursor,
        durationS: (pieceEnd - cursor) / 1000,
        distanceM: iv.distanceM * f,
        distanceLowM: iv.distanceLowM === undefined ? undefined : iv.distanceLowM * f,
        distanceHighM: iv.distanceHighM === undefined ? undefined : iv.distanceHighM * f,
      },
    });
    cursor = pieceEnd;
  }
  return pieces;
}
