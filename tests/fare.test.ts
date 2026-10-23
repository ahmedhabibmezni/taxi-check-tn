import { describe, expect, it } from 'vitest';
import { getActiveTariff } from '../src/config/tariffs';
import { estimateFare } from '../src/domain/fare/calculator';
import { compareWithMeter } from '../src/domain/fare/compare';
import { isNight } from '../src/domain/fare/night';
import { crossoverSpeedMps, validateTariff } from '../src/domain/fare/tariff';
import type { FareEstimate, Interval, TripInput } from '../src/domain/fare/types';
import { manualTripInput } from '../src/domain/trip/tripInput';
import { formatTnd, parseTnd } from '../src/utils/money';

const tariff = getActiveTariff();
const NO_SUPP = { airportDeparture: false, luggageItems: 0 };
/** Local Tunis time (UTC+1) on 22 Oct 2026, as epoch ms. */
const local = (h: number, m = 0) => Date.UTC(2026, 9, 22, h - 1, m);

function trip(startMs: number, parts: [distanceM: number, durationS: number][], supplements = NO_SUPP): TripInput {
  let t = startMs;
  const intervals: Interval[] = parts.map(([distanceM, durationS]) => {
    const iv: Interval = { startMs: t, durationS, distanceM, kind: 'measured' };
    t += durationS * 1000;
    return iv;
  });
  return { startMs, endMs: t, intervals, supplements, distanceError: 0.03, dataConfidence: 1, warnings: [] };
}

describe('tariff config', () => {
  it('is valid and expressed in integer millimes', () => {
    expect(validateTariff(tariff)).toEqual([]);
    expect(tariff.initialFare).toBe(900);
    expect(tariff.distanceStepFare).toBe(46);
  });
  it('derives the crossover speed instead of inventing a switching speed', () => {
    expect(tariff.switchingSpeedKmh).toBeUndefined();
    expect(crossoverSpeedMps(tariff) * 3.6).toBeCloseTo(15.8, 1);
  });
});

