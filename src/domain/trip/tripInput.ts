import type { EstimationAssumptions } from '../../config/estimation';
import { DEFAULT_ASSUMPTIONS } from '../../config/estimation';
import type { Interval, Supplements, TripInput } from '../fare/types';
import type { TrackAnalysis } from './gpsTrack';

/** Manual trips are cut into chunks so a night boundary splits them proportionally. */
const MANUAL_CHUNKS = 12;

export interface ManualTripData {
  distanceKm: number;
  durationMin: number;
  startMs: number;
  /** null/undefined = unknown. */
  stoppedMin?: number | null;
  supplements: Supplements;
}

export function validateManual(m: ManualTripData): string[] {
  const errors: string[] = [];
  if (!(m.distanceKm >= 0) || m.distanceKm > 500) errors.push('Distance must be between 0 and 500 km.');
  if (!(m.durationMin > 0) || m.durationMin > 600) errors.push('Duration must be between 1 and 600 minutes.');
  if (m.stoppedMin != null && (!(m.stoppedMin >= 0) || m.stoppedMin > m.durationMin)) {
    errors.push('Stopped time must be between 0 and the total duration.');
  }
  if (m.distanceKm > 0 && m.stoppedMin === m.durationMin) {
    errors.push('A trip with distance must include some moving time.');
  }
  if (!Number.isFinite(m.startMs)) errors.push('Start date/time is invalid.');
  if (!Number.isInteger(m.supplements.luggageItems) || m.supplements.luggageItems < 0 || m.supplements.luggageItems > 10) {
    errors.push('Luggage items must be a whole number from 0 to 10.');
  }
  return errors;
}

export function manualTripInput(m: ManualTripData, a: EstimationAssumptions = DEFAULT_ASSUMPTIONS): TripInput {
  const T = m.durationMin * 60;
  const D = m.distanceKm * 1000;
  const chunkS = T / MANUAL_CHUNKS;
  const intervals: Interval[] = [];
  const warnings: string[] = [];
  const known = m.stoppedMin != null;

  for (let i = 0; i < MANUAL_CHUNKS; i++) {
    const startMs = m.startMs + i * chunkS * 1000;
    if (known) {
      const stopS = (m.stoppedMin! * 60) / MANUAL_CHUNKS;
      const moveS = chunkS - stopS;
      if (moveS > 0) intervals.push({ startMs, durationS: moveS, distanceM: D / MANUAL_CHUNKS, kind: 'measured' });
      if (stopS > 0) intervals.push({ startMs: startMs + moveS * 1000, durationS: stopS, distanceM: 0, kind: 'measured' });
      if (moveS <= 0 && D > 0) intervals.push({ startMs, durationS: 0, distanceM: D / MANUAL_CHUNKS, kind: 'measured' });
    } else {
      intervals.push({ startMs, durationS: chunkS, distanceM: D / MANUAL_CHUNKS, kind: 'gap' });
    }
  }

  if (!known) warnings.push('Waiting time was not provided, so this estimate uses a range.');
  // A typed stopped time is itself approximate: widen via distance error proxy.
  const distanceError = a.manualDistanceError + (known ? a.manualStoppedTimeError * ((m.stoppedMin! * 60) / Math.max(T, 1)) : 0);
  return {
    startMs: m.startMs,
    endMs: m.startMs + T * 1000,
    intervals,
    supplements: m.supplements,
    distanceError,
    dataConfidence: known ? 0.6 : 0.35,
    warnings,
  };
}

export function liveTripInput(
  track: TrackAnalysis,
  startMs: number,
  endMs: number,
  supplements: Supplements,
  a: EstimationAssumptions = DEFAULT_ASSUMPTIONS,
): TripInput {
  const s = track.stats;
  const warnings: string[] = [];
  if (s.acceptedFixes === 0) {
    warnings.push('No usable GPS position was received. The estimate is based on time only; use the manual calculator if you know the distance.');
  } else if (s.coverage < 0.9) {
    warnings.push('Estimate has limited accuracy because GPS data was incomplete.');
  }
  if (s.rejectedJump > 0) warnings.push(`${s.rejectedJump} GPS position(s) were discarded as implausible jumps.`);
  if (s.meanAccuracyM !== null && s.meanAccuracyM > 25) warnings.push(`Average GPS accuracy was poor (about ${Math.round(s.meanAccuracyM)} m).`);

  let confidence = s.acceptedFixes === 0 ? 0 : s.coverage;
  if (s.meanAccuracyM !== null && s.meanAccuracyM > 25) confidence *= 0.8;
  if (s.rejectedJump > 5) confidence *= 0.9;

  return {
    startMs,
    endMs,
    intervals: track.intervals,
    supplements,
    distanceError: a.gpsDistanceError + (1 - s.coverage) * 0.1,
    dataConfidence: Math.max(0, Math.min(1, confidence)),
    warnings,
  };
}
