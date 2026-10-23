import { describe, expect, it } from 'vitest';
import { getActiveTariff } from '../src/config/tariffs';
import { estimateFare } from '../src/domain/fare/calculator';
import type { GpsSample } from '../src/domain/trip/gpsTrack';
import { analyzeTrack } from '../src/domain/trip/gpsTrack';
import { liveTripInput } from '../src/domain/trip/tripInput';

const tariff = getActiveTariff();
const T0 = Date.UTC(2026, 9, 22, 9, 0); // 10:00 Tunis
const LAT = 36.8;
const M_PER_DEG_LON = 111_320 * Math.cos((LAT * Math.PI) / 180);

/** Deterministic pseudo-random noise. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) - 0.5;
}

/** Car driving east at `speed` m/s, one fix per second. */
function drive(fromS: number, toS: number, speed: number, startX = 0, accuracy = 5): GpsSample[] {
  const out: GpsSample[] = [];
  for (let s = fromS; s <= toS; s++) {
    const x = startX + (s - fromS) * speed;
    out.push({ t: T0 + s * 1000, lat: LAT, lon: 10 + x / M_PER_DEG_LON, accuracy, speed });
  }
  return out;
}

describe('GPS track analysis', () => {
  it('measures a clean straight drive accurately', () => {
    const samples = drive(0, 300, 10); // 3 km
    const a = analyzeTrack(samples, T0, T0 + 300_000);
    expect(a.stats.measuredDistanceM).toBeGreaterThan(2970);
    expect(a.stats.measuredDistanceM).toBeLessThan(3010);
    expect(a.stats.coverage).toBeGreaterThan(0.99);
  });

  it('9a. jitter while stopped does not add distance', () => {
    const r = rng(42);
    const samples: GpsSample[] = [];
    for (let s = 0; s <= 300; s++) {
      samples.push({ t: T0 + s * 1000, lat: LAT + (r() * 6) / 111_320, lon: 10 + (r() * 6) / M_PER_DEG_LON, accuracy: 8, speed: 0 });
    }
    const a = analyzeTrack(samples, T0, T0 + 300_000);
    expect(a.stats.measuredDistanceM).toBe(0);
    const e = estimateFare(liveTripInput(a, T0, T0 + 300_000, { airportDeparture: false, luggageItems: 0 }), tariff);
    expect(e.breakdown.distanceCharge).toBe(0);
    expect(e.breakdown.waitingCharge).toBe(16 * 46);
  });

  it('9b. an impossible coordinate jump is rejected', () => {
    const samples = drive(0, 120, 10);
    samples[60] = { ...samples[60], lon: samples[60].lon + 2000 / M_PER_DEG_LON };
    const a = analyzeTrack(samples, T0, T0 + 120_000);
    expect(a.stats.rejectedJump).toBe(1);
    expect(a.stats.measuredDistanceM).toBeGreaterThan(1180);
    expect(a.stats.measuredDistanceM).toBeLessThan(1210);
  });

  it('rejects fixes with poor accuracy', () => {
    const samples = drive(0, 60, 10).map((s, i) => (i % 2 ? { ...s, accuracy: 200 } : s));
    const a = analyzeTrack(samples, T0, T0 + 60_000);
    expect(a.stats.rejectedAccuracy).toBe(30);
    expect(a.stats.measuredDistanceM).toBeGreaterThan(590);
  });

  it('8. GPS data loss becomes a bounded gap and lowers confidence', () => {
    const samples = [...drive(0, 100, 10), ...drive(200, 300, 10, 2000)];
    const a = analyzeTrack(samples, T0, T0 + 300_000);
    const gaps = a.intervals.filter((i) => i.kind === 'gap');
    expect(gaps).toHaveLength(1);
    expect(gaps[0].durationS).toBe(100);
    expect(gaps[0].distanceLowM).toBeCloseTo(1000, -1);
    expect(a.stats.coverage).toBeLessThan(0.7);

    const input = liveTripInput(a, T0, T0 + 300_000, { airportDeparture: false, luggageItems: 0 });
    expect(input.warnings).toContain('Estimate has limited accuracy because GPS data was incomplete.');
    const e = estimateFare(input, tariff);
    // ~3 km total, gap bounded at >= straight line
    expect(e.low).toBeLessThanOrEqual(900 + Math.floor(2900 / 79) * 46);
    expect(e.high).toBeGreaterThan(e.best);
  });

  it('no GPS at all gives zero confidence and a warning', () => {
    const a = analyzeTrack([], T0, T0 + 600_000);
    const input = liveTripInput(a, T0, T0 + 600_000, { airportDeparture: false, luggageItems: 0 });
    expect(input.dataConfidence).toBe(0);
    expect(input.warnings[0]).toMatch(/No usable GPS/);
  });

  it('is deterministic regardless of sample order', () => {
    const samples = drive(0, 200, 8);
    const a1 = analyzeTrack(samples, T0, T0 + 200_000);
    const a2 = analyzeTrack([...samples].reverse(), T0, T0 + 200_000);
    expect(a2.stats.measuredDistanceM).toBeCloseTo(a1.stats.measuredDistanceM, 6);
  });
});