describe('fare engine (single application strategy)', () => {
  it('1. pure daytime distance trip', () => {
    const e = estimateFare(trip(local(10), [[10_000, 1200]]), tariff);
    // floor(10000 / 79) = 126 steps x 46
    expect(e.best).toBe(900 + 126 * 46);
    expect(e.breakdown.waitingCharge).toBe(0);
    expect(e.low).toBeLessThanOrEqual(e.best);
    expect(e.high).toBeGreaterThanOrEqual(e.best);
  });

  it('2. pure waiting', () => {
    const e = estimateFare(trip(local(10), [[0, 600]]), tariff);
    expect(e.best).toBe(900 + 33 * 46);
    expect(e.breakdown.distanceCharge).toBe(0);
  });

  it('3. mixed movement and waiting is never double charged', () => {
    const e = estimateFare(trip(local(10), [[5000, 600], [0, 300]]), tariff);
    expect(e.breakdown.distanceCharge).toBe(63 * 46);
    expect(e.breakdown.waitingCharge).toBe(16 * 46);
    expect(e.best).toBe(900 + 63 * 46 + 16 * 46);
    expect(e.movingTimeS).toBe(600);
  });

  it('slow crawl below the switching speed is charged by time only', () => {
    const e = estimateFare(trip(local(10), [[300, 300]]), tariff); // 1 m/s
    expect(e.breakdown.distanceCharge).toBe(0);
    expect(e.breakdown.waitingCharge).toBe(16 * 46);
  });

  it('4. ride crossing 21:00 charges only the night part at night rate', () => {
    const e = estimateFare(trip(local(20, 50), [[0, 1200]]), tariff);
    expect(e.breakdown.initialFare).toBe(900);
    expect(e.best).toBe(900 + 33 * 46 + 33 * 69);
    expect(e.breakdown.nightSurcharge).toBe(33 * 23);
    expect(e.nightShare).toBeCloseTo(0.5, 5);
  });

  it('5. ride crossing 05:00 starts at night rate and ends at day rate', () => {
    const e = estimateFare(trip(local(4, 50), [[0, 1200]]), tariff);
    expect(e.breakdown.initialFare).toBe(1350);
    expect(e.best).toBe(1350 + 33 * 69 + 33 * 46);
  });

  it('night window crosses midnight', () => {
    expect(isNight(local(20, 59), tariff)).toBe(false);
    expect(isNight(local(21, 0), tariff)).toBe(true);
    expect(isNight(Date.UTC(2026, 9, 22, 23, 30), tariff)).toBe(true); // 00:30 local
    expect(isNight(local(4, 59), tariff)).toBe(true);
    expect(isNight(local(5, 0), tariff)).toBe(false);
  });

  it('6. airport supplement', () => {
    const e = estimateFare(trip(local(10), [[0, 600]], { airportDeparture: true, luggageItems: 0 }), tariff);
    expect(e.breakdown.airportSupplement).toBe(4500);
    expect(e.best).toBe(900 + 33 * 46 + 4500);
  });

  it('7. luggage supplements', () => {
    const e = estimateFare(trip(local(10), [[0, 600]], { airportDeparture: false, luggageItems: 2 }), tariff);
    expect(e.breakdown.luggageSupplement).toBe(2000);
    expect(e.best).toBe(900 + 33 * 46 + 2000);
  });

  it('10. manual trip without waiting time gives a range, not a fake exact fare', () => {
    const input = manualTripInput({ distanceKm: 20, durationMin: 48, startMs: local(18, 10), stoppedMin: null, supplements: NO_SUPP });
    const e = estimateFare(input, tariff);
    expect(e.warnings).toContain('Waiting time was not provided, so this estimate uses a range.');
    // Constant speed (6.9 m/s) => distance only: 900 + 253 x 46 = 12 538, the cheapest realistic case.
    expect(e.low).toBeLessThanOrEqual(12_538);
    expect(e.high).toBeGreaterThan(e.best);
    expect(e.best).toBeGreaterThan(e.low);
    expect(e.high - e.low).toBeGreaterThan(1000);
    expect(e.confidence).toBeLessThan(0.5);
  });

  it('manual trip with known stopped time is close to the exact split', () => {
    const input = manualTripInput({ distanceKm: 20, durationMin: 48, startMs: local(18, 10), stoppedMin: 10, supplements: NO_SUPP });
    const e = estimateFare(input, tariff);
    // 20 km moving + 600 s stopped, chunked in 12 (floors can lose one step each side)
    expect(Math.abs(e.best - (900 + 253 * 46 + 33 * 46))).toBeLessThanOrEqual(92);
    expect(e.low).toBeLessThan(e.best);
  });

  it('11. zero-distance zero-time trip costs the initial charge', () => {
    expect(estimateFare(trip(local(10), []), tariff).best).toBe(900);
  });

  it('12. very short ride stays at the initial charge', () => {
    expect(estimateFare(trip(local(10), [[50, 10]]), tariff).best).toBe(900);
  });

  it('13. long ride', () => {
    const e = estimateFare(trip(local(10), [[100_000, 7200]]), tariff);
    expect(e.best).toBe(900 + 1265 * 46);
  });

  it('14. step boundaries and money are exact integers', () => {
    expect(estimateFare(trip(local(10), [[790, 60]]), tariff).breakdown.distanceCharge).toBe(460);
    expect(estimateFare(trip(local(10), [[237, 30]]), tariff).breakdown.distanceCharge).toBe(3 * 46);
    const many = trip(local(10), Array.from({ length: 100 }, () => [79, 10] as [number, number]));
    expect(estimateFare(many, tariff).breakdown.distanceCharge).toBe(100 * 46);
    const e = estimateFare(trip(local(22), [[7900, 600]]), tariff);
    expect(Number.isInteger(e.best) && Number.isInteger(e.low) && Number.isInteger(e.high)).toBe(true);
    expect(e.breakdown.distanceCharge).toBe(100 * 69);
  });

  it('money parsing and formatting avoid floating point', () => {
    expect(parseTnd('15.000')).toBe(15_000);
    expect(parseTnd('15,5')).toBe(15_500);
    expect(parseTnd('0.046')).toBe(46);
    expect(parseTnd('8')).toBe(8000);
    expect(parseTnd('1.0001')).toBeNull();
    expect(parseTnd('abc')).toBeNull();
    expect(formatTnd(14_200)).toBe('14.200');
    expect(formatTnd(46)).toBe('0.046');
    expect(formatTnd(14_250, 1)).toBe('14.3');
  });
});

describe('15. comparison with the driver meter', () => {
  const est = { best: 14_200, low: 13_500, high: 15_000, confidence: 1 } as FareEstimate;

  it('within range', () => {
    const c = compareWithMeter(est, 15_000);
    expect(c.status).toBe('within');
    expect(c.diff).toBe(800);
    expect(c.diffPct).toBeCloseTo(5.63, 1);
  });
  it('slightly above', () => {
    expect(compareWithMeter(est, 15_800).status).toBe('slightly_above');
  });
  it('significantly above', () => {
    expect(compareWithMeter(est, 17_000).status).toBe('significantly_above');
  });
  it('below', () => {
    expect(compareWithMeter(est, 13_000).status).toBe('below');
  });
  it('undetermined when confidence is too low', () => {
    expect(compareWithMeter({ ...est, confidence: 0.1 }, 17_000).status).toBe('undetermined');
  });
  it('labels are neutral', () => {
    expect(compareWithMeter(est, 17_000).label).toBe('Significantly above estimate');
  });
});
