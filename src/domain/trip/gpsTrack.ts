import type { GpsFilterConfig } from '../../config/estimation';
import { DEFAULT_GPS_FILTER } from '../../config/estimation';
import type { Interval } from '../fare/types';
import { haversineM } from '../../utils/geo';

export interface GpsSample {
  /** Epoch ms of the fix. */
  t: number;
  lat: number;
  lon: number;
  /** Reported horizontal accuracy, metres. */
  accuracy: number;
  /** Doppler speed in m/s when the device reports one. */
  speed?: number | null;
}

export interface TrackStats {
  acceptedFixes: number;
  rejectedAccuracy: number;
  rejectedJump: number;
  rejectedTime: number;
  measuredDistanceM: number;
  /** Share of the ride duration covered by measured (non-gap) intervals. */
  coverage: number;
  meanAccuracyM: number | null;
  gapCount: number;
}

export interface TrackAnalysis {
  intervals: Interval[];
  stats: TrackStats;
  firstFix: GpsSample | null;
  lastFix: GpsSample | null;
}

/**
 * Turns raw fixes into charging intervals. Pure and deterministic: the live
 * screen re-runs it on the full sample list, so the estimate after a reload is
 * identical to the one before.
 *
 * Algorithm (see README "GPS filtering"):
 * 1. Drop fixes with poor accuracy or non-increasing timestamps.
 * 2. Keep an anchor (last accepted position). A new fix that implies an
 *    impossible speed, or an impossible jump in speed, is rejected.
 * 3. Distance only counts once the fix is further from the anchor than the
 *    noise floor (max(minMove, accuracyMoveFactor x combined accuracy)). Below
 *    that the car is treated as stationary: time passes, distance does not.
 *    This hysteresis is what stops GPS jitter from inflating the distance.
 * 4. Stationary time is flushed every stationaryFlushS as a zero-distance interval.
 * 5. Holes longer than gapThresholdS (no accepted fix) become "gap" intervals
 *    with distance bounds, so the fare model can bound them honestly.
 */
