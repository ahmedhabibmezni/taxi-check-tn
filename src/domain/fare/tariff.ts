/**
 * Tariff model. All monetary values are integer MILLIMES (1 TND = 1000 millimes).
 */
export interface TaxiTariff {
  id: string;
  name: string;
  /** ISO date the tariff took effect, or null when it is not confirmed. */
  effectiveFrom: string | null;
  initialFare: number;
  distanceStepMeters: number;
  distanceStepFare: number;
  waitingStepSeconds: number;
  waitingStepFare: number;
  nightMultiplier: number;
  /** Local time "HH:MM". The window may cross midnight (21:00 -> 05:00). */
  nightStart: string;
  nightEnd: string;
  /** Whether the initial charge is also multiplied when the ride starts at night. Not verified. */
  nightAppliesToInitialFare: boolean;
  airportSupplement: number;
  luggageSupplement: number;
  /**
   * Speed above which the meter charges by distance instead of time.
   * Undefined = no verified official value; the strategy then uses the
   * crossover speed derived from the tariff itself (see crossoverSpeedMps).
   */
  switchingSpeedKmh?: number;
  /** Fixed UTC offset of local time, in minutes. Tunisia is UTC+1 without DST. */
  utcOffsetMinutes: number;
  source?: string;
  /** Date the values were last checked by a human. */
  lastReviewed?: string;
  /** Shown prominently in the UI (e.g. "a newer tariff may be in force"). */
  notice?: string;
}

export function parseHHMM(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid time "${value}", expected HH:MM`);
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) throw new Error(`Invalid time "${value}"`);
  return h * 60 + m;
}

/**
 * Speed at which time charging and distance charging produce the same amount.
 * For 79 m / 18 s this is 4.39 m/s (15.8 km/h). This is a property of the
 * tariff numbers, not an official switching rule.
 */
export function crossoverSpeedMps(t: TaxiTariff): number {
  const perMeter = t.distanceStepFare / t.distanceStepMeters;
  const perSecond = t.waitingStepFare / t.waitingStepSeconds;
  return perSecond / perMeter;
}

export function switchingSpeedMps(t: TaxiTariff): { mps: number; verified: boolean } {
  if (t.switchingSpeedKmh !== undefined) return { mps: t.switchingSpeedKmh / 3.6, verified: true };
  return { mps: crossoverSpeedMps(t), verified: false };
}

export function validateTariff(t: TaxiTariff): string[] {
  const errors: string[] = [];
  const ints: (keyof TaxiTariff)[] = [
    'initialFare', 'distanceStepFare', 'waitingStepFare', 'airportSupplement', 'luggageSupplement',
  ];
  for (const key of ints) {
    const v = t[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      errors.push(`${key} must be a non-negative integer number of millimes`);
    }
  }
  if (!(t.distanceStepMeters > 0)) errors.push('distanceStepMeters must be > 0');
  if (!(t.waitingStepSeconds > 0)) errors.push('waitingStepSeconds must be > 0');
  if (!(t.nightMultiplier >= 1)) errors.push('nightMultiplier must be >= 1');
  if (t.switchingSpeedKmh !== undefined && !(t.switchingSpeedKmh > 0)) {
    errors.push('switchingSpeedKmh must be > 0 when set');
  }
  try {
    parseHHMM(t.nightStart);
    parseHHMM(t.nightEnd);
  } catch (e) {
    errors.push((e as Error).message);
  }
  return errors;
}
