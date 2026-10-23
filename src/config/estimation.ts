/**
 * Assumptions used when the data does not determine the fare exactly.
 * These are NOT regulatory values. They only shape the estimate and its range.
 */
export interface EstimationAssumptions {
  /** Typical moving speed in town when the share of stopped time is unknown. */
  typicalMovingSpeedKmh: number;
  /** Upper plausible average speed while moving, used for the high end of a range. */
  maxMovingSpeedKmh: number;
  /** The switching speed is varied by +/- this fraction when building the range. */
  switchingSpeedTolerance: number;
  /** Relative distance error for GPS distance with full coverage. */
  gpsDistanceError: number;
  /** Relative distance error for a distance typed by the user (maps, memory). */
  manualDistanceError: number;
  /** Relative error on a stopped time typed by the user. */
  manualStoppedTimeError: number;
}

export const DEFAULT_ASSUMPTIONS: EstimationAssumptions = {
  typicalMovingSpeedKmh: 30,
  maxMovingSpeedKmh: 60,
  switchingSpeedTolerance: 0.15,
  gpsDistanceError: 0.03,
  manualDistanceError: 0.05,
  manualStoppedTimeError: 0.25,
};

export interface ComparisonThresholds {
  /** Above the high end by up to this % of the estimate => "slightly above". */
  slightlyAbovePct: number;
  /** Below this confidence the result is reported as "unable to determine reliably". */
  minConfidence: number;
  /** Below this confidence a warning is shown. */
  lowConfidence: number;
}

export const DEFAULT_THRESHOLDS: ComparisonThresholds = {
  slightlyAbovePct: 10,
  minConfidence: 0.2,
  lowConfidence: 0.6,
};

export interface GpsFilterConfig {
  /** Fixes with a worse reported accuracy are ignored. */
  maxAccuracyM: number;
  /** Implied speeds above this are impossible for a taxi in town. */
  maxSpeedMps: number;
  /** Large jumps that imply this acceleration are rejected. */
  maxAccelMps2: number;
  /** Acceleration check only applies above this implied speed. */
  accelCheckMinSpeedMps: number;
  /** Minimum displacement before distance is counted. */
  minMoveM: number;
  /** Displacement must also exceed this fraction of the combined accuracy. */
  accuracyMoveFactor: number;
  /** While stationary, time is flushed as a waiting interval every N seconds. */
  stationaryFlushS: number;
  /** No accepted fix for longer than this = GPS gap. */
  gapThresholdS: number;
  /** After this long with only rejected fixes, re-anchor on the newest fix. */
  reanchorAfterS: number;
  /** Straight-line to road distance factor assumed inside a gap (best, high). */
  gapRouteFactor: number;
  gapRouteFactorHigh: number;
  /** Upper plausible speed during a gap where no end position is known. */
  gapMaxSpeedMps: number;
}

export const DEFAULT_GPS_FILTER: GpsFilterConfig = {
  maxAccuracyM: 50,
  maxSpeedMps: 45,
  maxAccelMps2: 6,
  accelCheckMinSpeedMps: 20,
  minMoveM: 5,
  accuracyMoveFactor: 0.5,
  stationaryFlushS: 10,
  gapThresholdS: 20,
  reanchorAfterS: 30,
  gapRouteFactor: 1.2,
  gapRouteFactorHigh: 1.5,
  gapMaxSpeedMps: 15,
};