export function analyzeTrack(
  samples: readonly GpsSample[],
  startMs: number,
  endMs: number,
  cfg: GpsFilterConfig = DEFAULT_GPS_FILTER,
): TrackAnalysis {
  const intervals: Interval[] = [];
  const stats: TrackStats = {
    acceptedFixes: 0, rejectedAccuracy: 0, rejectedJump: 0, rejectedTime: 0,
    measuredDistanceM: 0, coverage: 0, meanAccuracyM: null, gapCount: 0,
  };
  let accSum = 0;

  let anchor: GpsSample | null = null; // position distance is measured from
  let anchorT = startMs; // time the current pending interval started
  let lastAccepted: GpsSample | null = null;
  let firstFix: GpsSample | null = null;
  let prevSpeed = 0;
  let speedHints: number[] = [];

  const pushGap = (from: number, to: number, straightM: number | null) => {
    const durationS = (to - from) / 1000;
    if (durationS <= 0) return;
    stats.gapCount += 1;
    if (straightM === null) {
      intervals.push({ startMs: from, durationS, distanceM: 0, distanceLowM: 0, distanceHighM: durationS * cfg.gapMaxSpeedMps, kind: 'gap' });
    } else {
      intervals.push({
        startMs: from, durationS, kind: 'gap',
        distanceM: straightM * cfg.gapRouteFactor,
        distanceLowM: straightM,
        distanceHighM: straightM * cfg.gapRouteFactorHigh,
      });
    }
  };

  const pushMeasured = (from: number, to: number, distanceM: number) => {
    const durationS = (to - from) / 1000;
    if (durationS <= 0 && distanceM <= 0) return;
    const hint = speedHints.length ? speedHints.reduce((a, b) => a + b, 0) / speedHints.length : undefined;
    intervals.push({ startMs: from, durationS, distanceM, kind: 'measured', speedHintMps: hint });
    stats.measuredDistanceM += distanceM;
    speedHints = [];
  };

  const ordered = [...samples].sort((a, b) => a.t - b.t);
  for (const s of ordered) {
    if (s.t < startMs || s.t > endMs) continue;
    if (!(s.accuracy <= cfg.maxAccuracyM)) {
      stats.rejectedAccuracy += 1;
      continue;
    }
    if (lastAccepted && s.t <= lastAccepted.t) {
      stats.rejectedTime += 1;
      continue;
    }

    if (!anchor) {
      // Before the first fix we know nothing about distance.
      if ((s.t - startMs) / 1000 > cfg.gapThresholdS) pushGap(startMs, s.t, null);
      else pushMeasured(startMs, s.t, 0);
      anchor = s; anchorT = s.t; lastAccepted = s; firstFix = s;
      stats.acceptedFixes += 1; accSum += s.accuracy;
      continue;
    }

    const sinceLast = (s.t - lastAccepted!.t) / 1000;
    const d = haversineM(anchor.lat, anchor.lon, s.lat, s.lon);
    const dtAnchor = Math.max((s.t - anchorT) / 1000, 1e-3);
    const implied = d / Math.max((s.t - anchor.t) / 1000, 1e-3);
    const accelBad = implied > cfg.accelCheckMinSpeedMps && (implied - prevSpeed) / Math.max(sinceLast, 1e-3) > cfg.maxAccelMps2;

    if (implied > cfg.maxSpeedMps || accelBad) {
      const stuck = (s.t - lastAccepted!.t) / 1000 >= cfg.reanchorAfterS;
      if (!stuck) {
        stats.rejectedJump += 1;
        continue;
      }
      // Too long with only rejected fixes: the anchor itself may be wrong.
      // Re-anchor here and treat the hole as a gap with wide bounds.
      intervals.push({ startMs: anchorT, durationS: (s.t - anchorT) / 1000, distanceM: 0, distanceLowM: 0, distanceHighM: d, kind: 'gap' });
      stats.gapCount += 1;
      anchor = s; anchorT = s.t; lastAccepted = s; prevSpeed = 0;
      stats.acceptedFixes += 1; accSum += s.accuracy;
      continue;
    }

    stats.acceptedFixes += 1; accSum += s.accuracy;
    if (typeof s.speed === 'number' && s.speed >= 0) speedHints.push(s.speed);

    if (sinceLast > cfg.gapThresholdS) {
      // Close what was pending at the last fix, then bound the hole.
      pushMeasured(anchorT, lastAccepted!.t, 0);
      pushGap(lastAccepted!.t, s.t, d);
      anchor = s; anchorT = s.t; lastAccepted = s; prevSpeed = 0; speedHints = [];
      continue;
    }

    const noise = Math.max(cfg.minMoveM, cfg.accuracyMoveFactor * (anchor.accuracy + s.accuracy));
    if (d >= noise) {
      pushMeasured(anchorT, s.t, d);
      prevSpeed = d / dtAnchor;
      anchor = s; anchorT = s.t;
    } else if ((s.t - anchorT) / 1000 >= cfg.stationaryFlushS) {
      pushMeasured(anchorT, s.t, 0);
      prevSpeed = 0;
      anchorT = s.t; // position kept: slow drift can still add up
    }
    lastAccepted = s;
  }

  if (!lastAccepted) {
    pushGap(startMs, endMs, null);
  } else if ((endMs - lastAccepted.t) / 1000 > cfg.gapThresholdS) {
    pushMeasured(anchorT, lastAccepted.t, 0);
    pushGap(lastAccepted.t, endMs, null);
  } else {
    pushMeasured(anchorT, endMs, 0);
  }

  // Unknown-distance gaps: best guess = the average speed seen while measured.
  const measuredS = intervals.filter((i) => i.kind === 'measured').reduce((a, i) => a + i.durationS, 0);
  const avgSpeed = measuredS > 0 ? stats.measuredDistanceM / measuredS : 0;
  const finalIntervals = intervals.map((iv) =>
    iv.kind === 'gap' && iv.distanceM === 0 && iv.distanceLowM === 0
      ? { ...iv, distanceM: Math.min(avgSpeed * iv.durationS, iv.distanceHighM ?? Infinity) }
      : iv,
  );

  const totalS = (endMs - startMs) / 1000;
  stats.coverage = totalS > 0 ? Math.min(1, measuredS / totalS) : 1;
  stats.meanAccuracyM = stats.acceptedFixes ? accSum / stats.acceptedFixes : null;
  return { intervals: finalIntervals, stats, firstFix, lastFix: lastAccepted };
}
