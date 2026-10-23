import type { EstimationAssumptions } from '../../../config/estimation';
import { DEFAULT_ASSUMPTIONS } from '../../../config/estimation';
import { splitByNight } from '../night';
import type { TaxiTariff } from '../tariff';
import { switchingSpeedMps } from '../tariff';
import type { FareEstimate, Interval, TripInput } from '../types';
import type { FareCalculationStrategy } from './strategy';

type GapMode = 'low' | 'best' | 'high';

interface Units {
  dayDistM: number;
  nightDistM: number;
  dayTimeS: number;
  nightTimeS: number;
  movingTimeS: number;
}

interface Scenario {
  switchMps: number;
  distFactor: number;
  gapMode: GapMode;
}

const EMPTY: Units = { dayDistM: 0, nightDistM: 0, dayTimeS: 0, nightTimeS: 0, movingTimeS: 0 };

/**
 * "Single application" horokilometric model: at any moment the meter charges
 * EITHER by distance (speed >= switching speed) OR by time (below it), never
 * both. This avoids double charging. Whether Tunisian meters work exactly
 * this way is not verified; swap the strategy if it turns out otherwise.
 */
export class SingleApplicationStrategy implements FareCalculationStrategy {
  readonly id = 'single-application-v1';

  constructor(private readonly assumptions: EstimationAssumptions = DEFAULT_ASSUMPTIONS) {}

  calculate(trip: TripInput, tariff: TaxiTariff): FareEstimate {
    const sw = switchingSpeedMps(tariff);
    const tol = this.assumptions.switchingSpeedTolerance;
    const e = trip.distanceError;

    const best = this.units(trip, tariff, { switchMps: sw.mps, distFactor: 1, gapMode: 'best' });
    const bestMoney = this.money(best, trip, tariff);

    let low = Infinity;
    let high = -Infinity;
    for (const f of [1 - tol, 1, 1 + tol]) {
      const lo = this.money(this.units(trip, tariff, { switchMps: sw.mps * f, distFactor: 1 - e, gapMode: 'low' }), trip, tariff);
      const hi = this.money(this.units(trip, tariff, { switchMps: sw.mps * f, distFactor: 1 + e, gapMode: 'high' }), trip, tariff);
      low = Math.min(low, lo.total);
      high = Math.max(high, hi.total);
    }
    // The meter may be up to one step further along than a whole-step count.
    const step = Math.max(tariff.distanceStepFare, tariff.waitingStepFare);
    const nightStep = Math.round(step * tariff.nightMultiplier);
    high += best.nightDistM + best.nightTimeS > 0 ? nightStep : step;
    low = Math.min(low, bestMoney.total);
    high = Math.max(high, bestMoney.total);

    const totalS = best.dayTimeS + best.nightTimeS + best.movingTimeS;
    const nightS = trip.intervals.reduce(
      (acc, iv) => acc + splitByNight(iv, tariff).filter((p) => p.night).reduce((a, p) => a + p.interval.durationS, 0),
      0,
    );
    const durationS = trip.intervals.reduce((a, iv) => a + iv.durationS, 0);

    const assumptions = [
      sw.verified
        ? `Switching speed ${(sw.mps * 3.6).toFixed(1)} km/h (configured).`
        : `No verified official switching speed. Using the tariff crossover speed ${(sw.mps * 3.6).toFixed(1)} km/h, where time and distance rates are equal.`,
      'The meter is assumed to charge distance OR time at any moment, never both.',
      tariff.nightAppliesToInitialFare
        ? 'Night multiplier also applied to the initial charge when the ride starts at night (not verified).'
        : 'Night multiplier not applied to the initial charge.',
    ];

    return {
      best: bestMoney.total,
      low,
      high,
      breakdown: bestMoney,
      distanceChargedM: best.dayDistM + best.nightDistM,
      waitingChargedS: best.dayTimeS + best.nightTimeS,
      movingTimeS: Math.min(best.movingTimeS, totalS),
      nightShare: durationS > 0 ? nightS / durationS : 0,
      confidence: trip.dataConfidence,
      warnings: [...trip.warnings],
      assumptions,
      tariffId: tariff.id,
      strategyId: this.id,
    };
  }

  private units(trip: TripInput, tariff: TaxiTariff, sc: Scenario): Units {
    let u = { ...EMPTY };
    for (const iv of trip.intervals) {
      for (const piece of splitByNight(iv, tariff)) {
        const part = piece.interval.kind === 'gap' ? this.gapUnits(piece.interval, tariff, sc) : this.measuredUnits(piece.interval, sc);
        u = {
          dayDistM: u.dayDistM + (piece.night ? 0 : part.distM),
          nightDistM: u.nightDistM + (piece.night ? part.distM : 0),
          dayTimeS: u.dayTimeS + (piece.night ? 0 : part.timeS),
          nightTimeS: u.nightTimeS + (piece.night ? part.timeS : 0),
          movingTimeS: u.movingTimeS + part.movingS,
        };
      }
    }
    return u;
  }

