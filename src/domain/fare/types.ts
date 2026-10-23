/**
 * A slice of the ride. "measured" intervals come from consecutive accepted GPS
 * fixes (or an exactly known manual split). "gap" intervals have a known
 * duration but an uncertain split between moving and stopped time, so the
 * strategy bounds them instead of pretending to know.
 */
export interface Interval {
  startMs: number;
  durationS: number;
  distanceM: number;
  kind: 'measured' | 'gap';
  /** Gap only: plausible distance bounds. Default to distanceM. */
  distanceLowM?: number;
  distanceHighM?: number;
  /** Measured only: average Doppler speed reported by the device, if any. */
  speedHintMps?: number;
}

export interface Supplements {
  airportDeparture: boolean;
  luggageItems: number;
}

export interface TripInput {
  startMs: number;
  endMs: number;
  intervals: Interval[];
  supplements: Supplements;
  /** Relative error on measured distance, e.g. 0.03. */
  distanceError: number;
  /** 0..1, data quality before fare modelling. */
  dataConfidence: number;
  warnings: string[];
}

export interface FareBreakdown {
  initialFare: number;
  distanceCharge: number;
  waitingCharge: number;
  /** Part of distance + waiting + initial attributable to the night multiplier. */
  nightSurcharge: number;
  airportSupplement: number;
  luggageSupplement: number;
  total: number;
}

export interface FareEstimate {
  best: number;
  low: number;
  high: number;
  breakdown: FareBreakdown;
  /** Distance charged at the distance rate (best case), metres. */
  distanceChargedM: number;
  /** Time charged at the waiting rate (best case), seconds. */
  waitingChargedS: number;
  /** Time spent moving above the switching speed (best case), seconds. */
  movingTimeS: number;
  nightShare: number;
  confidence: number;
  warnings: string[];
  assumptions: string[];
  tariffId: string;
  strategyId: string;
}
