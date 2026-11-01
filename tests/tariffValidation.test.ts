import { describe, expect, it } from 'vitest';
import { TARIFFS } from '../src/config/tariffs';
import { estimateFare } from '../src/domain/fare/calculator';
import { crossoverSpeedMps, validateTariff, type TaxiTariff } from '../src/domain/fare/tariff';
import type { TripInput } from '../src/domain/fare/types';

const base = TARIFFS[0];
const monetary = ['initialFare', 'distanceStepFare', 'waitingStepFare', 'airportSupplement', 'luggageSupplement'] as const;
const numeric = [...monetary, 'distanceStepMeters', 'waitingStepSeconds', 'nightMultiplier', 'switchingSpeedKmh', 'utcOffsetMinutes'] as const;
function input(hour: number, minute: number, parts: [number, number][], supplements = { airportDeparture: false, luggageItems: 0 }): TripInput {
  const startMs = Date.UTC(2026, 9, 31, hour - 1, minute);
  let cursor = startMs;
  const intervals = parts.map(([distanceM, durationS]) => {
    const interval = { startMs: cursor, distanceM, durationS, kind: 'measured' as const };
    cursor += durationS * 1000;
    return interval;
  });
  return { startMs, endMs: cursor, intervals, supplements, distanceError: 0, dataConfidence: 1, warnings: [] };
}

describe('tariff numeric validation contract', () => {
  it.each(numeric.flatMap(field => [NaN, Infinity, -Infinity].map(value => ({ field, value }))))('rejects $field=$value with a field-specific error', ({ field, value }) => {
    expect(validateTariff({ ...base, [field]: value }).some(error => error.includes(field))).toBe(true);
  });

  it.each(monetary.flatMap(field => [-1, .5, Number.MAX_SAFE_INTEGER + 1].map(value => ({ field, value }))))('rejects negative/fractional/unsafe millimes $field=$value', ({ field, value }) => {
    expect(validateTariff({ ...base, [field]: value }).some(error => error.includes(field))).toBe(true);
  });

  it.each(monetary)('preserves zero and maximum exactly representable unit amount for %s', field => {
    const fixture = { ...base, nightMultiplier: 1, switchingSpeedKmh: 20, [field]: 0 };
    expect(validateTariff(fixture)).toEqual([]);
    expect(validateTariff({ ...fixture, [field]: Number.MAX_SAFE_INTEGER })).toEqual([]);
  });

  it.each(['distanceStepMeters', 'waitingStepSeconds'] as const)('rejects invalid %s divisors and reciprocal/rate overflow', field => {
    for (const value of [0, -1, Number.MIN_VALUE]) {
      expect(validateTariff({ ...base, [field]: value, switchingSpeedKmh: 20 }).some(error => error.includes(field))).toBe(true);
    }
    const fare = field === 'distanceStepMeters' ? 'distanceStepFare' : 'waitingStepFare';
    expect(validateTariff({ ...base, [field]: 1e-300, [fare]: Number.MAX_SAFE_INTEGER, nightMultiplier: 1,
      switchingSpeedKmh: 20 }).some(error => error.includes(field))).toBe(true);
  });

  it('preserves omitted/undefined switching speed and its normal derived value', () => {
    const fixture = { ...base }; delete fixture.switchingSpeedKmh;
    expect(validateTariff(fixture)).toEqual([]);
    expect(validateTariff({ ...fixture, switchingSpeedKmh: undefined })).toEqual([]);
    expect(crossoverSpeedMps(fixture)).toBeCloseTo(79 / 18);
  });

  it.each([null, '15.5', false, 0, -1, Number.MIN_VALUE])('rejects malformed or unusable optional speed %s', value => {
    const fixture = { ...base, switchingSpeedKmh: value } as unknown as TaxiTariff;
    expect(validateTariff(fixture).some(error => error.includes('switchingSpeedKmh'))).toBe(true);
  });

  it.each([[0, 46], [46, 0], [0, 0]])('requires explicit switching speed for zero-rate pair distance=%s waiting=%s', (distanceStepFare, waitingStepFare) => {
    const fixture = { ...base, distanceStepFare, waitingStepFare, switchingSpeedKmh: undefined };
    expect(validateTariff(fixture).some(error => error.includes('switching speed'))).toBe(true);
    expect(validateTariff({ ...fixture, switchingSpeedKmh: 17.25 })).toEqual([]);
  });

  it('rejects a derived crossover that underflows despite finite positive fields', () => {
    const fixture = { ...base, distanceStepMeters: 1e-200, waitingStepSeconds: 1e200 };
    expect(crossoverSpeedMps(fixture)).toBe(0);
    expect(validateTariff(fixture).some(error => error.includes('switching speed'))).toBe(true);
    expect(validateTariff({ ...fixture, switchingSpeedKmh: 17.25 })).toEqual([]);
  });

  it('preserves continuous measures, multipliers and speeds; rejects existing invalid multiplier values', () => {
    expect(validateTariff({ ...base, distanceStepMeters: 79.5, waitingStepSeconds: 18.5, nightMultiplier: 1.25, switchingSpeedKmh: 15.75 })).toEqual([]);
    for (const nightMultiplier of [0, -.5, .5]) expect(validateTariff({ ...base, nightMultiplier }).length).toBeGreaterThan(0);
  });

  it('rejects unrepresentable rounded night units without rejecting unused initial products', () => {
    expect(validateTariff({ ...base, nightMultiplier: Number.MAX_VALUE }).some(error => error.includes('night'))).toBe(true);
    expect(validateTariff({ ...base, initialFare: Number.MAX_SAFE_INTEGER, nightMultiplier: 2 }).some(error => error.includes('initialFare'))).toBe(true);
    expect(validateTariff({ ...base, initialFare: Number.MAX_SAFE_INTEGER, distanceStepFare: 0, waitingStepFare: 0,
      nightMultiplier: Number.MAX_VALUE, nightAppliesToInitialFare: false, switchingSpeedKmh: 20 })).toEqual([]);
  });

  it.each([0, -210, 330, 345, 840, 330.5, 1 / 60000])('accepts UTC offset %s numeric minutes without a geographic whitelist', utcOffsetMinutes => {
    expect(validateTariff({ ...base, utcOffsetMinutes })).toEqual([]);
  });

  it.each([null, '60', false, Number.MAX_VALUE, 1 / 120000])('rejects malformed or unrepresentable UTC offset %s', utcOffsetMinutes => {
    expect(validateTariff({ ...base, utcOffsetMinutes } as unknown as TaxiTariff).some(error => error.includes('utcOffsetMinutes'))).toBe(true);
  });

  it('retains existing clock-window parsing and allows no-night/daytime windows', () => {
    for (const [nightStart, nightEnd] of [['00:00', '00:00'], ['9:00', '17:30'], ['21:00', '05:00']]) {
      expect(validateTariff({ ...base, nightStart, nightEnd })).toEqual([]);
    }
    for (const value of ['24:00', '23:60', '21:0', '-1:00']) {
      expect(validateTariff({ ...base, nightStart: value }).length).toBeGreaterThan(0);
      expect(validateTariff({ ...base, nightEnd: value }).length).toBeGreaterThan(0);
    }
  });

  it('keeps every existing production tariff valid and unmodified without requiring legal verification', () => {
    const before = JSON.stringify(TARIFFS);
    for (const tariff of TARIFFS) expect(validateTariff(Object.freeze({ ...tariff }))).toEqual([]);
    expect(JSON.stringify(TARIFFS)).toBe(before);
    expect(base.effectiveFrom).toBeNull();
  });
});

