import type { TripRecord } from '../../src/domain/trip/types';

export function cardFixture(): TripRecord {
  return { id: 'private-record-id', mode: 'manual', startMs: 1793530800000, endMs: 1793532000000,
    durationS: 1200, distanceM: 5000, movingTimeS: 1080, slowTimeS: 120,
    startCoords: { lat: 36.81, lon: 10.17 }, endCoords: { lat: 36.91, lon: 10.27 },
    estimate: { best: 4074, low: 3844, high: 4350, breakdown: { initialFare: 900, distanceCharge: 2898,
      waitingCharge: 276, nightSurcharge: 0, airportSupplement: 0, luggageSupplement: 0, total: 4074 } },
    meter: 6125, diff: 2051, diffPct: 50.34364, tariffId: 'private-tariff-id', strategyId: 'private-strategy',
    supplements: { airportDeparture: false, luggageItems: 0 }, confidence: .6, warnings: ['Private historical text 36.81'] };
}