  private measuredUnits(iv: Interval, sc: Scenario): { distM: number; timeS: number; movingS: number } {
    if (iv.durationS <= 0) return { distM: iv.distanceM * sc.distFactor, timeS: 0, movingS: 0 };
    const speed = iv.speedHintMps ?? iv.distanceM / iv.durationS;
    return speed >= sc.switchMps
      ? { distM: iv.distanceM * sc.distFactor, timeS: 0, movingS: iv.durationS }
      : { distM: 0, timeS: iv.durationS, movingS: 0 };
  }

  /**
   * Gap of duration T and distance D with unknown stopped time s.
   * Charge(s) = s at the time rate + the moving part (T - s, D) classified by its speed.
   * low  = cheapest feasible split (constant speed, or the minimum stop needed),
   * best = moving at the typical town speed,
   * high = moving at the max plausible speed (largest stopped share).
   */
  private gapUnits(iv: Interval, tariff: TaxiTariff, sc: Scenario): { distM: number; timeS: number; movingS: number } {
    const T = iv.durationS;
    const pick = sc.gapMode === 'low' ? iv.distanceLowM : sc.gapMode === 'high' ? iv.distanceHighM : undefined;
    const D = (pick ?? iv.distanceM) * sc.distFactor;
    const split = (s: number) => {
      if (D <= 0) return { distM: 0, timeS: T, movingS: 0 };
      if (T <= 0) return { distM: D, timeS: 0, movingS: 0 };
      const moveS = T - s; // > 0: s comes from stopFor(), which leaves D / v seconds of movement
      return D / moveS >= sc.switchMps
        ? { distM: D, timeS: s, movingS: moveS }
        : { distM: 0, timeS: T, movingS: 0 };
    };
    const value = (u: { distM: number; timeS: number }) =>
      (u.distM / tariff.distanceStepMeters) * tariff.distanceStepFare + (u.timeS / tariff.waitingStepSeconds) * tariff.waitingStepFare;
    const stopFor = (vMps: number) => Math.max(0, T - D / vMps);

    const typical = this.assumptions.typicalMovingSpeedKmh / 3.6;
    const max = this.assumptions.maxMovingSpeedKmh / 3.6;
    if (sc.gapMode === 'best') return split(stopFor(typical));
    const candidates = [split(0), split(stopFor(sc.switchMps)), split(stopFor(typical)), split(stopFor(max))];
    const sorted = [...candidates].sort((a, b) => value(a) - value(b));
    return sc.gapMode === 'low' ? sorted[0] : sorted[sorted.length - 1];
  }

  private money(u: Units, trip: TripInput, tariff: TaxiTariff) {
    const m = tariff.nightMultiplier;
    const dayDistSteps = Math.floor(u.dayDistM / tariff.distanceStepMeters + 1e-9);
    const nightDistSteps = Math.floor(u.nightDistM / tariff.distanceStepMeters + 1e-9);
    const dayTimeSteps = Math.floor(u.dayTimeS / tariff.waitingStepSeconds + 1e-9);
    const nightTimeSteps = Math.floor(u.nightTimeS / tariff.waitingStepSeconds + 1e-9);

    const nightStepD = Math.round(tariff.distanceStepFare * m);
    const nightStepT = Math.round(tariff.waitingStepFare * m);
    const startsAtNight = splitByNight(
      { startMs: trip.startMs, durationS: 0, distanceM: 0, kind: 'measured' },
      tariff,
    )[0].night;
    const initialNight = startsAtNight && tariff.nightAppliesToInitialFare;
    const initialFare = initialNight ? Math.round(tariff.initialFare * m) : tariff.initialFare;

    const distanceCharge = dayDistSteps * tariff.distanceStepFare + nightDistSteps * nightStepD;
    const waitingCharge = dayTimeSteps * tariff.waitingStepFare + nightTimeSteps * nightStepT;
    const nightSurcharge =
      nightDistSteps * (nightStepD - tariff.distanceStepFare) +
      nightTimeSteps * (nightStepT - tariff.waitingStepFare) +
      (initialFare - tariff.initialFare);
    const airportSupplement = trip.supplements.airportDeparture ? tariff.airportSupplement : 0;
    const luggageSupplement = Math.max(0, Math.floor(trip.supplements.luggageItems)) * tariff.luggageSupplement;
    return {
      initialFare,
      distanceCharge,
      waitingCharge,
      nightSurcharge,
      airportSupplement,
      luggageSupplement,
      total: initialFare + distanceCharge + waitingCharge + airportSupplement + luggageSupplement,
    };
  }
}