describe('valid estimate compatibility', () => {
  it.each([
    { label: 'day distance', trip: input(10, 0, [[790, 60]]), best: 1360, high: 1406 },
    { label: 'day waiting', trip: input(10, 0, [[0, 180]]), best: 1360, high: 1406 },
    { label: 'mixed modes', trip: input(10, 0, [[5000, 600], [0, 300]]), best: 4534, high: 4580 },
    { label: 'night', trip: input(22, 0, [[790, 60]]), best: 2040, high: 2109 },
    { label: 'night boundary', trip: input(20, 59, [[0, 120]]), best: 1245, high: 1314 },
    { label: 'supplements', trip: input(10, 0, [[790, 60]], { airportDeparture: true, luggageItems: 2 }), best: 7860, high: 7906 },
  ])('retains exact integer-millime results for $label', ({ trip, best, high }) => {
    const before = estimateFare(trip, base);
    expect(validateTariff(base)).toEqual([]);
    expect(estimateFare(trip, base)).toEqual(before);
    expect(before.best).toBe(best); expect(before.low).toBe(best); expect(before.high).toBe(high);
    expect(Object.values(before.breakdown).every(Number.isSafeInteger)).toBe(true);
  });

  it('calculates fractional configuration using the unchanged rounding behavior', () => {
    const fixture = { ...base, distanceStepMeters: 79.5, waitingStepSeconds: 18.5, nightMultiplier: 1.25, switchingSpeedKmh: 15.75 };
    expect(validateTariff(fixture)).toEqual([]);
    const estimate = estimateFare(input(22, 0, [[795, 60]]), fixture);
    expect(estimate.best).toBe(1705); expect(estimate.low).toBe(1705); expect(estimate.high).toBe(1763);
  });

  it('calculates a legitimate zero-charge configuration with explicit switching speed', () => {
    const fixture = { ...base, initialFare: 0, distanceStepFare: 0, waitingStepFare: 0, airportSupplement: 0, luggageSupplement: 0, switchingSpeedKmh: 20 };
    expect(validateTariff(fixture)).toEqual([]);
    const estimate = estimateFare(input(22, 0, [[790, 60]], { airportDeparture: true, luggageItems: 2 }), fixture);
    expect([estimate.best, estimate.low, estimate.high]).toEqual([0, 0, 0]);
  });
});
